import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/sw-no-session-cache.test.ts — el service worker no guarda páginas de sesión.
 *
 * `public/sw.js` terminaba en un `cacheFirst` para todo lo que no fuera
 * `/api/*` ni `/fleet/*`: `/alerts`, `/telemetry`, `/documents`, `/drivers`,
 * `/geofences`, `/fuel` y `/fleets` quedaban en la caché del navegador de forma
 * indefinida, y con `CACHE = 'gara-g-v1'` sin versionar.
 *
 * Dos consecuencias: tras un logout, o en un móvil de flota compartido, el
 * siguiente conductor veía los datos del anterior; y tras desplegar el guard de
 * sesión, los navegadores con esas páginas cacheadas seguían viéndolas sin
 * tener cookie. El service worker no sabe si hay sesión, así que la regla es
 * que nada dependiente de una sesión entra en caché.
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

describe('el SW no cachea nada que dependa de una sesion', () => {
  const handler = fetchHandler();

  it('no hay cacheFirst como estrategia por defecto', () => {
    // El fallo original: `event.respondWith(cacheFirst(request))` al final,
    // que se comia cualquier ruta no contemplada antes.
    const ultimo = handler.trimEnd().split('\n').filter(Boolean).pop() ?? '';
    expect(ultimo, 'el fetch handler acaba en un respondWith sin guardar').not.toMatch(
      /respondWith\(cacheFirst/,
    );
  });

  it('cachea solo assets con extension', () => {
    expect(handler).toMatch(/STATIC_EXT\.test\(url\.pathname\)/);
  });

  it('las navegaciones van a red y no se cachean', () => {
    expect(handler).toMatch(/request\.mode\s*===?\s*['"]navigate['"]/);
    // La red primero, sin cache.put detras.
    expect(handler).not.toMatch(/networkFirstWithOffline|networkFirst\(request\)/);
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

  it('ninguna pagina de sesion queda en cache por extension', () => {
    // Estas siete devuelven 303 sin sesion. Ninguna tiene extension, asi que
    // el filtro STATIC_EXT las deja pasar; el listado es la red de seguridad
    // contra alguien que les ponga una extension por error.
    const paginas = [
      '/alerts',
      '/telemetry',
      '/documents',
      '/drivers',
      '/geofences',
      '/fuel',
      '/fleets',
    ];
    for (const p of paginas) {
      expect(SW, `${p} no debe aparecer como ruta cacheable`).not.toMatch(
        new RegExp(`['"]${p.replace('/', '\\/')}/?['"]`),
      );
    }
  });
});

describe('la cache se versiona en cada build', () => {
  it('el nombre lleva un BUILD_ID, no un v1 fijo', () => {
    expect(SW).toMatch(/__BUILD_ID__/);
    expect(SW).not.toMatch(/CACHE\s*=\s*['"]gara-g-v\d+['"]/);
  });

  it('el activate purga toda cache que no sea la actual', () => {
    const i = SW.indexOf("addEventListener('activate'");
    expect(i).toBeGreaterThan(-1);
    const bloque = SW.slice(i, SW.indexOf('\n});', i));
    expect(bloque).toMatch(/caches\.delete/);
    expect(bloque).toMatch(/k\s*!==\s*CACHE/);
  });

  it('hay una via de purga explicita para logout', () => {
    expect(SW).toMatch(/PURGE_CACHES|GARA_PURGE/);
  });

  it('las funciones de red no escriben en cache', () => {
    // Ni networkOnly ni navigateNetworkFirst pueden hacer cache.put.
    for (const fn of ['networkOnly', 'navigateNetworkFirst']) {
      const i = SW.indexOf(`async function ${fn}`);
      expect(i, `falta ${fn}`).toBeGreaterThan(-1);
      const cuerpo = SW.slice(i, SW.indexOf('\n}', i));
      expect(cuerpo, `${fn} esta cacheando`).not.toMatch(/cache\.put/);
    }
  });
});
