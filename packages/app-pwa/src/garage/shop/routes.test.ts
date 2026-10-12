/**
 * routes.test.ts — Las rutas del shop se EJECUTAN, no se leen.
 *
 * Se sigue el patrón de tests/fleet-stats-tenancy.test.ts: se mockea `src/lib/domain.js`
 * (las entidades del shop viven en la instancia compartida) y se llama al handler con un
 * contexto de Astro falso. Lo que se comprueba es el efecto: el estado HTTP, a quién se le
 * deja tocar qué, y a dónde manda el 302 del clic.
 *
 * Los cuatro fallos que cubre:
 *   1. Sin sesión, todo responde 401 (incluida la redirección del clic).
 *   2. El dueño solo edita SUS campañas; la de otro responde 403.
 *   3. Revisar y recargar saldo son de admin; un operator responde 403.
 *   4. El clic solo redirige a https validado; un token manipulado cae en /fleet/garage.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Las rutas se importan de forma ESTATICA (no con `import()` de un string): Vite solo
// resuelve rutas dinamicas en tiempo de build, y en vitest terminaria en `/pages/...`.
import * as shopRoute from '../../pages/api/garage/shop.js';
import * as serveRoute from '../../pages/api/garage/ads/serve.js';
import * as impressionRoute from '../../pages/api/garage/ads/impression.js';
import * as clickRoute from '../../pages/api/garage/ads/click.js';
import * as advertisersRoute from '../../pages/api/garage/ads/advertisers.js';
import * as campaignsRoute from '../../pages/api/garage/ads/campaigns.js';
import * as reviewRoute from '../../pages/api/garage/ads/campaigns/[id]/review.js';
import * as topupRoute from '../../pages/api/garage/ads/advertisers/[id]/topup.js';
import * as statsRoute from '../../pages/api/garage/ads/campaigns/[id]/stats.js';
import { signAdToken } from './tokens.js';
import { getAdvertiser } from './store.js';

const SECRET = 'secreto-de-prueba-suficientemente-largo';

// ---------------------------------------------------------------------------
// Almacén falso de las entidades del shop. Cada test arma lo que necesita.
// ---------------------------------------------------------------------------
interface Row {
  id: string;
  instance_id: string;
  data: Record<string, unknown>;
}

const store = {
  rows: new Map<string, Row>(),
  byId: (entity: string, id: string) => `${entity}/${id}`,
};

function put(entity: string, data: Record<string, unknown>, id = String(data.id ?? `${entity}-${Math.random().toString(36).slice(2, 8)}`)): string {
  store.rows.set(store.byId(entity, id), { id, instance_id: 'gara-g-ads', data: { ...data, id } });
  return id;
}

function campaignRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    advertiserId: 'adv_1',
    name: 'Pastillas de freno',
    status: 'active',
    creative: { title: 'Pastillas', body: 'Con instalación', ctaLabel: 'Ver', url: 'https://tienda.example.com', advertiserName: 'Taller Norte' },
    targeting: {},
    pricing: { model: 'cpm', bidCOP: 5_000 },
    dailyBudgetCOP: 50_000,
    totalBudgetCOP: 500_000,
    freqCapPerUserDay: 3,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

// `vi.mock` se eleva por encima de los imports, asi que los dobles tienen que existir
// ANTES de que corra cualquier modulo: `vi.hoisted` los sube junto con el mock.
const { listEntities, getEntity, createEntity, updateEntity, getStorageAdapter } = vi.hoisted(() => ({
  listEntities: vi.fn(),
  getEntity: vi.fn(),
  createEntity: vi.fn(),
  updateEntity: vi.fn(),
  getStorageAdapter: vi.fn(),
}));

const listEntitiesImpl = async (entity: string, instanceId: string) => {
  return [...store.rows.entries()]
    .filter(([key, row]) => key.startsWith(`${entity}/`) && row.instance_id === instanceId)
    .map(([, row]) => ({ ...row.data, id: row.id, instance_id: row.instance_id }));
};
const getEntityImpl = async (entity: string, id: string, instanceId: string) => {
  const row = store.rows.get(store.byId(entity, id));
  if (!row || row.instance_id !== instanceId) return null;
  return { ...row.data, id: row.id, instance_id: row.instance_id };
};
const createEntityImpl = async (entity: string, data: Record<string, unknown>, instanceId: string) => {
  const id = `${entity}-${Math.random().toString(36).slice(2, 9)}`;
  put(entity, data, id);
  return { ...data, id, instance_id: instanceId };
};
const updateEntityImpl = async (entity: string, id: string, patch: Record<string, unknown>, instanceId: string) => {
  const row = store.rows.get(store.byId(entity, id));
  if (!row || row.instance_id !== instanceId) return null;
  row.data = { ...row.data, ...patch };
  return { ...row.data, id, instance_id: instanceId };
};

/**
 * `store.ts` escribe `adStat` y `adClick` por el ADAPTER (y no por `createEntity`) porque
 * su id debe ser `${campaignId}:${dia}` y el nonce del token. Si este doble no escribiera
 * tambien ahi, las filas del clic no aparecerian en `store` y el dedupe por token
 * pareceria roto cuando en realidad el test no lo estaba viendo.
 */
getStorageAdapter.mockImplementation(() => ({
  create: async (entity: string, record: Record<string, unknown>) => {
    put(entity, record as Record<string, unknown>, String(record.id));
    return record;
  },
  list: async () => [],
  get: async () => null,
  update: async () => null,
  del: async () => false,
}));

listEntities.mockImplementation(listEntitiesImpl);
getEntity.mockImplementation(getEntityImpl);
createEntity.mockImplementation(createEntityImpl);
updateEntity.mockImplementation(updateEntityImpl);

vi.mock('../../lib/domain.js', async () => {
  const real = await vi.importActual<typeof import('../../lib/domain.js')>('../../lib/domain.js');
  return { ...real, listEntities, getEntity, createEntity, updateEntity, getStorageAdapter };
});

const envMock = env as unknown as Record<string, unknown>;

/** Sesión: `rol` decide si la ruta lo deja pasar; `anonimo` simula que no hay cookie. */
function sesion(rol = 'operator') {
  envMock.ENVIRONMENT = 'production';
  envMock.ADS_TOKEN_SECRET = SECRET;
  envMock.SESSION = {
    get: vi.fn(async (k: string) =>
      k === 'token:t'
        ? JSON.stringify({ userId: 'usr_1', email: 'a@b.c', role: rol, instanceId: 'tenant-a', exp: Date.now() + 3_600_000 })
        : null,
    ),
    delete: vi.fn(),
  };
}

function ctx(rol?: string, extra: Record<string, unknown> = {}): never {
  const headers: Record<string, string> = rol ? { cookie: 'session=t' } : {};
  return {
    request: new Request('https://gara-g.swal.network/x', { headers, ...(extra.requestInit as object ?? {}) }),
    params: (extra.params as Record<string, string>) ?? {},
    locals: { tenant: { instanceId: 'tenant-a' } },
  } as never;
}

type APIHandler = (c: never) => Promise<Response>;

/** Ejecuta GET /click con el token en la query, que es como llega del navegador. */
async function clickWithToken(token: string): Promise<Response> {
  const url = new URL('https://gara-g.swal.network/api/garage/ads/click');
  url.searchParams.set('t', token);
  return clickRoute.GET({
    request: new Request(url, { headers: { cookie: 'session=t' } }),
    params: {},
    locals: { tenant: { instanceId: 'tenant-a' } },
  } as never);
}

/** `res.json()` devuelve `unknown` en TS estricto: estos helpers lo estrechan. */
interface ResBody {
  campaign?: { status: string; [k: string]: unknown };
  advertiser?: { balanceCOP: number; [k: string]: unknown };
  totals?: { impressions: number; clicks: number; spendCOP: number; ctrPct: number; cpcRealCOP: number | null };
  [k: string]: unknown;
}
async function body(res: Response): Promise<ResBody> {
  return (await res.json()) as ResBody;
}

// ---------------------------------------------------------------------------

describe('sin sesión, el shop no responde nada', () => {
  beforeEach(() => {
    store.rows.clear();
    envMock.ENVIRONMENT = 'production';
    envMock.ADS_TOKEN_SECRET = SECRET;
    envMock.SESSION = { get: vi.fn(async () => null), delete: vi.fn() };
  });

  it('GET /api/garage/shop → 401', async () => {
    const { GET } = shopRoute;
    expect((await GET(ctx())).status).toBe(401);
  });

  it('GET /api/garage/ads/serve → 401', async () => {
    const { GET } = serveRoute;
    expect((await GET(ctx())).status).toBe(401);
  });

  it('POST /api/garage/ads/impression → 401', async () => {
    const { POST } = impressionRoute;
    expect((await POST(ctx())).status).toBe(401);
  });

  it('GET /api/garage/ads/click → 401 (no redirige a ningún sitio)', async () => {
    const { GET } = clickRoute;
    const res = await GET(ctx());
    expect(res.status).toBe(401);
  });

  it('GET/POST /api/garage/ads/advertisers → 401', async () => {
    const route = advertisersRoute;
    expect((await route.GET(ctx())).status).toBe(401);
    expect((await route.POST(ctx())).status).toBe(401);
  });

  it('GET/POST/PATCH /api/garage/ads/campaigns → 401', async () => {
    const route = campaignsRoute;
    expect((await route.GET(ctx())).status).toBe(401);
    expect((await route.POST(ctx())).status).toBe(401);
    expect((await route.PATCH(ctx())).status).toBe(401);
  });

  it('PATCH review, POST topup y GET stats → 401', async () => {
    const review = reviewRoute;
    expect((await review.PATCH(ctx(undefined, { params: { id: 'c1' } }))).status).toBe(401);
    const topup = topupRoute;
    expect((await topup.POST(ctx(undefined, { params: { id: 'a1' } }))).status).toBe(401);
    const stats = statsRoute;
    expect((await stats.GET(ctx(undefined, { params: { id: 'c1' } }))).status).toBe(401);
  });
});

describe('campañas: solo el dueño', () => {
  beforeEach(() => {
    store.rows.clear();
    sesion('operator');
  });

  it('crea una campaña como pending_review, no activa', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'Taller', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 100_000, ownerUserId: 'usr_1' });
    const { POST } = campaignsRoute;
    const res = await POST(
      ctx('operator', {
        requestInit: {
          method: 'POST',
          body: JSON.stringify({
            advertiserId: 'adv_1',
            name: 'Pastillas',
            creative: { title: 'Pastillas', body: 'Con instalación', ctaLabel: 'Ver', url: 'https://tienda.example.com', advertiserName: 'Taller' },
            pricing: { model: 'cpm', bidCOP: 5_000 },
            dailyBudgetCOP: 50_000,
            totalBudgetCOP: 500_000,
          }),
        },
      }),
    );
    expect(res.status).toBe(201);
    const parsed = await body(res);
    expect(parsed.campaign?.status).toBe('pending_review');
  });

  it('no deja crear campaña en el anunciante de otro', async () => {
    put('adAdvertiser', { id: 'adv_otro', name: 'Otro', kind: 'workshop', contactEmail: 'o@x.com', balanceCOP: 100_000, ownerUserId: 'usr_2' });
    const { POST } = campaignsRoute;
    const res = await POST(
      ctx('operator', {
        requestInit: {
          method: 'POST',
          body: JSON.stringify({
            advertiserId: 'adv_otro',
            name: 'Intruso',
            creative: { title: 'X', body: 'Y', ctaLabel: 'Ver', url: 'https://x.com', advertiserName: 'Otro' },
            pricing: { model: 'cpm', bidCOP: 3_000 },
            dailyBudgetCOP: 10_000,
            totalBudgetCOP: 100_000,
          }),
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rechaza un creativo con URL http o con texto muy largo', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 1, ownerUserId: 'usr_1' });
    const { POST } = campaignsRoute;
    const base = {
      advertiserId: 'adv_1',
      name: 'X',
      creative: { title: 'T', body: 'B', ctaLabel: 'Ver', url: 'https://x.com', advertiserName: 'A' },
      pricing: { model: 'cpm', bidCOP: 1_000 },
      dailyBudgetCOP: 10_000,
      totalBudgetCOP: 100_000,
    };
    const conUrlHttp = await POST(ctx('operator', { requestInit: { method: 'POST', body: JSON.stringify({ ...base, creative: { ...base.creative, url: 'http://x.com' } }) } }));
    expect(conUrlHttp.status).toBe(400);

    const tituloLargo = await POST(ctx('operator', { requestInit: { method: 'POST', body: JSON.stringify({ ...base, creative: { ...base.creative, title: 'a'.repeat(61) } }) } }));
    expect(tituloLargo.status).toBe(400);
  });

  it('PATCH de la campaña de otro → 403; la propia → 200', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 100_000, ownerUserId: 'usr_1' });
    put('adAdvertiser', { id: 'adv_otro', name: 'O', kind: 'workshop', contactEmail: 'o@x.com', balanceCOP: 100_000, ownerUserId: 'usr_2' });
    put('adCampaign', campaignRow({ id: 'c_mia', advertiserId: 'adv_1' }));
    put('adCampaign', campaignRow({ id: 'c_suya', advertiserId: 'adv_otro' }));

    const { PATCH } = campaignsRoute;
    // PATCH lee el id de la query, así que va en la URL del request.
    const resMia = await PATCH(
      {
        request: new Request('https://x/api/garage/ads/campaigns?id=c_mia', { method: 'PATCH', headers: { cookie: 'session=t' }, body: JSON.stringify({ name: 'Nuevo nombre' }) }),
        params: {},
        locals: { tenant: { instanceId: 'tenant-a' } },
      } as never,
    );
    expect(resMia.status).toBe(200);

    const resSuya = await PATCH(
      {
        request: new Request('https://x/api/garage/ads/campaigns?id=c_suya', { method: 'PATCH', headers: { cookie: 'session=t' }, body: JSON.stringify({ name: 'Me la llevo' }) }),
        params: {},
        locals: { tenant: { instanceId: 'tenant-a' } },
      } as never,
    );
    expect(resSuya.status).toBe(403);
  });

  it('editar el creativo de una campaña activa la devuelve a pending_review', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 100_000, ownerUserId: 'usr_1' });
    put('adCampaign', campaignRow({ id: 'c1', advertiserId: 'adv_1', status: 'active' }));
    const { PATCH } = campaignsRoute;
    const res = await PATCH(
      {
        request: new Request('https://x/api/garage/ads/campaigns?id=c1', {
          method: 'PATCH',
          headers: { cookie: 'session=t' },
          body: JSON.stringify({ creative: { title: 'Otro título', body: 'Otro cuerpo', ctaLabel: 'Ver', url: 'https://x.com', advertiserName: 'T' } }),
        }),
        params: {},
        locals: { tenant: { instanceId: 'tenant-a' } },
      } as never,
    );
    expect(res.status).toBe(200);
    expect((await body(res)).campaign?.status).toBe('pending_review');
  });
});

describe('alta de anunciante', () => {
  beforeEach(() => {
    store.rows.clear();
    sesion('operator');
  });

  const crear = (body: Record<string, unknown>) =>
    advertisersRoute.POST(ctx('operator', { requestInit: { method: 'POST', body: JSON.stringify(body) } }));

  it('crea el anunciante con el correo que se le pasó', async () => {
    const res = await crear({ name: 'Taller Norte', kind: 'workshop', contactEmail: 'norte@ejemplo.com' });
    expect(res.status).toBe(201);
    expect((await body(res)).advertiser?.contactEmail).toBe('norte@ejemplo.com');
  });

  it('un correo vacío cae al de la sesión, que es lo que promete el portal', async () => {
    // Regresión: la ruta usaba `typeof body.contactEmail === 'string' ? body.contactEmail : user.email`,
    // así que un '' (lo que manda el portal cuando el campo queda vacío) se reprobaba como
    // "correo inválido" en vez de usar el correo de la sesión.
    const res = await crear({ name: 'Taller Norte', kind: 'workshop', contactEmail: '' });
    expect(res.status).toBe(201);
    expect((await body(res)).advertiser?.contactEmail).toBe('a@b.c');
  });

  it('nace con saldo 0 y sin verificar: sin saldo no sale en ninguna subasta', async () => {
    const res = await crear({ name: 'Taller Norte', kind: 'workshop', contactEmail: '' });
    const parsed = await body(res);
    const adv = parsed.advertiser as { balanceCOP: number; verified: boolean };
    expect(adv.balanceCOP).toBe(0);
    expect(adv.verified).toBe(false);
  });

  it('rechaza nombre vacío, tipo desconocido y correo mal formado', async () => {
    expect((await crear({ kind: 'workshop', contactEmail: 'a@b.co' })).status).toBe(400);
    expect((await crear({ name: 'X', kind: 'inventado', contactEmail: 'a@b.co' })).status).toBe(400);
    expect((await crear({ name: 'X', kind: 'workshop', contactEmail: 'no-es-correo' })).status).toBe(400);
  });
});

describe('robustez de las rutas de cobro (L1/L2)', () => {
  beforeEach(() => {
    store.rows.clear();
    sesion('operator');
    envMock.ADS_TOKEN_SECRET = SECRET;
    envMock.ENVIRONMENT = 'production';
  });

  const post = (payload: unknown) =>
    impressionRoute.POST(ctx('operator', { requestInit: { method: 'POST', body: JSON.stringify(payload) } }));

  it('un cuerpo POST ilegible responde 400, no una promesa rechazada', async () => {
    // Sin cuerpo: `request.json()` falla y antes eso se propagaba como promesa rechazada.
    const res = await impressionRoute.POST(ctx('operator', { requestInit: { method: 'POST' } }));
    expect(res.status).toBe(400);
  });

  it('un token sin forma responde 400 y no cobra', async () => {
    const res = await post({ token: 'no-es-un-token' });
    expect(res.status).toBe(400);
  });

  it('un token de CPC en la ruta de impresion se rechaza (400)', async () => {
    const token = await signAdToken({
      campaignId: 'c1',
      slot: 'shop_feed',
      userHash: 'u1',
      priceCOP: 400,
      pricingModel: 'cpc',
      now: Date.now(),
    });
    expect((await post({ token })).status).toBe(400);
  });

  it('un token invalido en /click NO redirige al destino del anunciante', async () => {
    // El caso de seguridad: un token manipulado nunca puede llevar al usuario a la URL
    // del anunciante, solo al fallback del garage.
    const res = await clickWithToken('basura');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/fleet/garage');
  });

  it('un clic de una campana inexistente cae al fallback, no a una URL inventada', async () => {
    const token = await signAdToken({
      campaignId: 'no_existe',
      slot: 'shop_feed',
      userHash: 'u1',
      priceCOP: 400,
      pricingModel: 'cpc',
      now: Date.now(),
    });
    const res = await clickWithToken(token);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/fleet/garage');
  });
});

describe('admin: revisión y recarga', () => {
  beforeEach(() => {
    store.rows.clear();
    sesion('operator');
  });

  it('un operator NO revisa campañas', async () => {
    put('adCampaign', campaignRow({ id: 'c1', status: 'pending_review' }));
    const { PATCH } = reviewRoute;
    const res = await PATCH(
      ctx('operator', { params: { id: 'c1' }, requestInit: { method: 'PATCH', body: JSON.stringify({ decision: 'approve' }) } }),
    );
    expect(res.status).toBe(403);
  });

  it('un admin aprueba: la campaña pasa a active', async () => {
    sesion('admin');
    put('adCampaign', campaignRow({ id: 'c1', status: 'pending_review' }));
    const { PATCH } = reviewRoute;
    const res = await PATCH(
      ctx('admin', { params: { id: 'c1' }, requestInit: { method: 'PATCH', body: JSON.stringify({ decision: 'approve' }) } }),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).campaign?.status).toBe('active');
  });

  it('un admin rechaza: la campaña queda rejected', async () => {
    sesion('admin');
    put('adCampaign', campaignRow({ id: 'c1', status: 'pending_review' }));
    const { PATCH } = reviewRoute;
    const res = await PATCH(
      ctx('admin', { params: { id: 'c1' }, requestInit: { method: 'PATCH', body: JSON.stringify({ decision: 'reject' }) } }),
    );
    expect((await body(res)).campaign?.status).toBe('rejected');
  });

  it('no revisa una campaña que no está en revisión (409)', async () => {
    sesion('admin');
    put('adCampaign', campaignRow({ id: 'c1', status: 'active' }));
    const { PATCH } = reviewRoute;
    const res = await PATCH(
      ctx('admin', { params: { id: 'c1' }, requestInit: { method: 'PATCH', body: JSON.stringify({ decision: 'approve' }) } }),
    );
    expect(res.status).toBe(409);
  });

  it('un operator NO recarga saldo', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 0, ownerUserId: 'usr_1' });
    const { POST } = topupRoute;
    const res = await POST(
      ctx('operator', { params: { id: 'adv_1' }, requestInit: { method: 'POST', body: JSON.stringify({ amountCOP: 50_000 }) } }),
    );
    expect(res.status).toBe(403);
  });

  it('un admin recarga y el saldo sube', async () => {
    sesion('admin');
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 10_000, ownerUserId: 'usr_1' });
    const { POST } = topupRoute;
    const res = await POST(
      ctx('admin', { params: { id: 'adv_1' }, requestInit: { method: 'POST', body: JSON.stringify({ amountCOP: 25_000 }) } }),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).advertiser?.balanceCOP).toBe(35_000);
  });

  it('rechaza montos no positivos y el tope de recarga', async () => {
    sesion('admin');
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 0, ownerUserId: 'usr_1' });
    const { POST } = topupRoute;
    const llamar = (amountCOP: number) =>
      POST(ctx('admin', { params: { id: 'adv_1' }, requestInit: { method: 'POST', body: JSON.stringify({ amountCOP }) } }));
    expect((await llamar(0)).status).toBe(400);
    expect((await llamar(-100)).status).toBe(400);
    expect((await llamar(99_000_000)).status).toBe(400);
  });
});

describe('estadísticas: dueño o admin', () => {
  beforeEach(() => {
    store.rows.clear();
    sesion('operator');
  });

  it('el dueño ve sus estadísticas', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 0, ownerUserId: 'usr_1' });
    put('adCampaign', campaignRow({ id: 'c1', advertiserId: 'adv_1' }));
    put('adStat', { campaignId: 'c1', day: '2026-06-01', impressions: 100, clicks: 4, spendCOP: 6_000, freq: {} }, 'c1:2026-06-01');
    const { GET } = statsRoute;
    const res = await GET(ctx('operator', { params: { id: 'c1' } }));
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.totals?.impressions).toBe(100);
    expect(parsed.totals?.clicks).toBe(4);
    expect(parsed.totals?.ctrPct).toBe(4);
    expect(parsed.totals?.cpcRealCOP).toBe(1_500);
  });

  it('otro usuario NO ve esas estadísticas', async () => {
    put('adAdvertiser', { id: 'adv_otro', name: 'O', kind: 'workshop', contactEmail: 'o@x.com', balanceCOP: 0, ownerUserId: 'usr_2' });
    put('adCampaign', campaignRow({ id: 'c1', advertiserId: 'adv_otro' }));
    const { GET } = statsRoute;
    expect((await GET(ctx('operator', { params: { id: 'c1' } }))).status).toBe(403);
  });

  it('un admin sí las ve aunque no sea el dueño', async () => {
    sesion('admin');
    put('adAdvertiser', { id: 'adv_otro', name: 'O', kind: 'workshop', contactEmail: 'o@x.com', balanceCOP: 0, ownerUserId: 'usr_2' });
    put('adCampaign', campaignRow({ id: 'c1', advertiserId: 'adv_otro' }));
    const { GET } = statsRoute;
    expect((await GET(ctx('admin', { params: { id: 'c1' } }))).status).toBe(200);
  });
});

describe('clic: solo redirige a https validado', () => {
  beforeEach(() => {
    store.rows.clear();
    sesion('operator');
  });

  async function tokenValido(precio = 400): Promise<string> {
    return signAdToken({ campaignId: 'c1', slot: 'shop_feed', userHash: 'u1', priceCOP: precio, pricingModel: 'cpc', now: Date.now() });
  }

  it('redirige a la URL https de la campaña y cobra el clic', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 50_000, ownerUserId: 'usr_1' });
    put('adCampaign', campaignRow({ id: 'c1', advertiserId: 'adv_1', pricing: { model: 'cpc', bidCOP: 400 } }));

    const t = await tokenValido(400);
    // Se llama con el token en la query, que es como llega desde el href del anuncio.
    const { GET } = clickRoute;
    const real = await GET({
      request: new Request(`https://x/api/garage/ads/click?t=${encodeURIComponent(t)}`, { headers: { cookie: 'session=t' } }),
      params: {},
      locals: { tenant: { instanceId: 'tenant-a' } },
    } as never);
    expect(real.status).toBe(302);
    expect(real.headers.get('Location')).toBe('https://tienda.example.com');
  });

  it('con el token alterado NO redirige al destino del anuncio: cae en /fleet/garage', async () => {
    put('adCampaign', campaignRow({ id: 'c1', pricing: { model: 'cpc', bidCOP: 400 } }));
    const t = await tokenValido(400);
    const body = t.split('.')[0];
    const payload = JSON.parse(atob(body)) as Record<string, unknown>;
    payload.priceCOP = 1; // wanting to charge 1 COP
    const forjado = `${btoa(JSON.stringify(payload))}.${t.split('.')[1]}`;

    const { GET } = clickRoute;
    const res = await GET({
      request: new Request(`https://x/api/garage/ads/click?t=${encodeURIComponent(forjado)}`, { headers: { cookie: 'session=t' } }),
      params: {},
      locals: { tenant: { instanceId: 'tenant-a' } },
    } as never);
    expect(res.status).toBe(302);
    // Cae al garage, NO a la URL del anunciante ni a un javascript: del payload.
    expect(res.headers.get('Location')).toBe('/fleet/garage');
  });

  it('sin token cae en /fleet/garage', async () => {
    const { GET } = clickRoute;
    const res = await GET({
      request: new Request('https://x/api/garage/ads/click', { headers: { cookie: 'session=t' } }),
      params: {},
      locals: { tenant: { instanceId: 'tenant-a' } },
    } as never);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/fleet/garage');
  });

  it('una campaña con URL no https tampoco se redirige ahí', async () => {
    put('adCampaign', campaignRow({
      id: 'c1',
      pricing: { model: 'cpc', bidCOP: 400 },
      creative: { title: 'X', body: 'Y', ctaLabel: 'Ver', url: 'javascript:alert(1)', advertiserName: 'Malo' },
    }));
    const t = await tokenValido(400);
    const { GET } = clickRoute;
    const res = await GET({
      request: new Request(`https://x/api/garage/ads/click?t=${encodeURIComponent(t)}`, { headers: { cookie: 'session=t' } }),
      params: {},
      locals: { tenant: { instanceId: 'tenant-a' } },
    } as never);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/fleet/garage');
  });

  it('un clic repetido con el mismo token cobra una sola vez', async () => {
    put('adAdvertiser', { id: 'adv_1', name: 'T', kind: 'workshop', contactEmail: 't@x.com', balanceCOP: 50_000, ownerUserId: 'usr_1' });
    put('adCampaign', campaignRow({ id: 'c1', advertiserId: 'adv_1', pricing: { model: 'cpc', bidCOP: 400 } }));
    const t = await tokenValido(400);
    const { GET } = clickRoute;
    const llamar = () =>
      GET({
        request: new Request(`https://x/api/garage/ads/click?t=${encodeURIComponent(t)}`, { headers: { cookie: 'session=t' } }),
        params: {},
        locals: { tenant: { instanceId: 'tenant-a' } },
      } as never);
    await llamar();
    await llamar();

    const adv = await getAdvertiser('adv_1');
    // 50.000 - 400 = 49.600: un solo cobro, aunque el clic llegara dos veces.
    expect(adv?.balanceCOP).toBe(49_600);
  });
});

describe('la ruta de serving toma el vehículo del tenant de la sesión', () => {
  beforeEach(() => {
    store.rows.clear();
    sesion('operator');
  });

  it('sin vehicleId responde 400, no sirve nada', async () => {
    const { GET } = serveRoute;
    const res = await GET({
      request: new Request('https://x/api/garage/ads/serve?slot=shop_feed', { headers: { cookie: 'session=t' } }),
      params: {},
      locals: { tenant: { instanceId: 'tenant-a' } },
    } as never);
    expect(res.status).toBe(400);
  });

  it('con slot desconocido responde 400', async () => {
    const { GET } = serveRoute;
    const res = await GET({
      request: new Request('https://x/api/garage/ads/serve?slot=inventado&vehicleId=v1', { headers: { cookie: 'session=t' } }),
      params: {},
      locals: { tenant: { instanceId: 'tenant-a' } },
    } as never);
    expect(res.status).toBe(400);
  });

  it('un vehículo de otro tenant no existe para esta sesión (404)', async () => {
    // El vehículo vive en 'tenant-b'; la sesión es de 'tenant-a'.
    store.rows.set('vehicle/v9', { id: 'v9', instance_id: 'tenant-b', data: { id: 'v9', make: 'Yamaha', model: 'FZ16', type: 'moto' } });
    const { GET } = serveRoute;
    const res = await GET({
      request: new Request('https://x/api/garage/ads/serve?slot=shop_feed&vehicleId=v9', { headers: { cookie: 'session=t' } }),
      params: {},
      locals: { tenant: { instanceId: 'tenant-a' } },
    } as never);
    expect(res.status).toBe(404);
  });
});