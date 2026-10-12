/**
 * api-routes.test.ts — Las rutas de comunidad: 401, 400, 429, 403 y 409.
 *
 * Estos casos EJECUTAN los handlers de `src/pages/api/garage/{forum,wiki}` con un
 * `Request` de verdad, contra el storage en memoria, y comprueban los codigos de
 * respuesta. El patron es el de tests/fleet-stats-tenancy.test.ts: sesion real
 * inyectada por el mock de `cloudflare:workers`, y `ENVIRONMENT=production` para que
 * `getAuthUser` no aplique su fallback de desarrollo (que da admin a cualquiera).
 *
 * Los roles se prueban con dos sesiones reales (admin y operator), porque el
 * "solo admin" se decide en la RUTA y no en la logica: si alguien moviera el
 * chequeo a la capa de dominio, este test pasaria igual.
 *
 * `rutaForo`/`rutaHilo`/`rutaWiki` inyectan el `params` que Astro pasaria. Sin el,
 * los handlers revientan al leer `params.versionKey` y responden 500 en vez del
 * 400 que el test espera: asi se manifestaba un `params` olvidado.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { getMemoryAdapter, setStorageAdapter } from '../../lib/domain';
import type { ForumThread, WikiPage } from '../contracts';
import { resetCommunitySecretCache } from './identity';
import { resetRateLimits } from './rateLimit';

const envMock = env as unknown as Record<string, unknown>;

const SESSION_JSON = {
  admin: { userId: 'usr_admin', email: 'admin@gara-g.swal.network', role: 'admin' },
  operator: { userId: 'usr_op', email: 'op@cliente-a.com', role: 'operator' },
};

/** Sesion valida en KV para un token concreto. */
function sesion(rol: keyof typeof SESSION_JSON, token = `tok-${rol}`): void {
  const users: Record<string, typeof SESSION_JSON.admin> = SESSION_JSON;
  envMock.SESSION = {
    get: async (k: string) =>
      k === `token:${token}`
        ? JSON.stringify({ ...users[rol], exp: Date.now() + 3_600_000 })
        : null,
    delete: async () => undefined,
  };
  envMock.ENVIRONMENT = 'production';
}

const POST_INIT = { method: 'POST', body: '{}' };
const V_FZ16 = 'yamaha-fz16-2019-2024';
const V_VIEJA = 'yamaha-fz16-2015-2018';

beforeEach(() => {
  getMemoryAdapter().clear();
  setStorageAdapter(getMemoryAdapter());
  resetRateLimits();
  resetCommunitySecretCache();
  envMock.ENVIRONMENT = 'production';
  envMock.COMMUNITY_SECRET = 'secreto-de-prueba';
  sesion('admin');
});

/**
 * Contexto de invocacion de un handler de ruta.
 *
 * `params` NO es opcional: los handlers leen `params.versionKey` / `params.id` /
 * `params.sectionId`, asi que un contexto sin `params` revienta con un TypeError y
 * la ruta responde 500 en vez del codigo que el test comprueba.
 */
function ruta(
  url: string,
  init: RequestInit = {},
  token = 'tok-admin',
  params: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as object),
  };
  if (token) headers.cookie = `session=${token}`;
  return { request: new Request(url, { ...init, headers }), locals: {}, params } as never;
}

function rutaForo(versionKey: string, init: RequestInit = {}) {
  return ruta(`https://x.swal.network/api/garage/forum/${versionKey}`, init, 'tok-admin', {
    versionKey,
  });
}

function rutaHilo(id: string, init: RequestInit = {}, token = 'tok-admin') {
  return ruta(`https://x.swal.network/api/garage/forum/thread/${id}`, init, token, { id });
}

function rutaWiki(versionKey: string, init: RequestInit = {}) {
  return ruta(`https://x.swal.network/api/garage/wiki/${versionKey}`, init, 'tok-admin', {
    versionKey,
  });
}

function rutaWikiSeccion(versionKey: string, sectionId: string, init: RequestInit = {}) {
  return ruta(
    `https://x.swal.network/api/garage/wiki/${versionKey}/${sectionId}`,
    init,
    'tok-admin',
    { versionKey, sectionId },
  );
}

/** Peticion sin cookie de sesion, con `params` para no romper antes del 401. */
function anon(url: string, init: RequestInit = {}, params: Record<string, string> = {}): never {
  return {
    request: new Request(url, { ...init, headers: { 'content-type': 'application/json' } }),
    locals: {},
    params,
  } as never;
}

/**
 * Lee el JSON de una respuesta con tipo: `Response.json()` es `unknown` bajo
 * `strict`, asi que sin esto cada `body.thread` seria un error de compilacion.
 */
async function body<T = Record<string, any>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Crea un hilo por la ruta y devuelve el hilo del JSON de respuesta. */
async function crearHilo(versionKey = V_FZ16, titulo = 'Hilo de prueba'): Promise<ForumThread> {
  const { POST } = await import('../../pages/api/garage/forum/[versionKey].js');
  const res = await POST(
    rutaForo(versionKey, {
      method: 'POST',
      body: JSON.stringify({ title: titulo, body: 'contenido del mensaje' }),
    }),
  );
  const { thread } = await body<{ thread: ForumThread }>(res);
  return thread;
}

describe('401 sin sesion', () => {
  it('el listado de hilos responde 401', async () => {
    const { GET } = await import('../../pages/api/garage/forum/[versionKey].js');
    const res = await GET(
      anon(`https://x.swal.network/api/garage/forum/${V_FZ16}`, {}, { versionKey: V_FZ16 }),
    );
    expect(res.status).toBe(401);
  });

  it('crear un hilo responde 401', async () => {
    const { POST } = await import('../../pages/api/garage/forum/[versionKey].js');
    const res = await POST(
      anon(
        `https://x.swal.network/api/garage/forum/${V_FZ16}`,
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Hilo anonimo', body: 'no deberia guardarse' }),
        },
        { versionKey: V_FZ16 },
      ),
    );
    expect(res.status).toBe(401);
  });

  it('responder a un hilo responde 401', async () => {
    const { POST } = await import('../../pages/api/garage/forum/thread/[id].js');
    const res = await POST(
      anon('https://x.swal.network/api/garage/forum/thread/abc', POST_INIT, { id: 'abc' }),
    );
    expect(res.status).toBe(401);
  });

  it('moderar responde 401', async () => {
    const { PATCH } = await import('../../pages/api/garage/forum/thread/[id].js');
    const res = await PATCH(
      anon(
        'https://x.swal.network/api/garage/forum/thread/abc',
        { method: 'PATCH', body: '{"locked":true}' },
        { id: 'abc' },
      ),
    );
    expect(res.status).toBe(401);
  });

  it('leer la wiki responde 401', async () => {
    const { GET } = await import('../../pages/api/garage/wiki/[versionKey].js');
    const res = await GET(
      anon(`https://x.swal.network/api/garage/wiki/${V_FZ16}`, {}, { versionKey: V_FZ16 }),
    );
    expect(res.status).toBe(401);
  });

  it('editar la wiki responde 401', async () => {
    const { PUT } = await import('../../pages/api/garage/wiki/[versionKey]/[sectionId].js');
    const res = await PUT(
      anon(
        `https://x.swal.network/api/garage/wiki/${V_FZ16}/fallas-comunes`,
        { method: 'PUT', body: JSON.stringify({ body: 'texto', baseRevision: 0 }) },
        { versionKey: V_FZ16, sectionId: 'fallas-comunes' },
      ),
    );
    expect(res.status).toBe(401);
  });
});

describe('400 con versionKey invalida', () => {
  it('rechaza una versionKey que no es slug', async () => {
    const { GET } = await import('../../pages/api/garage/forum/[versionKey].js');
    for (const key of ['Yamaha FZ16', 'yamaha_fz16', '../etc/passwd', '']) {
      const res = await GET(rutaForo(key));
      expect(res.status, `versionKey "${key}"`).toBe(400);
    }
  });

  it('rechaza al crear un hilo con versionKey invalida', async () => {
    const { POST } = await import('../../pages/api/garage/forum/[versionKey].js');
    const res = await POST(
      rutaForo('NO VALIDA', {
        method: 'POST',
        body: JSON.stringify({ title: 'Titulo valido', body: 'cuerpo' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rechaza leer la wiki con versionKey invalida', async () => {
    const { GET } = await import('../../pages/api/garage/wiki/[versionKey].js');
    const res = await GET(rutaWiki('Version Con Espacios'));
    expect(res.status).toBe(400);
  });

  it('rechaza editar la wiki con versionKey invalida', async () => {
    const { PUT } = await import('../../pages/api/garage/wiki/[versionKey]/[sectionId].js');
    const res = await PUT(
      rutaWikiSeccion('Version Con Espacios', 'fallas-comunes', {
        method: 'PUT',
        body: JSON.stringify({ body: 'texto', baseRevision: 0 }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('403: moderar es solo de admin', () => {
  it('un operator no puede fijar ni cerrar', async () => {
    const thread = await crearHilo();
    sesion('operator');
    const { PATCH } = await import('../../pages/api/garage/forum/thread/[id].js');
    const res = await PATCH(
      rutaHilo(
        thread.id,
        { method: 'PATCH', body: JSON.stringify({ locked: true }) },
        'tok-operator',
      ),
    );
    expect(res.status).toBe(403);
  });

  it('un admin si puede', async () => {
    const thread = await crearHilo();
    const { PATCH } = await import('../../pages/api/garage/forum/thread/[id].js');
    const res = await PATCH(
      rutaHilo(thread.id, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: true, locked: true }),
      }),
    );
    expect(res.status).toBe(200);
    const b = await body<{ thread: { pinned: boolean; locked: boolean } }>(res);
    expect(b.thread.pinned).toBe(true);
    expect(b.thread.locked).toBe(true);
  });
});

describe('wiki por la ruta: 403 en seccion de catalogo, 404 en seccion inexistente', () => {
  it('editar una seccion de catalogo responde 403', async () => {
    const { PUT } = await import('../../pages/api/garage/wiki/[versionKey]/[sectionId].js');
    const res = await PUT(
      rutaWikiSeccion(V_FZ16, 'especificaciones', {
        method: 'PUT',
        body: JSON.stringify({ body: 'motor inventado', baseRevision: 0 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('editar una seccion que no existe responde 404', async () => {
    const { PUT } = await import('../../pages/api/garage/wiki/[versionKey]/[sectionId].js');
    const res = await PUT(
      rutaWikiSeccion(V_FZ16, 'seccion-fantasma', {
        method: 'PUT',
        body: JSON.stringify({ body: 'texto', baseRevision: 0 }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('la edicion con la revision correcta responde 200 y con la vieja 409', async () => {
    const { PUT } = await import('../../pages/api/garage/wiki/[versionKey]/[sectionId].js');
    const put = (texto: string, baseRevision: number) =>
      rutaWikiSeccion(V_FZ16, 'fallas-comunes', {
        method: 'PUT',
        body: JSON.stringify({ body: texto, baseRevision }),
      });

    const buena = await PUT(put('Texto valido', 0));
    expect(buena.status).toBe(200);
    const tras = await body<{ page: WikiPage }>(buena);
    expect(tras.page.revision).toBe(1);

    const vieja = await PUT(put('Texto sobre base vieja', 0));
    expect(vieja.status).toBe(409);
    const cuerpo = await body<{ page: WikiPage }>(vieja);
    // El 409 trae la pagina vigente para que el cliente resuelva el conflicto.
    expect(cuerpo.page.sections.find((s) => s.id === 'fallas-comunes')?.body).toBe('Texto valido');
  });
});

describe('409 al responder a un hilo cerrado', () => {
  it('un hilo locked devuelve 409 y no crea la respuesta', async () => {
    const hilo = await import('../../pages/api/garage/forum/thread/[id].js');
    const thread = await crearHilo();

    const cierre = await hilo.PATCH(
      rutaHilo(thread.id, { method: 'PATCH', body: JSON.stringify({ locked: true }) }),
    );
    expect(cierre.status).toBe(200);

    const respuesta = await hilo.POST(
      rutaHilo(thread.id, { method: 'POST', body: JSON.stringify({ body: 'una mas' }) }),
    );
    expect(respuesta.status).toBe(409);
  });
});

describe('429 con Retry-After', () => {
  it('el sexto mensaje en 10 min se rechaza con el cabecero Retry-After', async () => {
    const { POST } = await import('../../pages/api/garage/forum/[versionKey].js');
    const post = (i: number) =>
      rutaForo(V_FZ16, {
        method: 'POST',
        body: JSON.stringify({ title: `Hilo de ritmo numero ${i}`, body: 'contenido' }),
      });

    for (let i = 0; i < 5; i++) {
      const res = await POST(post(i));
      expect(res.status, `mensaje ${i + 1}`).toBe(201);
    }

    const sexto = await POST(post(6));
    expect(sexto.status).toBe(429);
    const retryAfter = Number(sexto.headers.get('Retry-After'));
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
  });

  it('editar la wiki tambien cuenta para el limite de ritmo', async () => {
    const { PUT } = await import('../../pages/api/garage/wiki/[versionKey]/[sectionId].js');
    const put = (texto: string, baseRevision: number) =>
      rutaWikiSeccion(V_FZ16, 'consejos', {
        method: 'PUT',
        body: JSON.stringify({ body: texto, baseRevision }),
      });

    // Tras cada edicion ACEPTADA la revision de la seccion sube en 1, asi que para
    // editar otra vez el `baseRevision` correcto es el numero de ediciones ya hechas:
    // 1 tras la primera, 2 tras la segunda...
    const primera = await PUT(put('Consejo 0', 0));
    expect(primera.status, 'primera edicion').toBe(200);
    // 4 mas completan las 5 del tope de 10 min.
    for (let rev = 1; rev <= 4; rev++) {
      const res = await PUT(put(`Consejo ${rev}`, rev));
      expect(res.status, `edicion ${rev}`).toBe(200);
    }
    // La sexta lleva `baseRevision` viejo a proposito: el ritmo se comprueba ANTES
    // que la revision, asi que el 429 tiene que ganar al 409 (al usuario le basta con
    // esperar, no con recargar).
    const sexta = await PUT(put('Consejo por encima del tope', 5));
    expect(sexta.status).toBe(429);
    expect(Number(sexta.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(sexta.headers.get('Retry-After')).toBe('600');
  });
});

describe('foro por la ruta', () => {
  it('crear y listar hilos de una version, aislados de otra', async () => {
    const { GET, POST } = await import('../../pages/api/garage/forum/[versionKey].js');
    const creado = await POST(
      rutaForo(V_FZ16, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Hilo de la version nueva',
          body: 'cuerpo',
          tags: ['frenos'],
        }),
      }),
    );
    expect(creado.status).toBe(201);
    const { thread } = await body<{ thread: ForumThread }>(creado);
    expect(thread.versionKey).toBe(V_FZ16);
    expect(thread.tags).toEqual(['frenos']);

    const nueva = await GET(rutaForo(V_FZ16));
    const vieja = await GET(rutaForo(V_VIEJA));
    expect((await body<{ threads: ForumThread[] }>(nueva)).threads).toHaveLength(1);
    expect((await body<{ threads: ForumThread[] }>(vieja)).threads).toHaveLength(0);
  });

  it('crear un hilo con titulo demasiado corto responde 400', async () => {
    const { POST } = await import('../../pages/api/garage/forum/[versionKey].js');
    const res = await POST(
      rutaForo(V_FZ16, { method: 'POST', body: JSON.stringify({ title: 'RDT', body: 'cuerpo' }) }),
    );
    expect(res.status).toBe(400);
  });

  it('el listado nunca expone el userId del autor', async () => {
    const { GET } = await import('../../pages/api/garage/forum/[versionKey].js');
    await crearHilo();
    const res = await GET(rutaForo(V_FZ16));
    const crudo = await res.text();
    expect(crudo).not.toContain('usr_admin');
    expect(crudo).not.toContain('admin@gara-g.swal.network');
    expect(crudo).toMatch(/Piloto-[a-z0-9]{6}/);
  });

  it('leer un hilo inexistente responde 404', async () => {
    const { GET } = await import('../../pages/api/garage/forum/thread/[id].js');
    const res = await GET(rutaHilo('no-existe'));
    expect(res.status).toBe(404);
  });

  it('un PATCH de moderacion sin campos responde 400', async () => {
    const hilo = await import('../../pages/api/garage/forum/thread/[id].js');
    const thread = await crearHilo(V_FZ16, 'Hilo sin moderacion real');
    const res = await hilo.PATCH(rutaHilo(thread.id, { method: 'PATCH', body: '{}' }));
    expect(res.status).toBe(400);
  });
});

describe('wiki por la ruta', () => {
  it('devuelve la pagina con secciones de catalogo y de comunidad', async () => {
    const { GET } = await import('../../pages/api/garage/wiki/[versionKey].js');
    const res = await GET(rutaWiki(V_FZ16));
    expect(res.status).toBe(200);
    const { page } = await body<{ page: WikiPage }>(res);
    expect(page.versionKey).toBe(V_FZ16);
    expect(page.version.make).toBe('Yamaha');
    expect(page.sections.filter((s) => s.source === 'catalog')).toHaveLength(3);
    expect(page.sections.filter((s) => s.source === 'community')).toHaveLength(4);
  });

  it('una versionKey valida pero fuera del catalogo tambien responde 200', async () => {
    const { GET } = await import('../../pages/api/garage/wiki/[versionKey].js');
    const res = await GET(rutaWiki('moto-inexistente-2020'));
    expect(res.status).toBe(200);
    const { page } = await body<{ page: WikiPage }>(res);
    expect(page.sections).toHaveLength(7);
    expect(page.sections.filter((s) => s.source === 'community')).toHaveLength(4);
  });
});
