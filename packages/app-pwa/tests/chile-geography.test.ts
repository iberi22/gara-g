/**
 * tests/chile-geography.test.ts — N2, N3 y N8 de la QA de entrega (2026-10-13).
 *
 * El entregable es una flota de camiones en Chile, pero los mapas, el boton "Simulador" de
 * telemetria y el formulario de geocercas traian coordenadas de Bogota escritas a mano:
 *
 *   - N2: `/fleet/tracking` abria sobre `4.6097 / -74.0817` (LiveMap.svelte).
 *   - N3: el ejemplo del campo de coordenadas era el poligono "Cliente Norte" de Bogota.
 *   - N8: centro del mapa de geocercas, del editor, del simulador OBD2 y poligono por defecto
 *     de GeofenceMap.
 *
 * Ahora salen de `MARKET.mapCenter` / `demoPolygon(MARKET)`. Es un test de ESTRUCTURA: la
 * geografia de cada mercado la fijan los tests de lib/market.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Constantes de Bogota que quedaban latentes en el codigo entregado. */
const BOGOTA = /4\.6097|-74\.0817|\[4\.57,\s*-74\.29\]|4\.7350?,-74\.0/;

const CON_MAPA = [
  'src/components/tracking/LiveMap.svelte',
  'src/components/geofence/GeofenceMap.svelte',
  'src/pages/fleet/geofences/index.astro',
  'src/pages/fleet/geofences/edit/[id].astro',
];

describe('geografia del entregable (Chile)', () => {
  it.each([...CON_MAPA, 'src/lib/obd2.ts'])('%s no hardcodea coordenadas de Colombia', (f) => {
    expect(read(f)).not.toMatch(BOGOTA);
  });

  it.each(CON_MAPA)('%s toma el centro del mapa del mercado', (f) => {
    const s = read(f);
    expect(s).toMatch(/MARKET\.mapCenter\.(lat|lng)/);
    expect(s).toMatch(/mapCenter\.zoom|mapCenter\.lat/);
  });

  it('el simulador OBD2 emite posiciones del mercado, no de Bogota', () => {
    const s = read('src/lib/obd2.ts');
    expect(s).toMatch(/latitude: MARKET\.mapCenter\.lat/);
    expect(s).toMatch(/longitude: MARKET\.mapCenter\.lng/);
    expect(s).toMatch(/MARKET\.mapCenter\.lat \+ /);
    expect(s).toMatch(/MARKET\.mapCenter\.lng \+ /);
  });

  it('el ejemplo de coordenadas de geocercas sale de demoPolygon, no de un literal', () => {
    const s = read('src/pages/fleet/geofences/index.astro');
    expect(s).toMatch(/demoPolygon\(MARKET\)/);
    expect(s).toMatch(/help: `Pares lat,lon separados por espacio\. Ej: \$\{polygonExample\}`/);
  });

  it('GeofenceMap usa el poligono del mercado en el estado inicial, el reset y el placeholder', () => {
    const s = read('src/components/geofence/GeofenceMap.svelte');
    expect(s).toMatch(/const defaultPolygon = demoPolygon\(MARKET\)/);
    expect(s).toMatch(/formPolygonStr = \$state\(defaultPolygon\)/);
    expect(s).toMatch(/formPolygonStr = defaultPolygon;/);
    expect(s).toMatch(/placeholder=\{defaultPolygon\}/);
    // El punto de prueba arranca en el baricentro del poligono (dentro, para cualquier mercado).
    expect(s).toMatch(/defaultPoints\.reduce/);
  });
});
