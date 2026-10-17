import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from 'cloudflare:workers';
/**
 * tests/page-auth-allowlist.test.ts — toda pagina exige sesion salvo la lista blanca.
 *
 * Contexto: el guard de src/middleware.ts exigia autenticacion solo dentro de
 * `if (pathname === '/fleet' || pathname.startsWith('/fleet/'))`. Cualquier ruta
 * fuera de /fleet* pasaba sin comprobar nada, de modo que /alerts, /telemetry,
 * /documents y /fleets devolvian 200 sin sesion en produccion y /alerts
 * renderizaba el Instance ID del tenant en publico.
 *
 * PUBLIC_PATHS era una lista blanca que no gobernaba nada: la condicion la
 * usaba al reves, como lista negra. Ahora PUBLIC_PATHS es lo unico publico.
 *
 * Este test recorre el disco y comprueba que CADA pagina que existe esta
 * protegida. Es lo que hace que un olvido futuro no serepita: si alguien anade
 * una pagina y olvida el auth, este test falla con su nombre en el mensaje, en
 * vez de que se descubra en produccion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../src/middleware.js';
import { GUEST_ALLOWED_PATHS } from '../src/lib/appMode';

const PAGES_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/pages');

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const envMock = env as unknown as Record<string, unknown>;

function ctx(path: string) {
  return {
    url: new URL(`https://gara-g.swal.network${path}`),
    request: new Request(`https://gara-g.swal.network${path}`),
    cookies: { get: () => undefined },
    locals: {} as Record<string, unknown>,
    redirect: (to: string, code: number) =>
      new Response(null, { status: code, headers: { Location: to } }),
  } as any;
}

const next = async () => new Response('NEXT', { status: 200 });

/**
 * Rutas publicas declaradas. Deben seguir sincronizadas con PUBLIC_PATHS.
 *
 * '/' esta porque la landing de marketing es publica por diseño y va
 * prerenderizada. Sin esa excepcion el build la convierte en un stub de
 * redireccion a /login y el bundle pierde 25 KB de landing. El resto del sitio
 * es fallo cerrado.
 */
const PUBLICAS = ['/', '/login', '/fleet/bienvenida'];

/** Todas las rutas de pagina del sitio, en forma de URL. */
function rutasDePaginas(dir: string = PAGES_DIR): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];

  (function caminar(actual: string) {
    for (const entrada of readdirSync(actual)) {
      const p = join(actual, entrada);
      if (statSync(p).isDirectory()) {
        caminar(p);
        continue;
      }
      if (!entrada.endsWith('.astro')) continue;
      // /fleet/documents/edit/[id].astro -> /fleet/documents/edit/[id]
      const rel = p.slice(PAGES_DIR.length).replace(/\.astro$/, '');
      // index.astro -> la carpeta; index (raiz) -> /
      const ruta = rel === '/index' ? '/' : rel.replace(/\/index$/, '');
      out.push(ruta);
    }
  })(dir);

  return out.sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockKv.get.mockResolvedValue(null);
  envMock.SESSION = mockKv;
  envMock.SWAL_KV = mockKv;
  Reflect.deleteProperty(envMock, 'SWAL_D1');
  envMock.ENVIRONMENT = 'production';
  Reflect.deleteProperty(envMock, 'PUBLIC_DEMO');
  // Este fichero prueba las reglas de sesion de TODAS las paginas: con FLEET_ONLY encendido
  // las del Mercado/V2V responderian 404 antes de llegar a ellas. El 404 lo cubre
  // tests/fleet-only-mode.test.ts.
  envMock.FLEET_ONLY = 'false';
});

/** Un invitado = sin sesion y con la cookie de modo local. */
function ctxInvitado(path: string) {
  const c = ctx(path);
  c.cookies = { get: (k: string) => (k === 'gara_mode' ? { value: 'guest' } : undefined) };
  c.request = new Request(`https://gara-g.swal.network${path}`, { headers: { cookie: 'gara_mode=guest' } });
  return c;
}

describe('modo invitado: solo GUEST_ALLOWED_PATHS es accesible, y nada mas', () => {
  const rutas = rutasDePaginas().filter((r) => r !== '/' && r !== '/login');

  it('cada ruta de GUEST_ALLOWED_PATHS existe como pagina', () => {
    const disco = rutasDePaginas();
    for (const g of GUEST_ALLOWED_PATHS) expect(disco, g).toContain(g);
  });

  it.each(rutas)('%s: accesible a invitados solo si esta en GUEST_ALLOWED_PATHS', async (ruta) => {
    // Las rutas dinamicas ([id]) se prueban con un valor concreto.
    const concreta = ruta.replace(/\[[^\]]+\]/g, 'x1');
    const permitida = (concreta.startsWith('/fleet/garage/expediente/') && concreta.split('/').length === 5) || GUEST_ALLOWED_PATHS.some((g) => concreta === g);
    const res = await onRequest(ctxInvitado(concreta), next);
    if (permitida) {
      expect(res.status, `${concreta} deberia ser accesible a invitados`).toBe(200);
    } else {
      expect(res.status, `${concreta} NO debe ser accesible a invitados`).toBe(303);
      expect(res.headers.get('Location')).toContain('/fleet/cuenta-requerida?from=');
    }
  });

  it('GUEST_ALLOWED_PATHS no contiene nada de mas', () => {
    expect([...GUEST_ALLOWED_PATHS].sort()).toEqual(
      [
        '/fleet',
        '/fleet/ajustes',
        '/fleet/bienvenida',
        '/fleet/bodega',
        '/fleet/catalog',
        '/fleet/cuenta-requerida',
        '/fleet/garage',
        '/fleet/garage/anunciantes',
        '/fleet/garage/engine-lab',
        '/fleet/garage/expediente/[id]',
        '/fleet/garage/flota-demo-chile',
        '/fleet/garage/lab',
        '/fleet/mercado',
        '/fleet/mercado/vender',
        '/fleet/radar',
        '/fleet/respaldo',
      ].sort()
    );
  });

  it('cada pagina exacta esta permitida y los caminos desconocidos redirigen', async () => {
    for (const p of GUEST_ALLOWED_PATHS) {
      const concreta = p.replace(/\[[^\]]+\]/g, 'x1');
      const res = await onRequest(ctxInvitado(concreta), next);
      expect(res.status, `${concreta} debe ser accesible`).toBe(200);
    }

    const res2 = await onRequest(ctxInvitado('/fleet/garagex'), next);
    expect(res2.status).toBe(303);
    expect(res2.headers.get('Location')).toContain('/fleet/cuenta-requerida?from=/fleet/garagex');
  });
});

describe('auth: allowlist real de rutas publicas', () => {
  it('el disco tiene paginas que auditar (el test no pasa vacio)', () => {
    const rutas = rutasDePaginas();
    expect(rutas.length).toBeGreaterThan(20);
    // Las cuatro que estaban abiertas tienen que seguir en la lista.
    for (const r of ['/alerts', '/telemetry', '/documents', '/fleets']) {
      expect(rutas).toContain(r);
    }
  });

  it.each(rutasDePaginas())('%s exige sesion sin cookie', async (ruta) => {
    // Las publicas se saltan por definicion.
    // Coincidencia exacta: con startsWith, '/' absorbia todas las rutas y el test no auditaba nada.
    if (PUBLICAS.includes(ruta)) return;

    const res = await onRequest(ctx(ruta), next);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('/login sigue siendo accesible sin sesion', async () => {
    const res = await onRequest(ctx('/login'), next);
    expect(res.status).toBe(200);
  });

  it('la landing / es publica y no la absorbe el guard', async () => {
    // Regresion de un fallo real: al cerrar el guard, '/' quedo protegida y el
    // prerender la emitio como stub de 357 B con meta-refresh a /login en vez
    // de la landing de 25 KB. El build daba exit 0 y los tests de pagina pasaban,
    // porque ninguno mira el HTML emitido.
    const res = await onRequest(ctx('/'), next);
    expect(res.status).toBe(200);
  });

  it("'/' en la allowlist no acts como comodin", async () => {
    // Un prefijo de cadena normal haria que '/' emparejase con todas las rutas
    // y dejara el sitio entero publico, que es el fallo que se vino a cerrar.
    for (const ruta of ['/alerts', '/fleet/vehicles', '/api/fleet/stats', '/loginsomething']) {
      const res = await onRequest(ctx(ruta), next);
      expect(res.status, `${ruta} no debe ser publica`).not.toBe(200);
    }
  });

  it('las APIs devuelven 401 JSON, no un 303 a /login', async () => {
    // Un 303 en una API rompe a fetch: no sigue la redireccion y el cuerpo no
    // es JSON. Se comprueba en las dos formas de API que hay.
    for (const ruta of ['/api/fleet/stats', '/api/xavier/search']) {
      const res = await onRequest(ctx(ruta), next);
      expect(res.status).toBe(401);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      const body = await res.json();
      expect(body.ok).toBe(false);
    }
  });

  it('PUBLIC_DEMO no abre nada en produccion aunque este activo', async () => {
    // Este fichero fija ENVIRONMENT=production. Aunque PUBLIC_DEMO valga, en
    // produccion no abre rutas: el flag solo existe para el modo demo local.
    envMock.PUBLIC_DEMO = 'true';

    for (const ruta of ['/fleet/vehicles', '/fleet', '/alerts', '/documents']) {
      const res = await onRequest(ctx(ruta), next);
      expect(res.status, `${ruta} se abrio con PUBLIC_DEMO en produccion`).toBe(303);
      expect(res.headers.get('Location')).toContain('/login');
    }
  });

  it('PUBLIC_DEMO abre /fleet* fuera de produccion, y no el resto', async () => {
    envMock.ENVIRONMENT = 'development';
    envMock.PUBLIC_DEMO = 'true';
    try {
      const enFleet = await onRequest(ctx('/fleet/vehicles'), next);
      expect(enFleet.status).toBe(200);

      // /alerts nunca estuvo abierta, y con el flag tampoco: PUBLIC_DEMO es
      // una puerta de demo de /fleet*, no una llave maestra.
      const alertas = await onRequest(ctx('/alerts'), next);
      expect(alertas.status).toBe(303);
      expect(alertas.headers.get('Location')).toContain('/login');
    } finally {
      envMock.ENVIRONMENT = 'production';
    }
  });
});
