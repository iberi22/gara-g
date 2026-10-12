/**
 * telemetry/monitoring.test.ts — "En linea" o no, y el acotado de la serie.
 *
 * La ventana es de 120 s (ONLINE_WINDOW_S del contrato) a proposito: con una ventana larga
 * el punto verde del HUD mentiria cuando el telefono lleva dias sin abrir la app.
 */
import { describe, expect, it } from 'vitest';
import { ONLINE_WINDOW_S } from '../contracts';
import type { TelemetrySample } from '../contracts';
import { toTelemetryRow } from './ingest';
import { emptyMonitoringState, monitoringState, recentSeries, vinsOf } from './monitoring';

const NOW = Date.parse('2026-06-15T12:00:00.000Z');
const VIN = '1HGCM82633A004352';

const row = (msOffset: number, vin = VIN, extra: Record<string, unknown> = {}) => ({
  vin,
  timestamp: NOW + msOffset,
  speed: 30,
  rpm: 1500,
  coolantTemp: 88,
  fuelLevel: 60,
  latitude: 4.7,
  longitude: -74.1,
  troubleCodes: [],
  odometer: 45_000,
  ...extra,
});

describe('monitoringState: conectado', () => {
  it('con una muestra de hace 20 s: connected', () => {
    const state = monitoringState(VIN, [row(-20_000)], NOW);
    expect(state.connected).toBe(true);
    expect(state.latest?.speedKmh).toBe(30);
    expect(state.lastSeen).toBe(new Date(NOW - 20_000).toISOString());
  });

  it('con la ultima muestra justo en el borde de la ventana: connected', () => {
    expect(monitoringState(VIN, [row(-ONLINE_WINDOW_S * 1000)], NOW).connected).toBe(true);
  });

  it('pasado el borde: no connected, pero conserva la ultima señal', () => {
    const state = monitoringState(VIN, [row(-(ONLINE_WINDOW_S * 1000 + 1000))], NOW);
    expect(state.connected).toBe(false);
    expect(state.lastSeen).toBeTruthy();
    expect(state.series).toHaveLength(1);
  });

  it('sin muestras: no connected, sin ultima señal, serie vacia', () => {
    const state = monitoringState(VIN, [], NOW);
    expect(state).toMatchObject({ vin: VIN, connected: false, series: [] });
    expect(state.lastSeen).toBeUndefined();
    expect(state.latest).toBeUndefined();
  });

  it('ignora las muestras de otro VIN', () => {
    const state = monitoringState(
      VIN,
      [row(-1000, '1HGCM82633A004353'), row(-1000, 'OTROVIN00001')],
      NOW,
    );
    expect(state.series).toHaveLength(0);
    expect(state.connected).toBe(false);
  });

  it('compara el VIN en mayusculas (la APK puede mandarlo en minusculas)', () => {
    expect(monitoringState(VIN, [row(-1000, VIN.toLowerCase())], NOW).connected).toBe(true);
  });

  it('elige la muestra MAS reciente como `latest`, no la primera de la tabla', () => {
    const state = monitoringState(
      VIN,
      [row(-5_000, VIN, { speed: 10 }), row(-1_000, VIN, { speed: 90 })],
      NOW,
    );
    expect(state.latest?.speedKmh).toBe(90);
  });
});

describe('monitoringState: serie acotada y ordenada', () => {
  it('la serie va de mas antigua a mas reciente', () => {
    const state = monitoringState(VIN, [row(-3_000), row(-1_000), row(-2_000)], NOW);
    const times = state.series.map((s) => Date.parse(s.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('acota a las ultimas 60 muestras', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(-(120 - i) * 1000));
    expect(monitoringState(VIN, rows, NOW).series).toHaveLength(60);
  });

  it('con menos de 60 muestras devuelve todas', () => {
    expect(monitoringState(VIN, [row(-3_000), row(-1_000)], NOW).series).toHaveLength(2);
  });
});

describe('recentSeries', () => {
  it('ordena y acota con una ventana propia', () => {
    const samples: TelemetrySample[] = [
      { vin: VIN, ts: new Date(NOW).toISOString(), source: 'apk' },
      { vin: VIN, ts: new Date(NOW - 2_000).toISOString(), source: 'apk' },
      { vin: VIN, ts: new Date(NOW - 1_000).toISOString(), source: 'apk' },
    ];
    const series = recentSeries(samples, 2);
    expect(series).toHaveLength(2);
    expect(series[0]?.ts).toBe(new Date(NOW - 1_000).toISOString());
    expect(series[1]?.ts).toBe(new Date(NOW).toISOString());
  });
});

describe('helpers', () => {
  it('emptyMonitoringState normaliza el VIN y dice "sin señal"', () => {
    expect(emptyMonitoringState(VIN.toLowerCase())).toMatchObject({
      vin: VIN,
      connected: false,
      series: [],
    });
  });

  it('vinsOf lista los VINs distintos sin repetir', () => {
    expect(vinsOf([row(0, VIN), row(0, VIN.toLowerCase()), row(0, '1HGCM82633A004353')])).toEqual([
      '1HGCM82633A004352',
      '1HGCM82633A004353',
    ]);
  });

  it('el estado se puede construir desde filas ya mapeadas por toTelemetryRow', () => {
    const sample = normalizeForTest();
    const state = monitoringState(VIN, [toTelemetryRow(sample)], NOW);
    expect(state.connected).toBe(true);
    expect(state.latest?.coolantC).toBe(88);
  });
});

function normalizeForTest(): TelemetrySample {
  return { vin: VIN, ts: new Date(NOW).toISOString(), coolantC: 88, source: 'apk' };
}
