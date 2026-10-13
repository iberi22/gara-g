/**
 * tests/chile-wording.test.ts — N4 y N7 de la QA de entrega (2026-10-13).
 *
 * N4: el termino colombiano "volqueta" salia en la portada, los ajustes, el formulario de
 * vehiculo, el catalogo, el expediente y los desplegables de vehiculo de media docena de
 * pantallas de una entrega a Chile, donde el camion es "tolva" / "camion tolva".
 *
 * N7: el tier heredado "SOCIO" convivia con el actual (`payg`) en la AUI, el conmutador de
 * interfaz y ProBadge. El nombre visible ahora vive en domain.config.ts.
 *
 * Tests de ESTRUCTURA sobre el fuente: el vocabulario real lo fijan los tests de lib/market.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKETS } from '../src/lib/market';
import { VEHICLE_TYPE_LABELS, vehicleDisplayName, vehicleTypeLabel } from '../src/lib/vehicleCatalog';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('N4 · el camion de volco se llama como en el mercado', () => {
  it('el tipo guardado "volqueta" se muestra "Tolva" en Chile y "Volqueta" en Colombia', () => {
    expect(vehicleTypeLabel('volqueta', MARKETS.CL)).toBe('Tolva');
    expect(vehicleTypeLabel('volqueta', MARKETS.CO)).toBe('Volqueta');
    // El resto de tipos no se toca en ninguno de los dos mercados.
    expect(vehicleTypeLabel('estacas', MARKETS.CL)).toBe('Camion de estacas');
    expect(vehicleTypeLabel('estacas', MARKETS.CO)).toBe('Camion de estacas');
  });

  it('el tipo que no esta en el catalogo se devuelve tal cual: nunca se inventa', () => {
    expect(vehicleTypeLabel('grúa horquilla', MARKETS.CL)).toBe('grúa horquilla');
    expect(vehicleTypeLabel(undefined, MARKETS.CL)).toBe('');
  });

  it('el nombre visible de un vehiculo traduce el modelo del fabricante', () => {
    expect(vehicleDisplayName({ make: 'Kenworth', model: 'T800 Volqueta' }, MARKETS.CL)).toBe(
      'Kenworth T800 Tolva',
    );
    expect(vehicleDisplayName({ make: 'Kenworth', model: 'T800 Volqueta' }, MARKETS.CO)).toBe(
      'Kenworth T800 Volqueta',
    );
    expect(vehicleDisplayName({ model: '7600 Volqueta' }, MARKETS.CL)).toBe('7600 Tolva');
    // Sin marca ni modelo cae al nombre del vehiculo, y sin nada, a la patente.
    expect(vehicleDisplayName({ name: 'Camion 7' }, MARKETS.CL)).toBe('Camion 7');
    expect(vehicleDisplayName({ plate: 'ZZBC-11' }, MARKETS.CL)).toBe('ZZBC-11');
  });

  const PANTALLAS_CON_MODELO = [
    'src/pages/fleet/alerts.astro',
    'src/pages/fleet/documents/index.astro',
    'src/pages/fleet/documents/edit/[id].astro',
    'src/pages/fleet/fuel-logs.astro',
    'src/pages/fleet/maintenance.astro',
    'src/pages/fleet/maintenance/edit/[id].astro',
    'src/pages/fleet/garage/flota-demo-chile.astro',
    'src/components/garage-dossier/VehicleDossier.svelte',
    'src/components/GameGarage.svelte',
  ];

  it.each(PANTALLAS_CON_MODELO)('%s arma el nombre del vehiculo con vehicleDisplayName', (f) => {
    const s = read(f);
    expect(s).toMatch(/vehicleDisplayName\(/);
    // Y no concatena el modelo crudo a mano.
    expect(s).not.toMatch(/\$\{v\.make\} \$\{v\.model\}/);
    expect(s).not.toMatch(/\$\{v\.make \?\? ''\} \$\{v\.model \?\? ''\}/);
  });

  it('el catalogo muestra modelo, repuesto y tipo en el vocabulario del mercado', () => {
    const s = read('src/pages/fleet/catalog.astro');
    expect(s).toMatch(/localizeText\(model\.model, MARKET\)/);
    expect(s).toMatch(/vehicleTypeLabel\(model\.type, MARKET\)/);
    expect(s).toMatch(/localizeText\(part\.name, MARKET\)/);
    // Ya no se pinta el valor guardado crudo.
    expect(s).not.toMatch(/\{model\.type\}/);
  });

  it('la tabla de vehiculos usa claves de presentacion, sin tocar el valor guardado', () => {
    const s = read('src/pages/fleet/vehicles/index.astro');
    expect(s).toMatch(/key: 'modelLabel'/);
    expect(s).toMatch(/key: 'typeLabel'/);
    expect(s).not.toMatch(/key: 'type', label: 'Tipo'/);
    expect(s).toMatch(/typeLabel: vehicleTypeLabel\(v\.type, MARKET\)/);
  });

  it('los tipos del catalogo que se ofrecen en el formulario salen del mercado', () => {
    // VEHICLE_TYPE_LABELS se construye con el mercado activo: en un build CL el desplegable
    // ofrece "Tolva", no "Volqueta".
    const s = read('src/lib/vehicleCatalog.ts');
    expect(s).toMatch(/TYPE_LABELS_BASE\.map\(\(t\) => \(\{ \.\.\.t, label: localizeText\(t\.label, MARKET\) \}\)\)/);
    expect(s).toMatch(/export function vehicleTypeLabel/);
    expect(s).toMatch(/export function vehicleDisplayName/);
    expect(s).toMatch(/export const VEHICLE_TYPE_LABELS/);
  });

  it('la portada, los ajustes, el onboarding y el formulario pasan el termino por localizeText', () => {
    for (const f of [
      'src/pages/index.astro',
      'src/lib/prefs.config.ts',
      'src/lib/vehicleForm.ts',
      'src/components/prefs/OnboardingApp.svelte',
    ]) {
      // Sin lineas de comentario: el termino puede nombrarse al explicar la traduccion.
      const s = read(f)
        .split('\n')
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('<!--');
        })
        .join('\n');
      const hits = [...s.matchAll(/[^\n]{0,70}olqueta[^\n]{0,25}/g)].map((m) => m[0]);
      expect(hits.length, `${f} no menciona el termino`).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit, `${f}: ${hit}`).toMatch(/localizeText\(/);
      }
    }
  });
});

describe('N7 · el tier visible ya no se llama SOCIO', () => {
  const LEGADO: Record<string, string[]> = {
    'src/components/AuiInterface.svelte': [
      'Cuenta Socio',
      'TIER SOCIO',
      'Modo Socio',
      'tipo Socio',
      'tier Socio',
      'Socio PAYG',
      'Socio / PAYG',
    ],
    'src/components/InterfaceSwitcher.astro': ["badge.textContent = 'SOCIO'", 'cuenta Socio'],
    'src/components/ProBadge.svelte': ['SOCIO CLOUD', 'SOCIO INACTIVO'],
  };

  it.each(Object.keys(LEGADO))('%s no muestra el nombre de tier heredado', (f) => {
    const s = read(f);
    for (const texto of LEGADO[f]) {
      expect(s, `${f}: ${texto}`).not.toContain(texto);
    }
  });

  it('el nombre visible del tier vive una sola vez, en domain.config.ts', () => {
    const cfg = read('src/lib/domain.config.ts');
    expect(cfg).toMatch(/tierLabel: 'PAYG'/);
    expect(cfg).toMatch(/export const TIER_LABEL: string = domainConfig\.billing\.tierLabel/);
    // El identificador del tier sigue siendo `payg` (el cambio es solo del nombre visible).
    expect(cfg).toMatch(/tier: 'payg' as const/);
  });

  it('los tres componentes importan el nombre en vez de escribirlo', () => {
    for (const f of [
      'src/components/AuiInterface.svelte',
      'src/components/ProBadge.svelte',
      'src/components/InterfaceSwitcher.astro',
    ]) {
      const s = read(f);
      expect(s, f).toMatch(/TIER_LABEL/);
      expect(s, f).toMatch(/domain\.config/);
    }
    // El script inline del conmutador no puede importar: lee la etiqueta del atributo.
    const sw = read('src/components/InterfaceSwitcher.astro');
    expect(sw).toMatch(/data-tier-label=\{TIER_LABEL\}/);
    expect(sw).toMatch(/badge\.getAttribute\('data-tier-label'\)/);
  });

  it('la etiqueta del camion de volco que ve el usuario es la del mercado activo', () => {
    // El desplegable de tipos se construye con el mercado activo: en un build CL ofrece "Tolva".
    expect(VEHICLE_TYPE_LABELS.find((t) => t.value === 'volqueta')?.label).toBe('Tolva');
  });
});
