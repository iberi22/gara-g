/**
 * partsHealth.test.ts — La salud por km y la coincidencia mantenimiento -> pieza.
 *
 * Se prueban los bordes (0 %, 15 %, 35 %, vencido) porque son los umbrales que el motor 3D
 * y el HUD usan para pintar la pieza; un `>=` donde debe haber `>` cambia el color de un
 * vehiculo real sin que ningun otro test se entere.
 */
import { describe, expect, it } from 'vitest';
import {
  computePartStates,
  overallHealthPct,
  serviceMatches,
  statusForHealth,
} from './partsHealth';
import type { MaintenanceRow } from './records';

const maint = (extra: Partial<MaintenanceRow> = {}): MaintenanceRow => ({
  id: 'm1',
  instance_id: 'inst',
  created_at: '',
  updated_at: '',
  vehicleId: 'v1',
  type: 'correctivo',
  km: 0,
  date: '2026-01-01',
  cost: 0,
  workshop: '',
  status: 'completed',
  ...extra,
});

describe('statusForHealth: umbrales del contrato', () => {
  it('0 % es overdue (vencido, no critical)', () => {
    expect(statusForHealth(0)).toBe('overdue');
  });
  it('por debajo de 15 % es critical', () => {
    expect(statusForHealth(14.9)).toBe('critical');
    expect(statusForHealth(0.1)).toBe('critical');
  });
  it('15 % exacto ya no es critical sino warn', () => {
    expect(statusForHealth(15)).toBe('warn');
  });
  it('por debajo de 35 % es warn', () => {
    expect(statusForHealth(34.9)).toBe('warn');
  });
  it('35 % exacto ya es ok', () => {
    expect(statusForHealth(35)).toBe('ok');
    expect(statusForHealth(100)).toBe('ok');
  });
  it('sin dato es unknown', () => {
    expect(statusForHealth(null)).toBe('unknown');
  });
});

describe('computePartStates: salud = 100 x (1 - km desde el cambio / vida util)', () => {
  // FZ16: aceite vida util 4.000 km; filtro de aceite 4.000 km.
  it('recalcula desde el ultimo mantenimiento que cambio la pieza', () => {
    const parts = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 20_000,
      maintenance: [
        maint({ id: 'm1', type: 'Cambio de aceite', km: 12_000, date: '2026-02-01' }),
        maint({ id: 'm2', type: 'Cambio de aceite', km: 16_000, date: '2026-05-01' }),
      ],
    });
    const oil = parts.find((p) => p.slotId === 'engine_oil');
    // Ultimo cambio a 16.000 con vida 4.000: faltan 8.000 -> el odometro esta en el tope.
    expect(oil?.kmSinceService).toBe(4000);
    expect(oil?.healthPct).toBe(0);
    expect(oil?.status).toBe('overdue');
    expect(oil?.nextDueKm).toBe(20_000);
  });

  it('acota la salud a 100 cuando el cambio es mas reciente que el odometro', () => {
    const parts = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 10_000,
      maintenance: [maint({ type: 'Cambio de aceite', km: 10_000, date: '2026-02-01' })],
    });
    const oil = parts.find((p) => p.slotId === 'engine_oil');
    expect(oil?.healthPct).toBe(100);
    expect(oil?.status).toBe('ok');
  });

  it('15 % y 35 % exactos salen de la cuenta por km', () => {
    // Vida util 4.000: 15 % = quedan 3.400 km; 35 % = quedan 2.600 km.
    const at15 = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 3_400,
      maintenance: [],
    }).find((p) => p.slotId === 'engine_oil');
    expect(at15?.healthPct).toBe(15);
    expect(at15?.status).toBe('warn');

    const at35 = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 2_600,
      maintenance: [],
    }).find((p) => p.slotId === 'engine_oil');
    expect(at35?.healthPct).toBe(35);
    expect(at35?.status).toBe('ok');
  });

  it('sin mantenimiento estima desde km 0 mientras el odometro no pase la vida util', () => {
    const parts = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 1_000,
    });
    const oil = parts.find((p) => p.slotId === 'engine_oil');
    expect(oil?.healthPct).toBe(75);
    expect(oil?.lastServiceKm).toBeUndefined();
    expect(oil?.status).toBe('ok');
  });

  it('sin mantenimiento y con el odometro pasado la vida util: unknown, no salud inventada', () => {
    const parts = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 40_000,
    });
    const oil = parts.find((p) => p.slotId === 'engine_oil');
    expect(oil?.healthPct).toBeNull();
    expect(oil?.status).toBe('unknown');
  });

  it('sin odometro todo queda unknown pero la ranura sigue en la lista (el 3D la construye)', () => {
    const parts = computePartStates({ family: 'moto', make: 'Yamaha', model: 'FZ16' });
    expect(parts.length).toBeGreaterThan(10);
    expect(parts.every((p) => p.healthPct === null && p.status === 'unknown')).toBe(true);
  });

  it('da costo estimado y vida util del catalogo', () => {
    const parts = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 100,
    });
    const oil = parts.find((p) => p.slotId === 'engine_oil');
    expect(oil?.lifeKm).toBe(4000);
    expect(oil?.estCostCOP).toBe(38000);
  });
});

describe('coincidencia mantenimiento -> pieza', () => {
  it('"Cambio de aceite" cambia la pieza engine_oil aunque el repuesto se llame "Aceite 10W-40 moto"', () => {
    const matches = serviceMatches({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 5000,
      maintenance: [maint({ type: 'Cambio de aceite', km: 5000 })],
    });
    expect(matches.get('engine_oil')?.partName).toBe('Aceite 10W-40 moto');
    expect(matches.get('engine_oil')?.record?.id).toBe('m1');
  });

  it('"Cambio de filtros de aire" NO cuenta como cambio del filtro de aceite', () => {
    // Hilux tiene los tres filtros del catalogo, asi que el caso se puede probar entero.
    const matches = serviceMatches({
      family: 'car',
      make: 'Toyota',
      model: 'Hilux',
      odometerKm: 5000,
      maintenance: [maint({ type: 'Cambio de filtro de aire', km: 5000 })],
    });
    expect(matches.get('oil_filter')?.record).toBeNull();
    expect(matches.get('air_filter')?.record?.id).toBe('m1');
  });

  it('"Cambio de aceite" si cambia el filtro de aceite (y no el de aire)', () => {
    const matches = serviceMatches({
      family: 'car',
      make: 'Toyota',
      model: 'Hilux',
      odometerKm: 5000,
      maintenance: [maint({ type: 'Cambio de aceite y filtro de aceite', km: 5000 })],
    });
    expect(matches.get('oil_filter')?.record?.id).toBe('m1');
    expect(matches.get('air_filter')?.record).toBeNull();
  });

  it('sin historial la pieza conserva vida util y costo del catalogo', () => {
    const matches = serviceMatches({ family: 'moto', make: 'Yamaha', model: 'FZ16' });
    expect(matches.get('engine_oil')).toMatchObject({
      lifeKm: 4000,
      avgCostCOP: 38000,
      record: null,
    });
  });

  it('busca tambien en notas y descripcion, no solo en el tipo', () => {
    const matches = serviceMatches({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 5000,
      maintenance: [
        maint({ type: 'preventivo', notes: 'Se reemplazaron las pastillas de freno', km: 5000 }),
      ],
    });
    expect(matches.get('brake_front')).toBeDefined();
  });

  it('con varios mantenimientos que coinciden gana el mas reciente', () => {
    const matches = serviceMatches({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 5000,
      maintenance: [
        maint({ id: 'a', type: 'Cambio de aceite', km: 1000, date: '2025-01-01' }),
        maint({ id: 'b', type: 'Cambio de aceite', km: 4000, date: '2026-01-01' }),
      ],
    });
    expect(matches.get('engine_oil')?.record?.id).toBe('b');
  });

  it('un texto que no habla de ninguna pieza no aporta historial', () => {
    const matches = serviceMatches({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 5000,
      maintenance: [maint({ type: 'preventivo', notes: 'Lavado yRevision general', km: 5000 })],
    });
    expect([...matches.values()].every((m) => m.record === null)).toBe(true);
  });

  it('una marca o modelo fuera del catalogo no rompe: todas las piezas quedan unknown', () => {
    const parts = computePartStates({
      family: 'car',
      make: 'MarcaInventada',
      model: 'ModeloX',
      odometerKm: 1000,
      maintenance: [maint({ type: 'Cambio de aceite', km: 900 })],
    });
    expect(parts.every((p) => p.healthPct === null)).toBe(true);
  });
});

describe('overallHealthPct: promedio ponderado con frenos y llantas al doble', () => {
  it('las piezas unknown no bajan la salud (no es "no lo se" = 0)', () => {
    const parts = computePartStates({
      family: 'moto',
      make: 'Yamaha',
      model: 'FZ16',
      odometerKm: 1_000,
    });
    // A 1.000 km el aceite (vida 4.000) vale 75; el buje (vida 12.000) y las pastillas
    // (vida 15.000) valen mas. Las ranuras sin repuesto en el catalogo quedan unknown y no
    // entran en el promedio.
    const withData = parts.filter((p) => p.healthPct !== null);
    expect(withData.length).toBeGreaterThan(1);
    expect(withData.every((p) => (p.healthPct ?? 0) >= 75)).toBe(true);
    const health = overallHealthPct(parts);
    expect(health).not.toBeNull();
    expect(health ?? 0).toBeGreaterThanOrEqual(75);
  });

  it('sin ninguna pieza con dato devuelve null, no 0', () => {
    expect(overallHealthPct([])).toBeNull();
    expect(
      overallHealthPct([
        { slotId: 'engine', label: 'Motor', category: 'motor', healthPct: null, status: 'unknown' },
      ]),
    ).toBeNull();
  });

  it('los frenos pesan doble: bajarlos mas que un escapes el promedio', () => {
    const health = overallHealthPct([
      { slotId: 'brake_fl', label: 'Freno', category: 'frenos', healthPct: 0, status: 'overdue' },
      { slotId: 'exhaust', label: 'Escape', category: 'escape', healthPct: 100, status: 'ok' },
    ]);
    // (0*2 + 100*1) / 3 = 33
    expect(health).toBe(33);
  });
});
