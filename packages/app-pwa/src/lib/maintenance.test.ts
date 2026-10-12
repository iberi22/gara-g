// maintenance.test.ts — Tests unitarios del calendario de mantenimiento (WAVE-11.05, issue #874).
import { describe, it, expect } from 'vitest';
import {
  parseISODate,
  toISODate,
  addMonthsISO,
  computeNextService,
  serviceState,
  filterByVehicle,
  sortByNextDate,
  groupByDay,
  SERVICE_INTERVAL_KM,
  type MaintenanceFields,
} from './maintenance.js';

const base: MaintenanceFields = {
  vehicleId: 'v1',
  type: 'preventivo',
  km: 50_000,
  date: '2026-01-15',
  cost: 300_000,
  workshop: 'Talleres del Norte',
  status: 'scheduled',
};

describe('parseISODate / toISODate', () => {
  it('parsea YYYY-MM-DD sin desfase UTC', () => {
    const d = parseISODate('2026-01-15');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(0);
    expect(d?.getDate()).toBe(15);
  });
  it('rechaza formatos inválidos', () => {
    expect(parseISODate('15/01/2026')).toBeNull();
    expect(parseISODate('')).toBeNull();
  });
  it('round-trip toISODate', () => {
    expect(toISODate(parseISODate('2026-03-05')!)).toBe('2026-03-05');
  });
});

describe('addMonthsISO', () => {
  it('suma 6 meses calendario', () => {
    expect(addMonthsISO('2026-01-15', 6)).toBe('2026-07-15');
  });
  it('retorna null con fecha inválida', () => {
    expect(addMonthsISO('no-fecha', 6)).toBeNull();
  });
});

describe('computeNextService', () => {
  it('deriva nextKm/nextDate cuando no vienen', () => {
    const { nextKm, nextDate } = computeNextService(base);
    expect(nextKm).toBe(50_000 + SERVICE_INTERVAL_KM);
    expect(nextDate).toBe('2026-07-15');
  });
  it('respeta nextKm/nextDate explícitos', () => {
    const { nextKm, nextDate } = computeNextService({
      ...base,
      nextKm: 62_000,
      nextDate: '2026-09-01',
    });
    expect(nextKm).toBe(62_000);
    expect(nextDate).toBe('2026-09-01');
  });
});

describe('serviceState', () => {
  it('completado/cancelado → completado', () => {
    expect(serviceState({ ...base, status: 'completed' })).toBe('completado');
    expect(serviceState({ ...base, status: 'cancelled' })).toBe('completado');
  });
  it('nextDate pasada → vencido', () => {
    expect(
      serviceState({ ...base, nextDate: '2026-01-01' }, '2026-06-01'),
    ).toBe('vencido');
  });
  it('nextDate dentro de 30 días → proximo', () => {
    expect(
      serviceState({ ...base, nextDate: '2026-06-15' }, '2026-06-01'),
    ).toBe('proximo');
  });
  it('nextDate lejana → ok', () => {
    expect(
      serviceState({ ...base, nextDate: '2026-12-01' }, '2026-06-01'),
    ).toBe('ok');
  });
});

describe('filterByVehicle', () => {
  const recs = [
    { ...base, vehicleId: 'v1' },
    { ...base, vehicleId: 'v2' },
  ];
  it('filtra por vehicleId', () => {
    expect(filterByVehicle(recs, 'v1')).toHaveLength(1);
  });
  it('all retorna todo', () => {
    expect(filterByVehicle(recs, 'all')).toHaveLength(2);
  });
});

describe('sortByNextDate', () => {
  it('ordena ascendente por nextDate', () => {
    const recs = [
      { ...base, nextDate: '2026-12-01' },
      { ...base, nextDate: '2026-03-01' },
    ];
    const sorted = sortByNextDate(recs);
    expect(sorted[0].nextDate).toBe('2026-03-01');
  });
});

describe('groupByDay', () => {
  it('agrupa por date', () => {
    const recs = [
      { ...base, date: '2026-02-01' },
      { ...base, date: '2026-02-01' },
      { ...base, date: '2026-03-01' },
    ];
    const grouped = groupByDay(recs);
    expect(grouped.get('2026-02-01')).toHaveLength(2);
    expect(grouped.get('2026-03-01')).toHaveLength(1);
  });
});
