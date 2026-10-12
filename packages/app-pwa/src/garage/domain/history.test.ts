/**
 * history.test.ts — Linea de tiempo ordenada y DTC agrupados.
 *
 * El caso de los DTC es el que mas se nota en la UI: un mismo codigo en 40 muestras
 * llenaba la pantalla de filas identicas. Agrupado es como lo lee un tecnico.
 */
import { describe, expect, it } from 'vitest';
import { buildHistory, summarizeDtc } from './history';
import type { DocumentRow, MaintenanceRow, TelemetryRow } from './records';

const base = {
  instance_id: 'inst',
  created_at: '',
  updated_at: '',
  vehicleId: 'v1',
};

const maint = (extra: Partial<MaintenanceRow>): MaintenanceRow => ({
  id: 'm1',
  ...base,
  type: 'preventivo',
  km: 0,
  date: '2026-01-01',
  cost: 0,
  workshop: '',
  status: 'completed',
  ...extra,
});

describe('buildHistory: ordenado mas reciente primero', () => {
  const history = buildHistory({
    vehicleId: 'v1',
    family: 'moto',
    maintenance: [
      maint({ id: 'a', type: 'preventivo', date: '2026-01-10', km: 1000, cost: 50_000 }),
      maint({ id: 'c', type: 'correctivo', date: '2026-05-20', km: 9000, cost: 300_000 }),
    ],
    fuelLogs: [
      {
        id: 'f1',
        ...base,
        date: '2026-03-15',
        km: 5000,
        gallons: 2,
        cost: 30_000,
        kmPerGallon: 25,
      },
    ],
    documents: [{ id: 'd1', ...base, kind: 'SOAT', expiry: '2027-01-01' } as DocumentRow],
    alerts: [
      {
        id: 'al1',
        ...base,
        kind: 'speed',
        severity: 'high',
        message: 'Exceso de velocidad',
        acknowledged: false,
        created_at: '2026-02-01T10:00:00.000Z',
      },
    ],
    telemetry: [],
  });

  it('devuelve mas reciente primero', () => {
    const dates = history.map((e) => e.at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('incluye un evento de cada fuente', () => {
    const kinds = new Set(history.map((e) => e.kind));
    expect(kinds.has('maintenance')).toBe(true);
    expect(kinds.has('fuel')).toBe(true);
    expect(kinds.has('document')).toBe(true);
    expect(kinds.has('alert')).toBe(true);
  });

  it('el evento mas reciente es el de fecha mayor (el SOAT de 2027 va el primero)', () => {
    expect(history[0]?.id).toBe('hist-doc-d1');
    expect(history.find((e) => e.id === 'hist-maint-c')).toBeDefined();
  });

  it('dentro del mismo dia el desempate es estable (por titulo, no por orden de insercion)', () => {
    const sameDay = buildHistory({
      vehicleId: 'v1',
      family: 'moto',
      maintenance: [
        maint({ id: 'z', type: 'Zapata', date: '2026-02-02' }),
        maint({ id: 'a', type: 'Alineacion', date: '2026-02-02' }),
      ],
      fuelLogs: [],
      documents: [],
      alerts: [],
      telemetry: [],
    });
    expect(sameDay.map((e) => e.title)).toEqual(['Alineacion', 'Zapata']);
  });

  it('un mantenimiento que habla de una pieza es part_change y trae sus ranuras', () => {
    const part = history.find((e) => e.id === 'hist-maint-a');
    // "preventivo" no nombra ninguna pieza: queda como mantenimiento.
    expect(part?.kind).toBe('maintenance');

    const brake = buildHistory({
      vehicleId: 'v1',
      family: 'moto',
      maintenance: [maint({ id: 'b', type: 'Cambio de pastillas de freno', date: '2026-04-01' })],
      fuelLogs: [],
      documents: [],
      alerts: [],
      telemetry: [],
    });
    expect(brake[0]?.kind).toBe('part_change');
    expect(brake[0]?.slotIds).toContain('brake_front');
  });

  it('el gasto de una carga de combustible lleva km y costo', () => {
    const fuel = history.find((e) => e.kind === 'fuel');
    expect(fuel?.km).toBe(5000);
    expect(fuel?.costCOP).toBe(30_000);
  });

  it('una alerta sin fecha no aparece (no se puede ordenar lo que no se sabe cuando)', () => {
    const h = buildHistory({
      vehicleId: 'v1',
      family: 'moto',
      maintenance: [],
      fuelLogs: [],
      documents: [],
      alerts: [{ id: 'x', ...base, message: 'sin fecha' }],
      telemetry: [],
    });
    expect(h).toHaveLength(0);
  });
});

describe('summarizeDtc: codigos repetidos agrupados', () => {
  const samples: TelemetryRow[] = [
    { id: 't1', ...base, vin: 'V1', timestamp: 1_700_000_000_000, troubleCodes: ['P0301'] },
    { id: 't2', ...base, vin: 'V1', timestamp: 1_700_000_060_000, troubleCodes: ['p0301'] },
    {
      id: 't3',
      ...base,
      vin: 'V1',
      timestamp: 1_700_000_120_000,
      troubleCodes: ['P0301', 'P0420'],
    },
    { id: 't4', ...base, vin: 'V1', timestamp: 1_700_000_180_000, troubleCodes: [] },
  ];

  it('un mismo codigo en varias muestras es UN evento con contador', () => {
    const dtc = summarizeDtc(samples);
    const p0301 = dtc.find((d) => d.code === 'P0301');
    expect(p0301?.count).toBe(3);
    expect(dtc).toHaveLength(2);
  });

  it('normaliza a mayusculas (el OBD puede mandar minusculas)', () => {
    expect(summarizeDtc(samples).map((d) => d.code)).toContain('P0301');
  });

  it('guarda la primera y la ultima vez visto', () => {
    const p0301 = summarizeDtc(samples).find((d) => d.code === 'P0301');
    expect(p0301?.firstSeen).toBe(new Date(1_700_000_000_000).toISOString());
    expect(p0301?.lastSeen).toBe(new Date(1_700_000_120_000).toISOString());
  });

  it('sin codigos no hay resumen', () => {
    expect(
      summarizeDtc([{ id: 't', ...base, vin: 'V', timestamp: 1, troubleCodes: [] }]),
    ).toHaveLength(0);
  });

  it('el historial agrupa los DTC en un evento por codigo, con fecha de la ultima vez', () => {
    const h = buildHistory({
      vehicleId: 'v1',
      family: 'moto',
      maintenance: [],
      fuelLogs: [],
      documents: [],
      alerts: [],
      telemetry: samples,
    });
    const dtcEvents = h.filter((e) => e.kind === 'dtc');
    expect(dtcEvents).toHaveLength(2);
    const p0301 = dtcEvents.find((e) => e.id === 'hist-dtc-P0301');
    expect(p0301?.at).toBe(new Date(1_700_000_120_000).toISOString());
    expect(p0301?.detail).toContain('3 veces');
  });
});
