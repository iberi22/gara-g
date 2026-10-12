/**
 * telemetry/ingest.test.ts — Validacion, limites y mapeo a la entidad `telemetry`.
 *
 * Los casos de rango y de futuro son los que importan: son los que impiden que un sensor
 * con dato imposible contamine la grafica y que "en linea" mienta.
 */
import { describe, expect, it } from 'vitest';
import {
  FUTURE_TOLERANCE_MS,
  MAX_BATCH,
  fromTelemetryRow,
  ingestSamples,
  isValidVin,
  normalizeSample,
  toTelemetryRow,
} from './ingest';

const NOW = Date.parse('2026-06-15T12:00:00.000Z');
const iso = (msOffset = 0) => new Date(NOW + msOffset).toISOString();

const sample = (extra: Record<string, unknown> = {}) => ({
  vin: '1HGCM82633A004352',
  ts: iso(),
  speedKmh: 42,
  source: 'apk',
  ...extra,
});

describe('isValidVin', () => {
  it('acepta 11 a 17 caracteres alfanumericos sin I/O/Q', () => {
    expect(isValidVin('1HGCM82633A004352')).toBe(true); // 17
    expect(isValidVin('MOCKVIN0MOTO01')).toBe(true); // 14
    expect(isValidVin('ABC12345678')).toBe(true); // 11
  });
  it('rechaza longitud fuera de rango o caracteres no validos', () => {
    expect(isValidVin('ABC1234567')).toBe(false); // 10
    expect(isValidVin('A'.repeat(18))).toBe(false);
    expect(isValidVin('1HGCM82633A00435I')).toBe(false); // I prohibida
    expect(isValidVin('')).toBe(false);
    expect(isValidVin(undefined)).toBe(false);
  });
});

describe('normalizeSample: validacion campo a campo', () => {
  it('acepta una muestra completa y la normaliza', () => {
    const res = normalizeSample(
      sample({
        rpm: 2300,
        coolantC: 88,
        fuelPct: 63,
        batteryV: 12.4,
        odometerKm: 45_310,
        lat: 4.711,
        lon: -74.0721,
        dtc: ['p0420'],
      }),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sample.vin).toBe('1HGCM82633A004352');
    expect(res.sample.coolantC).toBe(88);
    expect(res.sample.dtc).toEqual(['P0420']);
  });

  it('normaliza el VIN a mayusculas', () => {
    const res = normalizeSample(sample({ vin: '1hgcm82633a004352' }), NOW);
    expect(res.ok && res.sample.vin).toBe('1HGCM82633A004352');
  });

  it('rechaza un VIN invalido', () => {
    const res = normalizeSample(sample({ vin: 'CORTO' }), NOW);
    expect(res).toEqual({ ok: false, reason: 'vin_invalido', detail: 'vin de 5 caracteres' });
  });

  it('rechaza ts ausente o ilegible', () => {
    expect(normalizeSample({ vin: '1HGCM82633A004352' }, NOW)).toMatchObject({
      ok: false,
      reason: 'ts_invalido',
    });
    expect(normalizeSample({ vin: '1HGCM82633A004352', ts: 'ayer' }, NOW)).toMatchObject({
      ok: false,
      reason: 'ts_invalido',
    });
  });

  it('acepta un ts hasta 5 min en el futuro (reloj de telefono desfasado)', () => {
    const res = normalizeSample(sample({ ts: iso(FUTURE_TOLERANCE_MS - 1000) }), NOW);
    expect(res.ok).toBe(true);
  });

  it('rechaza un ts mas de 5 min en el futuro', () => {
    const res = normalizeSample(sample({ ts: iso(FUTURE_TOLERANCE_MS + 60_000) }), NOW);
    expect(res).toMatchObject({ ok: false, reason: 'ts_futuro' });
  });

  it('acepta epoch (ms y s) ademas de ISO', () => {
    expect(normalizeSample(sample({ ts: NOW }), NOW).ok).toBe(true);
    expect(normalizeSample(sample({ ts: NOW / 1000 }), NOW).ok).toBe(true);
  });

  it('rechaza cada campo fuera de su rango fisico', () => {
    const casos: [string, unknown][] = [
      ['speedKmh', 900],
      ['rpm', 20_000],
      ['coolantC', 400],
      ['fuelPct', 150],
      ['batteryV', 3],
      ['odometerKm', 9_000_000],
      ['lat', 120],
      ['lon', 400],
    ];
    for (const [field, value] of casos) {
      const res = normalizeSample(sample({ [field]: value }), NOW);
      expect(res, field).toMatchObject({ ok: false, reason: 'rango' });
      if (!res.ok) expect(res.detail).toContain(field);
    }
  });

  it('un campo imposible invalida la muestra entera (el sensor esta mintiendo)', () => {
    const res = normalizeSample(sample({ speedKmh: 42, coolantC: 999 }), NOW);
    expect(res.ok).toBe(false);
  });

  it('un numero no finito se trata como ausente, no rompe', () => {
    const res = normalizeSample(sample({ speedKmh: Number.NaN }), NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sample.speedKmh).toBeUndefined();
  });

  it('lo que no es un objeto se rechaza sin lanzar', () => {
    expect(normalizeSample(null, NOW)).toMatchObject({ ok: false, reason: 'no_objeto' });
    expect(normalizeSample('texto', NOW)).toMatchObject({ ok: false, reason: 'no_objeto' });
    expect(normalizeSample([], NOW)).toMatchObject({ ok: false, reason: 'no_objeto' });
  });
});

describe('ingestSamples: lote, limites y recuento de motivos', () => {
  it('acepta las validas y cuenta las invalidas por motivo', () => {
    const res = ingestSamples(
      [
        sample(),
        sample({ speedKmh: 5000 }),
        sample({ vin: 'X' }),
        sample({ ts: iso(FUTURE_TOLERANCE_MS + 60_000) }),
      ],
      NOW,
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected).toMatchObject({ rango: 1, vin_invalido: 1, ts_futuro: 1 });
  });

  it('un lote que no es array se rechaza entero', () => {
    expect(ingestSamples({ samples: [] }, NOW).rejected).toMatchObject({ no_objeto: 1 });
  });

  it(`descorta a ${MAX_BATCH} muestras y cuenta el exceso como lote_excedido`, () => {
    const batch = Array.from({ length: MAX_BATCH + 50 }, () => sample());
    const res = ingestSamples(batch, NOW);
    expect(res.accepted).toHaveLength(MAX_BATCH);
    expect(res.rejected.lote_excedido).toBe(1);
  });

  it('el indice del rechazo corresponde a la posicion en el lote', () => {
    const res = ingestSamples([sample(), sample({ vin: 'X' }), sample()], NOW);
    const bad = res.rejects.find((r) => r.reason === 'vin_invalido');
    expect(bad?.index).toBe(1);
  });

  it('un lote vacio no es un error', () => {
    const res = ingestSamples([], NOW);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejects).toHaveLength(0);
  });
});

describe('mapeo a la entidad `telemetry` (la que leen livePoll y LiveChart)', () => {
  it('traduce los nombres del contrato a los de la tabla', () => {
    const res = normalizeSample(
      sample({
        rpm: 2300,
        coolantC: 88,
        fuelPct: 63,
        lat: 4.7,
        lon: -74.1,
        dtc: ['P0420'],
        odometerKm: 45_310,
      }),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = toTelemetryRow(res.sample);
    expect(row.coolantTemp).toBe(88);
    expect(row.fuelLevel).toBe(63);
    expect(row.latitude).toBe(4.7);
    expect(row.longitude).toBe(-74.1);
    expect(row.troubleCodes).toEqual(['P0420']);
    expect(row.odometer).toBe(45_310);
    // epoch ms: es lo que espera getLatestTelemetryByVin.
    expect(row.timestamp).toBe(NOW);
  });

  it('lo ausente se escribe como 0, no como undefined (la tabla es de columnas fijas)', () => {
    const res = normalizeSample(sample({ speedKmh: 10 }), NOW);
    if (!res.ok) throw new Error('debería ser válida');
    const row = toTelemetryRow(res.sample);
    expect(row.rpm).toBe(0);
    expect(row.coolantTemp).toBe(0);
    expect(row.troubleCodes).toEqual([]);
  });

  it('la ida y la vuelta recupera la muestra del contrato', () => {
    const original = normalizeSample(sample({ rpm: 1500, coolantC: 90, dtc: ['P0301'] }), NOW);
    if (!original.ok) throw new Error('debería ser válida');
    const back = fromTelemetryRow(toTelemetryRow(original.sample));
    expect(back.vin).toBe(original.sample.vin);
    expect(back.ts).toBe(original.sample.ts);
    expect(back.rpm).toBe(1500);
    expect(back.coolantC).toBe(90);
    expect(back.dtc).toEqual(['P0301']);
  });

  it('una fila sin timestamp no rompe: ts = epoch 0', () => {
    expect(fromTelemetryRow({ vin: 'X' }).ts).toBe(new Date(0).toISOString());
  });
});
