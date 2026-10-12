/**
 * tests/leaflet-bundled-and-chart-colors.test.ts — wave-32/23 y /22 (parte LiveChart).
 *
 * - El CSS/JS de Leaflet sale del paquete (`leaflet` ya es dependencia), no de unpkg: una PWA
 *   instalada sin red debe pintar el mapa.
 * - Chart.js pinta en un <canvas>: no resuelve `var(--x)`. Los colores de las lineas deben ser
 *   valores concretos leidos del tema (getComputedStyle), nunca cadenas CSS.
 * - La replica de telemetria ya no usa y-webrtc/y-indexeddb (senalizacion publica caida).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const MAP_FILES = [
  'src/components/tracking/LiveMap.svelte',
  'src/components/geofence/GeofenceMap.svelte',
  'src/pages/fleet/geofences/index.astro',
];

describe('Leaflet empaquetado', () => {
  it.each(MAP_FILES)('%s no carga nada de unpkg', (f) => {
    expect(read(f)).not.toMatch(/unpkg\.com/);
  });

  it.each(['src/components/tracking/LiveMap.svelte', 'src/components/geofence/GeofenceMap.svelte'])(
    '%s importa el CSS local dentro del import() dinamico',
    (f) => {
      expect(read(f).match(/import\('leaflet\/dist\/leaflet\.css'\)/g)).toHaveLength(1);
    },
  );

  it('/fleet/geofences importa el CSS y carga Leaflet con import(), sin <script src> externo ni is:inline', () => {
    const src = read('src/pages/fleet/geofences/index.astro');
    expect(src).toContain("import 'leaflet/dist/leaflet.css'");
    expect(src).toContain("await import('leaflet')");
    expect(src).not.toMatch(/<script[^>]*\bsrc=/);
    expect(src).not.toMatch(/<script[^>]*is:inline/);
  });
});

describe('LiveChart: colores del canvas', () => {
  const src = read('src/components/telemetry/LiveChart.svelte');

  it('lee los tokens con getComputedStyle y no pasa var() a Chart.js', () => {
    expect(src).toContain('getPropertyValue');
    // Ningun color de dataset ni de opciones es una cadena var(...): el unico var() permitido
    // es el del punto de estado, que es HTML y no canvas.
    const chartPart = src.slice(src.indexOf('function applyChartTheme'), src.indexOf('function renderVisuals'));
    expect(chartPart).not.toMatch(/var\(--/);
  });

  it('usa solo tokens que existen (--swal-accent, --swal-warning, --swal-success, --swal-text-*)', () => {
    const used = [...src.matchAll(/token\('(--[a-z-]+)'\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(4);
    const themeCss = read('src/styles/swal-taller.css');
    for (const t of new Set(used)) expect(themeCss, `token ${t} sin definir`).toContain(`${t}:`);
  });
});

describe('replica de telemetria sin y-webrtc', () => {
  it('LiveChart no importa y-webrtc ni usa servidores de senalizacion de Yjs', () => {
    const src = read('src/components/telemetry/LiveChart.svelte');
    expect(src).not.toMatch(/y-webrtc|WebrtcProvider|signaling\.yjs\.dev|herokuapp/);
    expect(src).toContain('attachDocToMesh');
  });

  it('y-webrtc / y-indexeddb ya no son dependencias de app-pwa', () => {
    const pkg = JSON.parse(read('package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps).not.toHaveProperty('y-webrtc');
    expect(deps).not.toHaveProperty('y-indexeddb');
  });
});
