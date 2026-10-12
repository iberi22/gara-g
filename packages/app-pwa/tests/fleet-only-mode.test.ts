/**
 * tests/fleet-only-mode.test.ts — entrega "solo flota" (FLEET_ONLY) y tenant desde la sesion.
 *
 * 1. Con FLEET_ONLY encendido (valor "true" o variable ausente), las paginas y APIs de Mercado,
 *    Wallet, DePIN y V2V responden 404 desde el middleware, con o sin sesion, y no salen en el
 *    menu ni en la portada. Con FLEET_ONLY="false" todo sigue como antes.
 * 2. En /api/fleet/* el tenant sale de la sesion (KV SESSION). Un instanceId del cliente
 *    (query, cabecera o cuerpo) distinto del de la sesion se rechaza con 403.
 *
 * Import ESTATICO del middleware: ver la nota de tests/middleware-auth.test.ts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { onRequest } from '../src/middleware.js';
import {
  FLEET_ONLY_HIDDEN_PREFIXES,
  isFleetOnly,
  isHiddenByFleetOnly,
  isRouteHidden,
} from '../src/lib/features.js';
import { clientTenantMismatch } from '../src/lib/fleetApi.js';

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const envMock = env as unknown as Record<string, unknown>;

const SESSION_TENANT = 'flota-chile-01';
const OTHER_TENANT = 'flota-de-otro-cliente';

function ctx(path: string, init: RequestInit = {}) {
  const cookie = (init.headers as Record<string, string>)?.cookie ?? '';
  const jar = Object.fromEntries(
    cookie.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v),
  ) as Record<string, string>;
  return {
    url: new URL(`https://gara-g.swal.network${path}`),
    request: new Request(`https://gara-g.swal.network${path}`, init),
    cookies: { get: (k: string) => (jar[k] ? { value: jar[k] } : undefined) },
    locals: {} as Record<string, unknown>,
    redirect: (to: string, code: number) =>
      new Response(null, { status: code, headers: { Location: to } }),
  } as any;
}

const next = async () => new Response('NEXT', { status: 200 });

function withSession(role = 'admin') {
  mockKv.get.mockResolvedValue(
    JSON.stringify({
      userId: 'usr_cl_01',
      email: 'jefe@volquetas.cl',
      role,
      instanceId: SESSION_TENANT,
      exp: Date.now() + 60_000,
    }),
  );
}

const SESSION = { cookie: 'session=token-real; gara_onb=usr_cl_01' };

/** Rutas reales de la PWA que FLEET_ONLY oculta (pagina y API). */
const HIDDEN_ROUTES = [
  '/fleet/mercado',
  '/fleet/mercado/',
  '/fleet/mercado/vender',
  '/fleet/radar',
  '/fleet/garage/anunciantes',
  '/api/garage/ads/serve',
  '/api/garage/ads/advertisers',
  '/api/garage/ads/advertisers/adv_1/topup',
  '/api/garage/ads/campaigns',
  '/api/garage/shop',
];

/** Rutas de la entrega: siguen visibles con FLEET_ONLY encendido. */
const FLEET_ROUTES = [
  '/fleet/vehicles',
  '/fleet/drivers',
  '/fleet/maintenance',
  '/fleet/fuel-logs',
  '/fleet/documents',
  '/fleet/geofences',
  '/fleet/alerts',
  '/fleet/garage',
  '/api/fleet/vehicle',
];

beforeEach(() => {
  vi.clearAllMocks();
  mockKv.get.mockResolvedValue(null);
  mockKv.put.mockResolvedValue(undefined);
  envMock.SESSION = mockKv;
  envMock.SWAL_KV = mockKv;
  delete envMock.SWAL_D1;
  envMock.ENVIRONMENT = 'production';
  delete envMock.FLEET_ONLY;
  delete envMock.PUBLIC_DEMO;
});

describe('isFleetOnly: un solo interruptor, encendido por defecto', () => {
  it('sin la variable queda encendido (un deploy sin la var no reabre nada)', () => {
    expect(isFleetOnly()).toBe(true);
  });

  it.each(['true', '1', 'TRUE', ' yes '])('"%s" lo enciende', (v) => {
    envMock.FLEET_ONLY = v;
    expect(isFleetOnly()).toBe(true);
  });

  it.each(['false', '0', 'off', 'no', 'FALSE'])('"%s" lo apaga', (v) => {
    envMock.FLEET_ONLY = v;
    expect(isFleetOnly()).toBe(false);
  });

  it('el booleano false tambien lo apaga', () => {
    envMock.FLEET_ONLY = false;
    expect(isFleetOnly()).toBe(false);
  });
});

describe('isHiddenByFleetOnly: prefijo de segmento', () => {
  it('cubre la ruta y sus hijas', () => {
    for (const r of HIDDEN_ROUTES) expect(isHiddenByFleetOnly(r), r).toBe(true);
  });

  it('no cubre rutas que solo comparten el prefijo de texto', () => {
    expect(isHiddenByFleetOnly('/fleet/radarx')).toBe(false);
    expect(isHiddenByFleetOnly('/fleet/mercadolibre')).toBe(false);
    expect(isHiddenByFleetOnly('/api/garage/shopping')).toBe(false);
  });

  it('no toca nada de la entrega de flota', () => {
    for (const r of FLEET_ROUTES) expect(isHiddenByFleetOnly(r), r).toBe(false);
    expect(isHiddenByFleetOnly('/fleet')).toBe(false);
    expect(isHiddenByFleetOnly('/api/mesh/room-key')).toBe(false);
  });

  it('isRouteHidden respeta el interruptor', () => {
    envMock.FLEET_ONLY = 'false';
    expect(isRouteHidden('/fleet/mercado')).toBe(false);
    envMock.FLEET_ONLY = 'true';
    expect(isRouteHidden('/fleet/mercado')).toBe(true);
  });
});

describe('middleware con FLEET_ONLY encendido: rutas ocultas → 404', () => {
  it.each([['"true"', 'true'], ['ausente', undefined]])('FLEET_ONLY %s, con sesion', async (_l, v) => {
    if (v !== undefined) envMock.FLEET_ONLY = v;
    withSession();
    for (const path of HIDDEN_ROUTES) {
      const res = await onRequest(ctx(path, { headers: SESSION }), next);
      expect(res.status, path).toBe(404);
    }
  });

  it('sin sesion tambien 404 (no 401/303: no se anuncia que la ruta existe)', async () => {
    envMock.FLEET_ONLY = 'true';
    for (const path of HIDDEN_ROUTES) {
      const res = await onRequest(ctx(path), next);
      expect(res.status, path).toBe(404);
    }
  });

  it('en modo invitado tambien 404 (antes /fleet/mercado y /fleet/radar abrian sin cuenta)', async () => {
    envMock.FLEET_ONLY = 'true';
    for (const path of ['/fleet/mercado', '/fleet/radar']) {
      const res = await onRequest(ctx(path, { headers: { cookie: 'gara_mode=guest' } }), next);
      expect(res.status, path).toBe(404);
    }
  });

  it('las APIs ocultas responden JSON', async () => {
    envMock.FLEET_ONLY = 'true';
    withSession();
    const res = await onRequest(ctx('/api/garage/ads/serve', { headers: SESSION }), next);
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: false, error: 'Not found' });
  });

  it('el 404 no depende del metodo (un POST a la recarga de saldo tampoco llega)', async () => {
    envMock.FLEET_ONLY = 'true';
    withSession();
    const res = await onRequest(
      ctx('/api/garage/ads/advertisers/adv_1/topup', {
        method: 'POST',
        headers: { ...SESSION, 'content-type': 'application/json' },
        body: JSON.stringify({ amountCOP: 50000 }),
      }),
      next,
    );
    expect(res.status).toBe(404);
  });

  it('las rutas de flota siguen respondiendo', async () => {
    envMock.FLEET_ONLY = 'true';
    withSession();
    for (const path of FLEET_ROUTES) {
      const res = await onRequest(ctx(path, { headers: SESSION }), next);
      expect(res.status, path).toBe(200);
    }
  });
});

describe('middleware con FLEET_ONLY="false": comportamiento de siempre', () => {
  beforeEach(() => {
    envMock.FLEET_ONLY = 'false';
  });

  it('con sesion, las rutas ocultas vuelven a pasar', async () => {
    withSession();
    for (const path of HIDDEN_ROUTES) {
      const res = await onRequest(ctx(path, { headers: SESSION }), next);
      expect(res.status, path).toBe(200);
    }
  });

  it('en modo invitado, mercado y radar abren sin cuenta como antes', async () => {
    for (const path of ['/fleet/mercado', '/fleet/radar']) {
      const res = await onRequest(ctx(path, { headers: { cookie: 'gara_mode=guest' } }), next);
      expect(res.status, path).toBe(200);
    }
  });

  it('sin sesion, las APIs piden autenticacion (401) en vez de 404', async () => {
    const res = await onRequest(ctx('/api/garage/ads/serve'), next);
    expect(res.status).toBe(401);
  });
});

// --- Menu, portada y enlaces -------------------------------------------------

const ROOT = join(import.meta.dirname, '..');
const LAYOUT = readFileSync(join(ROOT, 'src/layouts/FleetLayout.astro'), 'utf8');
const LANDING = readFileSync(join(ROOT, 'src/pages/index.astro'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('el menu y la portada no muestran los modulos ocultos', () => {
  it('FleetLayout filtra los items del menu con isRouteHidden', () => {
    expect(LAYOUT).toMatch(/import \{ isRouteHidden \} from '\.\.\/lib\/features'/);
    expect(LAYOUT).toMatch(/const navItems = allNavItems\.filter\(\(item\) => !isRouteHidden\(item\.href\)\)/);
    // El render usa navView, que sale de navItems (ya filtrado), no de la lista completa.
    expect(LAYOUT).toMatch(/const navView = navItems\.map/);
    expect(LAYOUT).not.toMatch(/allNavItems\.map/);
  });

  it('cada item de menu de Mercado/V2V cae bajo un prefijo oculto', () => {
    const hrefs = [...LAYOUT.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
    const ocultos = hrefs.filter((h) => isHiddenByFleetOnly(h));
    expect(ocultos.sort()).toEqual(['/fleet/mercado', '/fleet/radar']);
  });

  it('la portada quita la tarjeta del Mercado y su FAQ de pagos con FLEET_ONLY', () => {
    expect(LANDING).toMatch(/FLEET_ONLY_HIDDEN_LANDING_FEATURES/);
    expect(LANDING).toMatch(/const faqs = fleetOnly \? allFaqs\.filter\(\(f\) => !f\.mercado\) : allFaqs/);
    expect(LANDING).toMatch(/id: 'mercado'/); // sigue ahi para FLEET_ONLY=false
  });

  it('ninguna pagina ni componente de flota enlaza a una ruta oculta', () => {
    // Los propios modulos ocultos (y el layout, que filtra) se excluyen: sus enlaces internos
    // solo se ven dentro de paginas que ya responden 404.
    const excluidos = [
      'src/pages/fleet/mercado/',
      'src/pages/fleet/radar.astro',
      'src/pages/fleet/garage/anunciantes.astro',
      'src/pages/api/',
      'src/components/mercado/',
      'src/components/v2v/',
      'src/components/garage-ads/',
      'src/layouts/FleetLayout.astro',
    ];
    const ficheros = [...walk(join(ROOT, 'src/pages')), ...walk(join(ROOT, 'src/components')), ...walk(join(ROOT, 'src/layouts'))]
      .filter((f) => /\.(astro|svelte)$/.test(f))
      .filter((f) => !excluidos.some((e) => relative(ROOT, f).startsWith(e)));
    const enlace = new RegExp(
      `(href|action)=\\{?["'\`](${FLEET_ONLY_HIDDEN_PREFIXES.map((p) => p.replaceAll('/', '\\/')).join('|')})(["'\`/?#])`,
    );
    const culpables = ficheros.filter((f) => enlace.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(culpables).toEqual([]);
  });
});

// --- Tenant desde la sesion --------------------------------------------------

describe('cross-tenant: un instanceId del cliente distinto del de la sesion → 403', () => {
  beforeEach(() => withSession());

  const casos: Array<[string, string, RequestInit]> = [
    ['?instanceId=', `/api/fleet/vehicle?instanceId=${OTHER_TENANT}`, {}],
    ['?instance_id=', `/api/fleet/vehicle?instance_id=${OTHER_TENANT}`, {}],
    ['cabecera x-instance-id', '/api/fleet/vehicle', { headers: { 'x-instance-id': OTHER_TENANT } }],
    [
      'cuerpo JSON instanceId',
      '/api/fleet/vehicle',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plate: 'AB-1234', instanceId: OTHER_TENANT }) },
    ],
    [
      'cuerpo JSON instance_id (PATCH)',
      '/api/fleet/vehicle?id=v1',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instance_id: OTHER_TENANT }) },
    ],
    [
      'formulario urlencoded',
      '/api/fleet/vehicle',
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `plate=AB-1234&instanceId=${OTHER_TENANT}` },
    ],
    ['export CSV', `/api/fleet/vehicle/export?instanceId=${OTHER_TENANT}&format=csv`, {}],
    ['stats', `/api/fleet/stats?instanceId=${OTHER_TENANT}`, {}],
    ['telemetria', `/api/fleet/telemetry?recent=1&instanceId=${OTHER_TENANT}`, {}],
    ['el mismo tenant y otro a la vez', `/api/fleet/vehicle?instanceId=${SESSION_TENANT}&instanceId=${OTHER_TENANT}`, {}],
  ];

  it.each(casos)('%s', async (_label, path, init) => {
    const headers = { ...((init.headers as Record<string, string>) ?? {}), ...SESSION };
    const c = ctx(path, { ...init, headers });
    let llegó = false;
    const res = await onRequest(c, async () => {
      llegó = true;
      return new Response('NEXT', { status: 200 });
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'instanceId no corresponde a la sesion' });
    expect(llegó, 'el endpoint no debe ejecutarse').toBe(false);
  });

  it('el mismo tenant de la sesion se acepta (las paginas lo envian asi)', async () => {
    const c = ctx(`/api/fleet/vehicle?instanceId=${SESSION_TENANT}`, { headers: SESSION });
    const res = await onRequest(c, next);
    expect(res.status).toBe(200);
    expect((c.locals as any).tenant?.instanceId).toBe(SESSION_TENANT);
  });

  it('sin instanceId del cliente, el tenant sale de la sesion', async () => {
    const c = ctx('/api/fleet/vehicle', { headers: SESSION });
    const res = await onRequest(c, next);
    expect(res.status).toBe(200);
    expect((c.locals as any).tenant?.instanceId).toBe(SESSION_TENANT);
  });

  it('el endpoint todavia puede leer el cuerpo tras la comprobacion', async () => {
    const body = JSON.stringify({ plate: 'AB-1234', instanceId: SESSION_TENANT });
    const c = ctx('/api/fleet/vehicle', {
      method: 'POST',
      headers: { ...SESSION, 'content-type': 'application/json' },
      body,
    });
    let leido: unknown = null;
    const res = await onRequest(c, async () => {
      leido = await c.request.json();
      return new Response('NEXT', { status: 200 });
    });
    expect(res.status).toBe(200);
    expect(leido).toEqual(JSON.parse(body));
  });
});

describe('clientTenantMismatch (helper puro)', () => {
  const r = (url: string, init: RequestInit = {}) => new Request(`https://x${url}`, init);

  it('nada declarado → no hay mismatch', async () => {
    expect(await clientTenantMismatch(r('/api/fleet/vehicle'), 'a')).toBe(false);
  });

  it('valor vacio no cuenta como intento', async () => {
    expect(await clientTenantMismatch(r('/api/fleet/vehicle?instanceId='), 'a')).toBe(false);
  });

  it('distinto → mismatch; igual → no', async () => {
    expect(await clientTenantMismatch(r('/api/fleet/vehicle?instanceId=b'), 'a')).toBe(true);
    expect(await clientTenantMismatch(r('/api/fleet/vehicle?instanceId=a'), 'a')).toBe(false);
  });

  it('cuerpo JSON ilegible no lanza', async () => {
    const req = r('/api/fleet/vehicle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{no-json' });
    expect(await clientTenantMismatch(req, 'a')).toBe(false);
  });
});
