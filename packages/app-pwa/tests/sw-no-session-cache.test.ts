import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/sw-no-session-cache.test.ts — el service worker no deja una sesión pegada en caché.
 *
 * `public/sw.js` terminaba en un `cacheFirst` para todo lo que no fuera
 * `/api/*` ni `/fleet/*`: `/alerts`, `/telemetry`, `/documents`, `/drivers`,
 * `/geofences`, `/fuel` y `/fleets` quedaban en la caché del navegador de forma
 * indefinida, y con `CACHE = 'gara-g-v1'` sin versionar. Dos consecuencias: tras
 * un logout, o en un móvil de flota compartido, el siguiente conductor veía los
 * datos del anterior; y tras desplegar el guard de sesión, los navegadores con
 * esas páginas cacheadas seguían viéndolas sin tener cookie.
 *
 * El extremo opuesto tampoco sirve: sin cachear las navegaciones, recargar
 * /fleet sin red devolvía un 503 y la app local-first no abría. La política
 * actual cachea el HTML de la navegación SOLO como respaldo de la red, en una
 * caché aparte versionada por build, con `Set-Cookie` fuera, sin guardar
 * redirecciones a otra ruta y con purga en el logout. Este test fija esas
 * condiciones; el comportamiento en navegador lo cubre tests/e2e.
 */
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SW = readFileSync(resolve(ROOT, 'public/sw.js'), 'utf-8');

/** Cuerpo del listener fetch: decide la estrategia de cada peticion. */
function fetchHandler(): string {
  const start = SW.indexOf("addEventListener('fetch'");
  expect(start, 'el SW no tiene listener fetch').toBeGreaterThan(-1);
  const end = SW.indexOf('\n});', start);
  return SW.slice(start, end === -1 ? undefined : end);
}

/** Cuerpo de una funcion por nombre (hasta la llave de cierre en columna 0). */
function funcion(name: string): string {
  const i = SW.indexOf(`function ${name}(`);
  expect(i, `falta ${name}`).toBeGreaterThan(-1);
  const end = SW.indexOf('\n}', i);
  return SW.slice(i, end === -1 ? undefined : end);
}

describe('el SW no guarda la sesion de forma indefinida', () => {
  const handler = fetchHandler();

  it('no hay cacheFirst como estrategia por defecto', () => {
    // El fallo original: `event.respondWith(cacheFirst(request))` al final,
    // que se comia cualquier ruta no contemplada antes.
    const ultimo = handler.trimEnd().split('\n').filter(Boolean).pop() ?? '';
    expect(ultimo, 'el fetch handler acaba en un respondWith sin guardar').not.toMatch(
      /respondWith\(cacheFirst/,
    );
  });

  it('cachea assets con extension y nada mas por esa via', () => {
    expect(handler).toMatch(/STATIC_EXT\.test\(url\.pathname\)/);
  });

  it('las navegaciones van a navigateNetworkFirst', () => {
    expect(handler).toMatch(/request\.mode\s*===?\s*['"]navigate['"]/);
    expect(handler).toMatch(/respondWith\(navigateNetworkFirst\(request\)\)/);
  });

  it('/api/* nunca se cachea', () => {
    expect(handler).toMatch(/\/api\//);
    const bloqueApi = handler.slice(handler.indexOf('/api/'), handler.indexOf('/api/') + 160);
    expect(bloqueApi, '/api/ debe ir a networkOnly').toMatch(/networkOnly/);
  });

  it('/r2/* nunca se cachea, aunque la cabecera diga publico', () => {
    // Documentos privados: SOAT, polizas. Un documento borrado no debe seguir
    // vivo ni en el edge ni en el navegador.
    expect(handler).toMatch(/\/r2\//);
    const i = handler.indexOf('/r2/');
    expect(handler.slice(i, i + 160), '/r2/ debe ir a networkOnly').toMatch(/networkOnly/);
  });

  it('acepta http solo en localhost (contexto seguro) y https en el resto', () => {
    const fn = funcion('isSecureContextUrl');
    expect(fn).toMatch(/url\.protocol\s*===?\s*['"]https:['"]/);
    expect(fn).toMatch(/LOCAL_HOSTS\.has\(url\.hostname\)/);
    // Los hosts locales incluyen localhost y 127.0.0.1.
    expect(SW).toMatch(/LOCAL_HOSTS\s*=\s*new Set\(\[[^\]]*'localhost'[^\]]*'127\.0\.0\.1'/);
  });

  it('en http local solo se interceptan navegaciones; assets y APIs pasan de largo', () => {
    // Los assets de Vite (con query) y las APIs mockeadas con page.route no
    // deben pasar por el SW en dev: si no, su fallo offline deja de ser
    // ERR_INTERNET_DISCONNECTED y los mocks de Playwright no los ven.
    expect(handler).toMatch(
      /url\.protocol\s*===?\s*['"]http:['"]\s*&&\s*request\.mode\s*!==\s*['"]navigate['"]/,
    );
  });
});

describe('el HTML cacheado es un respaldo, no una sesion congelada', () => {
  it('solo se guarda un documento HTML 200 propio', () => {
    const fn = funcion('isCacheablePage');
    expect(fn).toMatch(/response\.status\s*!==\s*200/);
    expect(fn).toMatch(/text\/html/);
  });

  it('una redireccion a otra ruta (p. ej. /login) no se guarda como el panel', () => {
    const fn = funcion('isCacheablePage');
    expect(fn).toMatch(/response\.redirected/);
    expect(fn).toMatch(/finalPath\s*!==\s*requestPath/);
  });

  it('el Set-Cookie se elimina antes de cachear', () => {
    const fn = funcion('sanitizePage');
    expect(fn).toMatch(/headers\.delete\(['"]set-cookie['"]\)/);
  });

  it('navigateNetworkFirst solo guarda a traves de sanitizePage', () => {
    const fn = funcion('navigateNetworkFirst');
    expect(fn).toMatch(/isCacheablePage\(response, request\)/);
    expect(fn).toMatch(/sanitizePage\(response\.clone\(\)\)/);
    // Nunca guarda la respuesta viva sin sanear.
    expect(fn).not.toMatch(/cache\.put\([^)]*response(?!\.clone)/);
  });

  it('la cache de paginas tiene tope y se recorta', () => {
    expect(SW).toMatch(/MAX_PAGES\s*=\s*\d+/);
    expect(funcion('trimCache')).toMatch(/cache\.delete/);
  });

  it('sin red sirve la copia de la ruta y, si no, el app shell de respaldo', () => {
    const fn = funcion('navigateNetworkFirst');
    expect(fn).toMatch(/cache\.match\(key\)/);
    expect(fn).toMatch(/caches\.match\(OFFLINE_FALLBACK\)/);
  });

  it('la clave de pagina ignora query y hash', () => {
    const fn = funcion('pageKey');
    expect(fn).toMatch(/url\.search\s*=\s*['"]['"]/);
    expect(fn).toMatch(/url\.hash\s*=\s*['"]['"]/);
  });
});

describe('la cache se versiona en cada build', () => {
  it('los nombres llevan un BUILD_ID, no un v1 fijo', () => {
    expect(SW).toMatch(/__BUILD_ID__/);
    expect(SW).not.toMatch(/CACHE\s*=\s*['"]gara-g-v\d+['"]/);
    expect(SW).toMatch(/PAGES_CACHE\s*=\s*`gara-g-pages-\$\{BUILD_ID\}`/);
  });

  it('el activate purga toda cache que no sea la actual', () => {
    const i = SW.indexOf("addEventListener('activate'");
    expect(i).toBeGreaterThan(-1);
    const bloque = SW.slice(i, SW.indexOf('\n});', i));
    expect(bloque).toMatch(/caches\.delete/);
    expect(bloque).toMatch(/k\s*!==\s*CACHE\s*&&\s*k\s*!==\s*PAGES_CACHE/);
  });

  it('hay una via de purga explicita para logout', () => {
    expect(SW).toMatch(/PURGE_CACHES|GARA_PURGE/);
  });

  it('networkOnly nunca escribe en cache', () => {
    const fn = funcion('networkOnly');
    expect(fn).not.toMatch(/cache\.put/);
  });
});
