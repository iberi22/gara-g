/**
 * review-fixes.test.ts — Regresiones de la revision cruzada del dominio (deepseek, 2026-10-01).
 *
 * Cada caso reproduce un defecto que el revisor verifico ejecutando el codigo:
 * nombre vacio con solo placa, prefijos de 1 letra que casaban cualquier repuesto,
 * compromisos fantasma "vencido a 10.000 km" y muestras de telemetria de 1970.
 */
import { describe, expect, it } from 'vitest';
import { normalizeSample } from '../telemetry/ingest';
import { buildCommitments } from './commitments';
import { computePartStates } from './partsHealth';
import { vehicleNameOf } from './records';

const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('vehicleNameOf', () => {
  it('sin nombre, marca ni modelo usa la placa', () => {
    expect(vehicleNameOf({ id: 'v1', plate: 'ABC123' })).toBe('ABC123');
  });
  it('sin nada devuelve el generico', () => {
    expect(vehicleNameOf({ id: 'v1' })).toBe('Vehículo');
  });
});

describe('coincidencia mantenimiento → pieza', () => {
  it('"Revision a fondo" no cuenta como cambio de aceite ni de amortiguador', () => {
    const parts = computePartStates({
      family: 'car',
      make: 'Toyota',
      model: 'Hilux',
      odometerKm: 30_000,
      maintenance: [{ id: 'm1', vehicleId: 'v1', type: 'Revision a fondo', km: 29_000, date: '2026-06-01', status: 'completed' }],
    });
    for (const slot of ['engine_oil', 'suspension_front', 'suspension_rear']) {
      expect(parts.find((p) => p.slotId === slot)?.lastServiceKm, slot).not.toBe(29_000);
    }
  });
});

describe('compromisos de mantenimiento', () => {
  it('un mantenimiento programado sin km ni fecha no genera un compromiso fantasma', () => {
    const out = buildCommitments({
      vehicle: { id: 'v1' },
      family: 'car',
      odometerKm: 64_000,
      parts: [],
      maintenance: [{ id: 'm1', vehicleId: 'v1', type: 'Cambio de correa', status: 'scheduled' }],
      documents: [],
      now: NOW,
    });
    expect(out.filter((c) => c.kind === 'maintenance')).toHaveLength(0);
  });
});

describe('ingesta de telemetria', () => {
  // VIN valido (sin I, O ni Q).
  const base = { vin: '9C2KC1670LR000001', speedKmh: 40, source: 'apk' };
  it('rechaza un ts de 1970', () => {
    const r = normalizeSample({ ...base, ts: 0 }, NOW.getTime());
    expect(r.ok).toBe(false);
  });
  it('rechaza muestras de hace mas de 30 dias', () => {
    const r = normalizeSample({ ...base, ts: new Date(NOW.getTime() - 40 * 86_400_000).toISOString() }, NOW.getTime());
    expect(r).toMatchObject({ ok: false, reason: 'ts_antiguo' });
  });
  it('acepta lo acumulado de hace unos dias sin red', () => {
    const r = normalizeSample({ ...base, ts: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }, NOW.getTime());
    expect(r.ok).toBe(true);
  });
});

describe('compromisos de piezas por repuesto', () => {
  it('las pastillas delanteras (dos ranuras, mismo repuesto y vencimiento) son un solo compromiso', () => {
    const pad = (slotId: string) => ({
      slotId,
      label: 'Pastillas freno delantero',
      category: 'frenos' as const,
      healthPct: 20,
      status: 'warn' as const,
      nextDueKm: 65_000,
    });
    const out = buildCommitments({
      vehicle: { id: 'v1' },
      family: 'car',
      odometerKm: 64_000,
      parts: [pad('brake_fl'), pad('brake_fr')],
      maintenance: [],
      documents: [],
      now: NOW,
    });
    expect(out.filter((c) => c.kind === 'part_change')).toHaveLength(1);
  });
});
