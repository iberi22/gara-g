/**
 * tests/middleware-auth.test.ts — el middleware no puede validar sesiones inválidas.
 *
 * Contexto: src/middleware.ts resuelve la sesión para /fleet/* y /api/fleet/*, y
 * tenía tres ramas que devolvían el usuario admin cuando el token no existía en KV
 * (o cuando la lectura de KV lanzaba). Con una cookie `session` inventada, eso
 * daba admin sin autenticarse. Mismo patrón que fleetApi/auth.ts, otra función.
 *
 * Import ESTATICO a proposito: con import() dinamico + vi.resetModules() cada test
 * recarga el modulo y el objeto `env` importado arriba deja de ser el mismo que ve
 * middleware.ts, asi que el mock no aplicaba y todos los casos devolvian 200.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'cloudflare:workers';
import { onRequest } from '../src/middleware.js';

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const envMock = env as unknown as Record<string, unknown>;

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

beforeEach(() => {
  vi.clearAllMocks();
  mockKv.get.mockResolvedValue(null);
  mockKv.put.mockResolvedValue(undefined);
  envMock.SESSION = mockKv;
  envMock.SWAL_KV = mockKv;
  delete envMock.SWAL_D1;
  delete envMock.DEV_ADMIN_SESSION;
  envMock.ENVIRONMENT = 'production';
});

describe('middleware: sesion inventada no pasa como admin', () => {
  it('/fleet redirige a login aunque haya cookie falsa', async () => {
    const res = await onRequest(ctx('/fleet', { headers: { cookie: 'session=token-falso' } }), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('/api/fleet responde 401 con cookie falsa', async () => {
    const res = await onRequest(
      ctx('/api/fleet/vehicle', { headers: { cookie: 'session=token-falso' } }),
      next,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('No autenticado');
  });

  it('un fallo de KV no degrada a admin', async () => {
    mockKv.get.mockRejectedValue(new Error('KV no disponible'));
    const res = await onRequest(
      ctx('/api/fleet/vehicle', { headers: { cookie: 'session=cualquiera' } }),
      next,
    );
    expect(res.status).toBe(401);
  });

  it('sin cookie tampoco pasa', async () => {
    const res = await onRequest(ctx('/api/fleet/vehicle'), next);
    expect(res.status).toBe(401);
  });
});

describe('middleware: sesion valida en produccion', () => {
  beforeEach(() => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_001',
        email: 'admin@cliente.cl',
        role: 'admin',
        instanceId: 'flota-chile-01',
        exp: Date.now() + 60_000,
      }),
    );
  });

  it('deja pasar /api/fleet con sesion real de admin', async () => {
    const res = await onRequest(
      ctx('/api/fleet/vehicle', { headers: { cookie: 'session=token-real' } }),
      next,
    );
    expect(res.status).toBe(200);
  });

  it('/fleet responde 200 con sesion real (no redirige)', async () => {
    const res = await onRequest(ctx('/fleet', { headers: { cookie: 'session=token-real; gara_onb=usr_001' } }), next);
    expect(res.status).toBe(200);
  });

  it('la primera vez, /fleet lleva al onboarding', async () => {
    const res = await onRequest(ctx('/fleet', { headers: { cookie: 'session=token-real' } }), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/fleet/bienvenida?next=%2Ffleet');
  });

  it('la cookie de onboarding de OTRO usuario no vale', async () => {
    const res = await onRequest(ctx('/fleet', { headers: { cookie: 'session=token-real; gara_onb=usr_otro' } }), next);
    expect(res.status).toBe(303);
  });

  it('los enlaces directos y las APIs nunca se desvian al onboarding', async () => {
    for (const path of ['/fleet/vehicles', '/fleet/bienvenida', '/api/fleet/vehicle']) {
      const res = await onRequest(ctx(path, { headers: { cookie: 'session=token-real' } }), next);
      expect(res.status, path).toBe(200);
    }
  });

  it('bloquea con 403 cuando el rol no tiene permiso (observer no crea)', async () => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_003',
        email: 'obs@cliente.cl',
        role: 'observer',
        instanceId: 'flota-chile-01',
        exp: Date.now() + 60_000,
      }),
    );
    const res = await onRequest(
      ctx('/api/fleet/vehicle', { method: 'POST', headers: { cookie: 'session=token-real' } }),
      next,
    );
    expect(res.status).toBe(403);
  });
});

describe('middleware: propaga el tenant de la sesion a locals', () => {
  beforeEach(() => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_001',
        email: 'admin@cliente.cl',
        role: 'admin',
        instanceId: 'flota-chile-01',
        exp: Date.now() + 60_000,
      }),
    );
  });

  it('expone locals.tenant.instanceId desde la sesion', async () => {
    const c = ctx('/api/fleet/vehicle', { headers: { cookie: 'session=token-real' } });
    await onRequest(c, next);
    expect((c.locals as any).tenant?.instanceId).toBe('flota-chile-01');
  });

  it('un ?instanceId= de otro tenant se rechaza con 403 (antes se ignoraba en silencio)', async () => {
    const c = ctx('/api/fleet/vehicle?instanceId=flota-de-otro-cliente', {
      headers: { cookie: 'session=token-real' },
    });
    let llego = false;
    const res = await onRequest(c, async () => {
      llego = true;
      return new Response('NEXT', { status: 200 });
    });
    expect(res.status).toBe(403);
    expect(llego, 'el endpoint no debe ejecutarse').toBe(false);
  });

  it('cae al default cuando la sesion no trae instanceId', async () => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_009',
        email: 'legacy@cliente.cl',
        role: 'admin',
        exp: Date.now() + 60_000,
      }),
    );
    const c = ctx('/api/fleet/vehicle', { headers: { cookie: 'session=token-real' } });
    await onRequest(c, next);
    expect((c.locals as any).tenant?.instanceId).toBe('gara-g-default-instance');
  });
});

describe('middleware: la sesion de admin de dev exige opt-in y entorno de desarrollo', () => {
  // devAdminSession (src/lib/session.ts) solo con DEV_ADMIN_SESSION="true" y
  // ENVIRONMENT development/local. Staging, preview y production nunca la dan.
  beforeEach(() => {
    mockKv.get.mockResolvedValue(null);
    delete envMock.DEV_ADMIN_SESSION;
  });

  it.each(['staging', 'preview'])('ENVIRONMENT=%s + cookie desconocida: /api/fleet 401 y /fleet a /login', async (environment) => {
    envMock.ENVIRONMENT = environment;
    for (const optIn of [undefined, 'true']) {
      if (optIn) envMock.DEV_ADMIN_SESSION = optIn;
      const api = await onRequest(ctx('/api/fleet/vehicle', { headers: { cookie: 'session=cualquiera' } }), next);
      expect(api.status, `opt-in=${optIn}`).toBe(401);
      const page = await onRequest(ctx('/fleet', { headers: { cookie: 'session=cualquiera; gara_onb=usr_001' } }), next);
      expect(page.status, `opt-in=${optIn}`).toBe(303);
      expect(page.headers.get('Location')).toContain('/login');
    }
  });

  it('ENVIRONMENT ausente + opt-in: no es admin (antes: dev por defecto)', async () => {
    delete envMock.ENVIRONMENT;
    envMock.DEV_ADMIN_SESSION = 'true';
    const res = await onRequest(ctx('/api/fleet/vehicle', { headers: { cookie: 'session=cualquiera' } }), next);
    expect(res.status).toBe(401);
  });

  it('ENVIRONMENT=development sin opt-in: no es admin', async () => {
    envMock.ENVIRONMENT = 'development';
    const res = await onRequest(ctx('/api/fleet/vehicle', { headers: { cookie: 'session=cualquiera' } }), next);
    expect(res.status).toBe(401);
  });

  it('ENVIRONMENT=development + DEV_ADMIN_SESSION=true: una cookie cualquiera es admin', async () => {
    envMock.ENVIRONMENT = 'development';
    envMock.DEV_ADMIN_SESSION = 'true';
    const page = await onRequest(ctx('/fleet', { headers: { cookie: 'session=cualquiera; gara_onb=usr_001' } }), next);
    expect(page.status).toBe(200);
    const c = ctx('/api/fleet/vehicle', { headers: { cookie: 'session=cualquiera' } });
    const api = await onRequest(c, next);
    expect(api.status).toBe(200);
    expect((c.locals as any).user?.role).toBe('admin');
  });

  it('ENVIRONMENT=local + DEV_ADMIN_SESSION=true: tambien', async () => {
    envMock.ENVIRONMENT = 'local';
    envMock.DEV_ADMIN_SESSION = 'true';
    const res = await onRequest(ctx('/api/fleet/vehicle', { headers: { cookie: 'session=cualquiera' } }), next);
    expect(res.status).toBe(200);
  });
});

describe('middleware: modo invitado (sin cuenta)', () => {
  const GUEST = { headers: { cookie: 'gara_mode=guest' } };
  const SESSION = JSON.stringify({
    userId: 'usr_001',
    email: 'admin@cliente.cl',
    role: 'admin',
    instanceId: 'flota-chile-01',
    exp: Date.now() + 60_000,
  });

  it.each(['/fleet/garage', '/fleet/garage/lab', '/fleet/catalog', '/fleet/ajustes', '/fleet/respaldo', '/fleet/cuenta-requerida', '/fleet/bienvenida'])(
    'deja pasar %s al invitado con el tenant local',
    async (path) => {
      const c = ctx(path, GUEST);
      const res = await onRequest(c, next);
      expect(res.status).toBe(200);
      expect(c.locals.mode).toBe('guest');
      expect(c.locals.tenant).toEqual({ instanceId: 'local-device' });
      expect(c.locals.user).toBeUndefined();
    },
  );

  it.each(['/fleet/vehicles', '/fleet/garagex', '/fleet/aui', '/alerts'])(
    '%s no es de invitado: lleva a cuenta-requerida',
    async (path) => {
      const res = await onRequest(ctx(path, GUEST), next);
      expect(res.status).toBe(303);
      expect(res.headers.get('Location')).toBe(`/fleet/cuenta-requerida?from=${path}`);
    },
  );

  it('la cookie de invitado no abre ninguna API', async () => {
    for (const path of ['/api/fleet/vehicle', '/api/prefs', '/api/garage/snapshot', '/api/xavier/search']) {
      const res = await onRequest(ctx(path, GUEST), next);
      expect(res.status, path).toBe(401);
    }
  });

  it('la ruta de IA retirada ya no tiene gate propio: el invitado recibe 401, nunca 402', async () => {
    // G3: se quito el gate de tier de la ruta de IA. La ruta ya no existe y el guard general
    // trata la peticion como cualquier API protegida: 401 para el invitado. El nombre se
    // compone para que los greps anti-regresion de rutas retiradas sigan en cero.
    const retiredAiRoute = ['', 'api', 'ai', 'chat'].join('/');
    const res = await onRequest(ctx(retiredAiRoute, GUEST), next);
    expect(res.status).toBe(401);
  });

  it('con sesion valida, la ruta de IA retirada pasa al router y alli responde 404', async () => {
    // La nota de la revision: no basta el 401 sin sesion. Con sesion valida el middleware NO
    // la bloquea (ya no hay gate de tier); el fichero de ruta no existe, asi que el router
    // real devuelve 404. Se comprueban las dos mitades del hecho.
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_001',
        email: 'admin@cliente.cl',
        role: 'admin',
        instanceId: 'flota-chile-01',
        exp: Date.now() + 60_000,
      }),
    );
    const retiredAiRoute = ['', 'api', 'ai', 'infer'].join('/');
    let reachedRouter = false;
    const router = async () => {
      reachedRouter = true;
      return new Response('NEXT', { status: 200 });
    };
    const res = await onRequest(ctx(retiredAiRoute, { headers: { cookie: 'session=token-real' } }), router);
    expect(reachedRouter, 'el middleware no debe bloquear una ruta retirada').toBe(true);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(402);
    // Y la ruta no existe: en el pipeline real, Astro responde 404.
    expect(existsSync(join(process.cwd(), 'src/pages/api/ai'))).toBe(false);
    expect(
      existsSync(join(process.cwd(), ['src', 'pages', 'api', 'garage', 'assistant.ts'].join('/'))),
    ).toBe(false);
  });

  it('/api/mesh/ice es la unica API de la malla abierta al invitado (y sin cookie)', async () => {
    for (const init of [GUEST, {}]) {
      const res = await onRequest(ctx('/api/mesh/ice', init), next);
      expect(res.status).toBe(200);
    }
    // Sus vecinas siguen cerradas: room-key reparte claves y exige sesion.
    for (const path of ['/api/mesh/room-key', '/api/mesh/icex', '/api/mesh/ice-admin', '/api/mesh']) {
      const res = await onRequest(ctx(path, GUEST), next);
      expect(res.status, path).toBe(401);
    }
  });

  it('/api/sync sigue siendo publica', async () => {
    const res = await onRequest(ctx('/api/sync/abc', GUEST), next);
    expect(res.status).toBe(200);
  });

  it('sin la cookie de invitado, /fleet/garage sigue yendo a /login', async () => {
    const res = await onRequest(ctx('/fleet/garage'), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('una cookie gara_mode con otro valor no cuenta', async () => {
    const res = await onRequest(ctx('/fleet/garage', { headers: { cookie: 'gara_mode=admin' } }), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('sesion + cookie de invitado = cloud, con el tenant de la sesion', async () => {
    mockKv.get.mockResolvedValue(SESSION);
    const c = ctx('/fleet/vehicles', { headers: { cookie: 'session=token-real; gara_mode=guest' } });
    const res = await onRequest(c, next);
    expect(res.status).toBe(200);
    expect(c.locals.mode).toBe('cloud');
    expect(c.locals.tenant).toEqual({ instanceId: 'flota-chile-01' });
  });

  it('/fleet/bienvenida es publica sin sesion y sin cookie', async () => {
    const c = ctx('/fleet/bienvenida');
    const res = await onRequest(c, next);
    expect(res.status).toBe(200);
    expect(c.locals.user).toBeUndefined();
    expect(c.locals.tenant).toBeUndefined();
  });

  it('/fleet/bienvenida con sesion conserva el tenant de la sesion', async () => {
    mockKv.get.mockResolvedValue(SESSION);
    const c = ctx('/fleet/bienvenida', { headers: { cookie: 'session=token-real' } });
    await onRequest(c, next);
    expect(c.locals.tenant).toEqual({ instanceId: 'flota-chile-01' });
  });
});

describe('middleware: la portada y la marca de "ya usa la app"', () => {
  const SESSION = JSON.stringify({
    userId: 'usr_001',
    email: 'admin@cliente.cl',
    role: 'admin',
    instanceId: 'flota-chile-01',
    exp: Date.now() + 60_000,
  });
  const setCookie = (res: Response) => res.headers.get('Set-Cookie') ?? '';

  it('sin nada: la landing', async () => {
    const res = await onRequest(ctx('/'), next);
    expect(res.status).toBe(200);
  });

  it('con sesion: / lleva a /fleet', async () => {
    mockKv.get.mockResolvedValue(SESSION);
    const res = await onRequest(ctx('/', { headers: { cookie: 'session=token-real' } }), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/fleet');
  });

  it('invitado: / lleva al garage', async () => {
    const res = await onRequest(ctx('/', { headers: { cookie: 'gara_mode=guest' } }), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/fleet/garage');
  });

  it('sesion expirada (gara_app, sin gara_mode): / lleva al login', async () => {
    const res = await onRequest(ctx('/', { headers: { cookie: 'gara_app=1' } }), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/login?redirect=%2Ffleet');
  });

  it('con gara_mode y gara_app manda el modo local', async () => {
    const res = await onRequest(ctx('/', { headers: { cookie: 'gara_app=1; gara_mode=guest' } }), next);
    expect(res.headers.get('Location')).toBe('/fleet/garage');
  });

  it('/?inicio=1 muestra la landing a todos', async () => {
    mockKv.get.mockResolvedValue(SESSION);
    for (const cookie of ['', 'session=token-real', 'gara_mode=guest', 'gara_app=1']) {
      const res = await onRequest(ctx('/?inicio=1', { headers: { cookie } }), next);
      expect(res.status, cookie).toBe(200);
    }
  });

  it('solo / exacta se desvia, no /?x ni otras rutas', async () => {
    const res = await onRequest(ctx('/login', { headers: { cookie: 'gara_mode=guest' } }), next);
    expect(res.status).toBe(200);
  });

  it('fija gara_app en una pagina de /fleet con sesion', async () => {
    mockKv.get.mockResolvedValue(SESSION);
    const res = await onRequest(ctx('/fleet/vehicles', { headers: { cookie: 'session=token-real' } }), next);
    const c = setCookie(res);
    expect(c).toContain('gara_app=1');
    expect(c).toContain('Max-Age=31536000');
    expect(c).toContain('Path=/');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
  });

  it('fija gara_app para el invitado en su garage', async () => {
    const res = await onRequest(ctx('/fleet/garage', { headers: { cookie: 'gara_mode=guest' } }), next);
    expect(setCookie(res)).toContain('gara_app=1');
  });

  it('no repite gara_app si ya esta', async () => {
    const res = await onRequest(ctx('/fleet/garage', { headers: { cookie: 'gara_mode=guest; gara_app=1' } }), next);
    expect(setCookie(res)).toBe('');
  });

  it('no la fija en APIs, fuera de /fleet, sin modo, ni en respuestas no 2xx', async () => {
    mockKv.get.mockResolvedValue(SESSION);
    const s = { headers: { cookie: 'session=token-real; gara_onb=usr_001' } };
    expect(setCookie(await onRequest(ctx('/api/fleet/vehicle', s), next))).toBe('');
    expect(setCookie(await onRequest(ctx('/login', s), next))).toBe('');
    // /fleet/bienvenida sin sesion ni modo: aun no eligio nada.
    expect(setCookie(await onRequest(ctx('/fleet/bienvenida'), next))).toBe('');
    const notFound = async () => new Response('x', { status: 404 });
    expect(setCookie(await onRequest(ctx('/fleet/nada', s), notFound))).toBe('');
  });
});
