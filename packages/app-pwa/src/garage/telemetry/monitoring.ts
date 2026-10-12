/**
 * monitoring.ts — Estado de monitoreo de un VIN: "en linea" o no, y las ultimas muestras
 * para la grafica.
 *
 * `connected` = hubo una muestra en los ultimos ONLINE_WINDOW_S (120 s). Es una ventana
 * corta a proposito: el HUD distingue "la APK esta mandando" de "la APK estuvo mandando
 * hace un rato", y con una ventana larga el punto verde mentiria cuando el telefono lleva
 * dias sin abrir la app.
 *
 * Se guardan las ultimas 60 muestras por VIN (NO las ultimas 60 por consulta): la consulta
 * se llama cada 5 s y el poll de `livePoll` tambien lee la tabla entera, asi que acotar en
 * memoria evita que un vehiculo que reporto toda la tarde haga crecer el payload.
 */
import { type MonitoringState, ONLINE_WINDOW_S, type TelemetrySample } from '../contracts';
import { fromTelemetryRow } from './ingest';

/** Muestras que se devuelven por VIN. */
export const MONITORING_WINDOW = 60;

export type SampleRow = Record<string, unknown>;

const msOf = (sample: TelemetrySample): number => {
  const t = Date.parse(sample.ts);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Ordena por fecha y devuelve la serie con la mas antigua primero (como espera el
 * contrato), acotada a las ultimas `MONITORING_WINDOW`.
 */
export function recentSeries(
  samples: TelemetrySample[],
  window = MONITORING_WINDOW,
): TelemetrySample[] {
  return [...samples].sort((a, b) => msOf(a) - msOf(b)).slice(-window);
}

/** Construye el estado de monitoreo de un VIN a partir de sus filas de `telemetry`. */
export function monitoringState(
  vin: string,
  rows: SampleRow[],
  now: number = Date.now(),
  windowS: number = ONLINE_WINDOW_S,
): MonitoringState {
  const target = vin.trim().toUpperCase();
  const samples: TelemetrySample[] = [];
  for (const row of rows) {
    const sample = fromTelemetryRow(row);
    if (sample.vin !== target) continue;
    samples.push(sample);
  }

  const series = recentSeries(samples);
  const latest = series.length ? series[series.length - 1] : undefined;
  const lastMs = latest ? msOf(latest) : undefined;
  const connected = lastMs !== undefined && lastMs <= now && now - lastMs <= windowS * 1000;

  return {
    vin: target,
    connected,
    lastSeen: lastMs !== undefined ? new Date(lastMs).toISOString() : undefined,
    latest,
    series,
  };
}

/** Estado vacio para un VIN sin una sola muestra: "sin señal", no "en linea con cero". */
export function emptyMonitoringState(vin: string): MonitoringState {
  return { vin: vin.trim().toUpperCase(), connected: false, series: [] };
}

/**VINs presentes en un conjunto de filas (para el selector del HUD). */
export function vinsOf(rows: SampleRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const vin = typeof row.vin === 'string' ? row.vin.trim().toUpperCase() : '';
    if (vin) set.add(vin);
  }
  return [...set].sort();
}
