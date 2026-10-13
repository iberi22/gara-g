/**
 * indicators.test.ts — Las ocho pastillas del HUD: ids, valores y tonos.
 *
 * Los ids ('health', 'odo', 'next', 'docs', 'eff', 'cost', 'alerts', 'link') son el
 * contrato con el HUD y con mock.ts: si cambian, la UI muestra "undefined" en una caja.
 */
import { describe, expect, it } from 'vitest';
import type { Commitment, PartState } from '../contracts';
import { buildIndicators, sinceLabel, toneForDays, toneForHealth } from './indicators';
import { LITERS_PER_GALLON, MARKETS } from '../../lib/market';
import type { AlertRow, FuelLogRow, VehicleRow } from './records';

const NOW = new Date('2026-06-15T12:00:00.000Z');

const vehicle = (extra: Partial<VehicleRow> = {}): VehicleRow => ({ id: 'v1', ...extra });

const fuel = (extra: Partial<FuelLogRow>): FuelLogRow => ({
  id: 'f1',
  instance_id: 'inst',
  created_at: '',
  updated_at: '',
  vehicleId: 'v1',
  ...extra,
});

const alert = (extra: Partial<AlertRow>): AlertRow => ({
  id: 'a1',
  instance_id: 'inst',
  created_at: '',
  updated_at: '',
  vehicleId: 'v1',
  ...extra,
});

const commitment = (extra: Partial<Commitment>): Commitment => ({
  id: 'c1',
  vehicleId: 'v1',
  kind: 'part_change',
  title: 'Cambio de aceite',
  urgency: 'soon',
  status: 'pending',
  source: 'catalog',
  ...extra,
});

const noParts: PartState[] = [];

const input = (extra: Partial<Parameters<typeof buildIndicators>[0]> = {}) => ({
  vehicle: vehicle(),
  overallHealthPct: null,
  parts: noParts,
  commitments: [],
  fuelLogs: [],
  alerts: [],
  now: NOW,
  ...extra,
});

describe('tonos coherentes con los umbrales de las piezas', () => {
  it('tonoForHealth sigue la escala de salud global (70 ok, 40 warn)', () => {
    expect(toneForHealth(null)).toBe('neutral');
    expect(toneForHealth(0)).toBe('critical');
    expect(toneForHealth(39)).toBe('critical');
    expect(toneForHealth(40)).toBe('warn');
    expect(toneForHealth(69)).toBe('warn');
    expect(toneForHealth(70)).toBe('ok');
    expect(toneForHealth(100)).toBe('ok');
  });
  it('tonoForDays: vencido critico, 30 dias o menos warn', () => {
    expect(toneForDays(-1)).toBe('critical');
    expect(toneForDays(30)).toBe('warn');
    expect(toneForDays(200)).toBe('ok');
    expect(toneForDays(undefined)).toBe('neutral');
  });
});

describe('buildIndicators: los ocho ids del mock', () => {
  it('devuelve health/odo/next/docs a la izquierda y eff/cost/alerts/link a la derecha', () => {
    const ind = buildIndicators(input());
    expect(ind.left.map((i) => i.id)).toEqual(['health', 'odo', 'next', 'docs']);
    expect(ind.right.map((i) => i.id)).toEqual(['eff', 'cost', 'alerts', 'link']);
  });

  it('la salud con anillo lleva progress proporcional', () => {
    const ind = buildIndicators(input({ overallHealthPct: 63 }));
    const health = ind.left[0];
    expect(health?.value).toBe('63');
    expect(health?.unit).toBe('%');
    expect(health?.progress).toBeCloseTo(0.63);
    expect(health?.tone).toBe('warn');
  });

  it('el odometro se formatea en miles', () => {
    const ind = buildIndicators(input({ odometerKm: 28_450 }));
    expect(ind.left[1]?.value).toBe('28.450');
    expect(ind.left[1]?.tone).toBe('neutral');
  });

  it('"proximo cambio" muestra el signo del vencimiento y el titulo como pista', () => {
    const overdue = buildIndicators(
      input({
        commitments: [
          commitment({ urgency: 'overdue', remainingKm: -350, title: 'Aceite vencido' }),
        ],
      }),
    );
    expect(overdue.left[2]?.value).toBe('−350');
    expect(overdue.left[2]?.tone).toBe('critical');
    expect(overdue.left[2]?.hint).toBe('Aceite vencido');

    const planned = buildIndicators(
      input({ commitments: [commitment({ urgency: 'planned', remainingKm: 900 })] }),
    );
    expect(planned.left[2]?.value).toBe('900');
    expect(planned.left[2]?.tone).toBe('ok');
  });

  it('sin datos, valor "—" (no un 0 que sugiere "cero")', () => {
    const ind = buildIndicators(input());
    expect(ind.left[0]?.value).toBe('—');
    expect(ind.left[1]?.value).toBe('—');
    expect(ind.right[0]?.value).toBe('—');
    expect(ind.left[0]?.tone).toBe('neutral');
  });

  it('el documento obligatorio se llama como en el mercado (SOAP en Chile, SOAT en Colombia)', () => {
    const docs = input({ vehicle: vehicle({ soatExpiry: '2026-06-27' }) });
    expect(buildIndicators(docs, MARKETS.CL).left[3]?.label).toBe('SOAP');
    expect(buildIndicators(docs, MARKETS.CO).left[3]?.label).toBe('SOAT');
  });

  it('SOAT: dias que faltan, con anillo sobre 365 dias', () => {
    const ind = buildIndicators(input({ vehicle: vehicle({ soatExpiry: '2026-06-27' }) }));
    expect(ind.left[3]?.value).toBe('12');
    expect(ind.left[3]?.unit).toBe('días');
    expect(ind.left[3]?.progress).toBeCloseTo(12 / 365);
    expect(ind.left[3]?.tone).toBe('warn');
  });

  it('SOAT vencido se marca como tal', () => {
    const ind = buildIndicators(input({ vehicle: vehicle({ soatExpiry: '2026-01-01' }) }));
    expect(ind.left[3]?.tone).toBe('critical');
    expect(ind.left[3]?.hint).toBe('Vencido');
  });

  it('consumo: promedio del rendimiento de las cargas, en la unidad del mercado', () => {
    // Mercado colombiano: se lee en km/gal, como antes.
    const co = buildIndicators(
      input({ fuelLogs: [fuel({ id: 'a', kmPerGallon: 30 }), fuel({ id: 'b', kmPerGallon: 20 })] }),
      MARKETS.CO,
    );
    expect(co.right[0]?.value).toBe('25');
    expect(co.right[0]?.unit).toBe('km/gal');

    // Mercado chileno (el activo): el mismo dato se lee en km/L.
    const cl = buildIndicators(
      input({ fuelLogs: [fuel({ id: 'a', kmPerGallon: 30 }), fuel({ id: 'b', kmPerGallon: 20 })] }),
      MARKETS.CL,
    );
    expect(cl.right[0]?.unit).toBe('km/L');
    expect(cl.right[0]?.value).toBe(String(Math.round(25 / LITERS_PER_GALLON)));

    // Una fila que ya trae km/L manda sobre el campo heredado.
    const fromLiters = buildIndicators(input({ fuelLogs: [fuel({ id: 'a', kmPerLiter: 8 })] }), MARKETS.CL);
    expect(fromLiters.right[0]?.value).toBe('8');
  });

  it('gasto del mes: solo cuenta lo del mes en curso', () => {
    const ind = buildIndicators(
      input({
        fuelLogs: [
          fuel({ id: 'a', date: '2026-06-10', cost: 40_000 }),
          fuel({ id: 'b', date: '2026-05-01', cost: 999_000 }),
        ],
      }),
    );
    expect(ind.right[1]?.value).toBe('$40.000');
  });

  it('alertas: cuenta solo las no reconocidas y sube a critico si hay una critica', () => {
    const warn = buildIndicators(
      input({
        alerts: [alert({ id: '1', acknowledged: false }), alert({ id: '2', acknowledged: true })],
      }),
    );
    expect(warn.right[2]?.value).toBe('1');
    expect(warn.right[2]?.tone).toBe('warn');

    const crit = buildIndicators(
      input({ alerts: [alert({ id: '1', acknowledged: false, severity: 'critical' })] }),
    );
    expect(crit.right[2]?.tone).toBe('critical');
    expect(crit.right[2]?.hint).toContain('1 críticas');

    const none = buildIndicators(input());
    expect(none.right[2]?.value).toBe('0');
    expect(none.right[2]?.tone).toBe('ok');
  });
});

describe('link: la APK en linea', () => {
  it('dentro de la ventana (120 s) dice "En línea"', () => {
    const ind = buildIndicators(input({ lastTelemetryMs: NOW.getTime() - 20_000 }));
    expect(ind.right[3]?.value).toBe('En línea');
    expect(ind.right[3]?.tone).toBe('ok');
    expect(ind.right[3]?.hint).toBe('Última señal hace 20 s');
  });

  it('fuera de la ventana dice "Última señal" con la antiguedad', () => {
    const ind = buildIndicators(input({ lastTelemetryMs: NOW.getTime() - 3 * 86_400_000 }));
    expect(ind.right[3]?.value).toBe('Última señal');
    expect(ind.right[3]?.tone).toBe('neutral');
    expect(ind.right[3]?.hint).toBe('Última señal hace 3 días');
  });

  it('nunca hubo señal: "Sin señal"', () => {
    const ind = buildIndicators(input());
    expect(ind.right[3]?.value).toBe('Sin señal');
    expect(ind.right[3]?.hint).toBe('Sin señal de la APK');
  });
});

describe('sinceLabel', () => {
  it('escala de segundos a dias', () => {
    expect(sinceLabel(NOW.getTime() - 20_000, NOW)).toBe('Última señal hace 20 s');
    expect(sinceLabel(NOW.getTime() - 5 * 60_000, NOW)).toBe('Última señal hace 5 min');
    expect(sinceLabel(NOW.getTime() - 3 * 3_600_000, NOW)).toBe('Última señal hace 3 h');
    expect(sinceLabel(NOW.getTime() - 86_400_000, NOW)).toBe('Última señal hace 1 día');
  });
});
