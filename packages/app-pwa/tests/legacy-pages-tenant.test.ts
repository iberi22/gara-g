import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// Paginas fuera de /fleet: el tenant sale SIEMPRE de la sesion validada. Antes /alerts y
// /documents leian ?instanceId= (o 'default'), /fuel caia a la demo, /drivers y /fleets usaban
// DEFAULT_INSTANCE_ID: cualquier usuario veia o escribia en el tenant por defecto.
const PAGES = ['alerts', 'fuel', 'drivers', 'fleets', 'documents', 'geofences'];

describe('paginas heredadas: tenant de la sesion', () => {
  for (const name of PAGES) {
    it(`/${name} usa instanceIdFor y ningun tenant fijo`, () => {
      const page = src(`pages/${name}/index.astro`);
      expect(page).toMatch(/instanceIdFor\(Astro\.request, Astro\.locals\)/);
      expect(page).not.toContain('DEFAULT_INSTANCE_ID');
      expect(page).not.toContain('domainConfig.instanceId');
      expect(page).not.toMatch(/searchParams\.get\('instanceId'\)/);
      expect(page).not.toMatch(/\|\|\s*'default'/);
    });
  }
});

describe('formulario de documentos: vehiculo elegido por placa', () => {
  it('/fleet/documents y su edicion usan un select de vehiculos del tenant', () => {
    for (const p of ['pages/fleet/documents/index.astro', 'pages/fleet/documents/edit/[id].astro']) {
      const page = src(p);
      expect(page).toContain('vehicleOptions');
      expect(page).toMatch(/name: 'vehicleId'[^}]*type: 'select'/);
      expect(page).not.toContain("label: 'ID Vehículo'");
    }
  });
  it('la boveda /documents tambien', () => {
    expect(src('components/document/DocumentVault.svelte')).toMatch(/<select\s+id="vehicleId"/);
    expect(src('pages/documents/index.astro')).toContain("listEntities('vehicle', instanceId)");
  });
});

describe('telemetria en espanol y sin solapes a 360 px', () => {
  const chart = src('components/telemetry/LiveChart.svelte');
  it('sin textos en ingles', () => {
    for (const t of ['Ingest OBD2 Sample', 'Speed Telemetry', 'Fuel Tank Level', 'Trouble Codes (DTC)', 'Mesh unavailable', 'Select VIN']) {
      expect(chart).not.toContain(t);
    }
    expect(chart).toContain('Malla no disponible (solo local)');
  });
  it('la columna de combustible y codigos solo fija la altura en escritorio', () => {
    expect(chart).not.toMatch(/grid grid-rows-2 gap-4 h-80/);
    expect(chart).toContain('lg:grid-rows-2 lg:h-80');
  });
});

describe('cotas y estado vacio dentro del visor', () => {
  it('la caja del LARGO se limita al ancho del lienzo', () => {
    expect(src('components/garage/DimensionOverlay.svelte')).toContain('Math.min(Math.max(raw.x, half), maxX)');
  });
  it('el mensaje de tabla vacia no se desplaza con la tabla', () => {
    const t = src('components/GenericTableAstro.astro');
    expect(t).toContain('class="g-empty-msg"');
    expect(t).toMatch(/\.g-empty-msg\s*\{[^}]*position: sticky/);
  });
});
