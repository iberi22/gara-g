/**
 * ingest.ts — Validacion y normalizacion de las muestras que envia la APK (u OBD2), y su
 * traduccion a la entidad `telemetry` que ya consume `livePoll` y `LiveChart`.
 *
 * Por que validar aqui y no en la ruta: la APK es un cliente fuera de nuestro control (y a
 * veces un puente OBD2 que manda ceros). Un `speedKmh: 9000` o un `ts` del ano 2099 no
 * debe acabar en la tabla: rompe la grafica y hace que "en linea" sea mentira. Aqui se
 * normaliza, se acotan los rangos y, cuando no se puede aceptar, se cuenta POR QUE para
 * que la ruta responda `{ accepted, rejected: { motivo: n } }` y el usuario vea que su
 * telefono esta mandando algo que el servidor no entiende.
 *
 * Rangos fisicos plausibles (fuera de rango = muestra corrupta, no se recorta):
 *   speedKmh 0..300 (por encima no hay carretera en Colombia; un camion a 300 no es dato,
 *              es un cable suelto) · rpm 0..12000 · coolantC -40..150 · fuelPct 0..100
 *   batteryV 6..24 (6 V es una bateria descargada, 24 un Camilo de 24 V; el 12 V habitual
 *              va en medio) · odometerKm 0..2.000.000 · lat -90..90 · lon -180..180.
 *
 * El ts debe ser ISO valido y no puede estar mas de 5 min en el futuro: un reloj de telefono
 * desfasado, o un lote entero con ts del futuro, haria creer que el vehiculo lleva dias
 * conectado.
 */
import type { TelemetrySample } from '../contracts';

/** Margen de reloj toleratedo (el telefono va unos segundos adelantado). */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** Maximo atraso aceptado: 30 dias de muestras acumuladas sin conexion. */
const MAX_BACKLOG_MS = 30 * 24 * 60 * 60 * 1000;
/** Tope de muestras por lote (la APK agrupa cuando va con mal GPS). */
export const MAX_BATCH = 200;
/** Longitudes de VIN admitidas: 11 (motos, India) a 17 (ISO 3779). */
export const VIN_MIN = 11;
export const VIN_MAX = 17;

/**
 * Alfanumerico. El veto de I, O y Q (que en tipografia se confunden con 1 y 0) solo se aplica
 * a los VIN de 17 caracteres, que es donde manda la ISO 3779 y donde ya los emite el
 * fabricante. En los cortos (11-16, motos) el>O si aparece en la practica y rechazarlo deja
 * fuera vehiculos legitimos.
 */
const VIN_RE = /^[A-Z0-9]+$/;
const VIN_RE_STRICT = /^[A-HJ-NPR-Z0-9]+$/;

/** Campos numericos con su rango: la misma tabla documenta el porque de cada cota. */
const RANGES = {
  speedKmh: [0, 300],
  rpm: [0, 12_000],
  coolantC: [-40, 150],
  fuelPct: [0, 100],
  batteryV: [6, 24],
  odometerKm: [0, 2_000_000],
  lat: [-90, 90],
  lon: [-180, 180],
} as const;

export type IngestField = keyof typeof RANGES;

export type RejectReason =
  | 'no_objeto'
  | 'vin_invalido'
  | 'ts_invalido'
  | 'ts_futuro'
  | 'ts_antiguo'
  | 'rango'
  | 'lote_excedido'
  | 'sin_datos';

export const REJECT_REASONS: readonly RejectReason[] = [
  'no_objeto',
  'vin_invalido',
  'ts_invalido',
  'ts_futuro',
  'ts_antiguo',
  'rango',
  'lote_excedido',
  'sin_datos',
];

export type RejectedCounts = Partial<Record<RejectReason, number>>;

/**
 * Motivo de rechazo que anade la RUTA, no la ingesta pura: una muestra bien formada cuyo VIN
 * no pertenece a ningun vehiculo del tenant. Vive aparte porque depende de quien pregunta,
 * no del contenido de la muestra, y asi `ingestSamples` se puede reutilizar desde el puente
 * (que no tiene idea de tenants) sin arrastrar un motivo que nunca produce.
 */
export const REJECT_FOREIGN_VIN = 'vin_ajeno';

export type RouteRejectedCounts = Partial<Record<RejectReason | typeof REJECT_FOREIGN_VIN, number>>;

export interface IngestResult {
  /** Muestras aceptadas, ya normalizadas a la forma de la entidad `telemetry`. */
  accepted: TelemetrySample[];
  rejected: RejectedCounts;
  /** Motivo con el que se descarto cada muestra, en el mismo orden que las recibidas. */
  rejects: { index: number; reason: RejectReason; detail?: string }[];
}

export function isValidVin(vin: unknown): vin is string {
  if (typeof vin !== 'string') return false;
  const v = vin.trim().toUpperCase();
  if (v.length < VIN_MIN || v.length > VIN_MAX) return false;
  // A 17 caracteres manda la ISO 3779 (sin I/O/Q). En los cortos (11-16, motos) basta el
  // alfanumerico: el veto estricto deja fuera vehiculos legitimos.
  return v.length === VIN_MAX ? VIN_RE_STRICT.test(v) : VIN_RE.test(v);
}

function finiteInRange(value: unknown, field: IngestField): boolean {
  const [min, max] = RANGES[field];
  // NaN e infinito son "no medido", no "fuera de rango": se ignoran mas abajo. Solo un numero
  // real fuera de la cota invalida la muestra.
  if (typeof value !== 'number' || !Number.isFinite(value)) return true;
  return value >= min && value <= max;
}

/** Lee un campo numerico: si viene mal, se ignora (no se inventa ni se propaga). */
function readNumber(raw: Record<string, unknown>, field: IngestField): number | undefined {
  const v = raw[field];
  if (v === undefined || v === null) return undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Normaliza UNA muestra. Devuelve la muestra limpia o el motivo del rechazo. No lanza:
 * una muestra mala no puede tumbar un lote de 200.
 */
export function normalizeSample(
  raw: unknown,
  now: number,
): { ok: true; sample: TelemetrySample } | { ok: false; reason: RejectReason; detail?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, reason: 'no_objeto' };
  const s = raw as Record<string, unknown>;

  if (!isValidVin(s.vin)) {
    const len = typeof s.vin === 'string' ? s.vin.length : 0;
    return { ok: false, reason: 'vin_invalido', detail: `vin de ${len} caracteres` };
  }

  // El ts puede venir como ISO o como epoch; se normaliza a ISO.
  const rawTs = s.ts ?? s.timestamp;
  let tsMs: number;
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    tsMs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
  } else if (typeof rawTs === 'string') {
    tsMs = Date.parse(rawTs);
  } else {
    return { ok: false, reason: 'ts_invalido' };
  }
  if (Number.isNaN(tsMs) || tsMs <= 0) return { ok: false, reason: 'ts_invalido' };
  // La APK puede subir lo acumulado sin red, pero no muestras de hace meses (o de 1970).
  if (tsMs < now - MAX_BACKLOG_MS) {
    return { ok: false, reason: 'ts_antiguo', detail: `${Math.round((now - tsMs) / 86400000)} dias atras` };
  }
  if (tsMs > now + FUTURE_TOLERANCE_MS) {
    return {
      ok: false,
      reason: 'ts_futuro',
      detail: `${Math.round((tsMs - now) / 60000)} min por delante`,
    };
  }

  // Rango fisico: cualquier campo presente y fuera de rango invalida la muestra entera,
  // porque un solo sensor con dato imposible delata una lectura corrupta completa.
  for (const field of Object.keys(RANGES) as IngestField[]) {
    const v = s[field];
    if (v === undefined || v === null) continue;
    if (!finiteInRange(v, field)) {
      return { ok: false, reason: 'rango', detail: `${field}=${String(v)}` };
    }
  }

  const dtc = Array.isArray(s.dtc)
    ? s.dtc
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 32)
    : undefined;

  const source = s.source === 'obd2' || s.source === 'manual' ? s.source : 'apk';
  const sample: TelemetrySample = {
    vin: (s.vin as string).trim().toUpperCase(),
    ts: new Date(tsMs).toISOString(),
    source,
  };

  const speedKmh = readNumber(s, 'speedKmh');
  if (speedKmh !== undefined) sample.speedKmh = speedKmh;
  const rpm = readNumber(s, 'rpm');
  if (rpm !== undefined) sample.rpm = rpm;
  const coolantC = readNumber(s, 'coolantC');
  if (coolantC !== undefined) sample.coolantC = coolantC;
  const fuelPct = readNumber(s, 'fuelPct');
  if (fuelPct !== undefined) sample.fuelPct = fuelPct;
  const batteryV = readNumber(s, 'batteryV');
  if (batteryV !== undefined) sample.batteryV = batteryV;
  const odometerKm = readNumber(s, 'odometerKm');
  if (odometerKm !== undefined) sample.odometerKm = odometerKm;
  const lat = readNumber(s, 'lat');
  if (lat !== undefined) sample.lat = lat;
  const lon = readNumber(s, 'lon');
  if (lon !== undefined) sample.lon = lon;
  if (dtc && dtc.length > 0) sample.dtc = dtc;

  return { ok: true, sample };
}

/**
 * Valida y normaliza un lote. Rechaza (contando motivo) las invalidas y se pasa por encima
 * de las que excedan `MAX_BATCH`: el cap se aplica ANTES de validar para que un lote
 * gigante no se procese entero.
 */
export function ingestSamples(rawBatch: unknown, now: number = Date.now()): IngestResult {
  const rejected: RejectedCounts = {};
  const rejects: { index: number; reason: RejectReason; detail?: string }[] = [];
  const bump = (reason: RejectReason) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  if (!Array.isArray(rawBatch)) {
    bump('no_objeto');
    return { accepted: [], rejected, rejects: [{ index: -1, reason: 'no_objeto' }] };
  }

  const considered = rawBatch.slice(0, MAX_BATCH);
  if (rawBatch.length > MAX_BATCH) {
    bump('lote_excedido');
    rejects.push({
      index: MAX_BATCH,
      reason: 'lote_excedido',
      detail: `${rawBatch.length} muestras`,
    });
  }

  const accepted: TelemetrySample[] = [];
  considered.forEach((raw, index) => {
    const res = normalizeSample(raw, now);
    if (res.ok) accepted.push(res.sample);
    else {
      bump(res.reason);
      rejects.push({ index, reason: res.reason, detail: res.detail });
    }
  });

  return { accepted, rejected, rejects };
}

/**
 * Fila de la entidad `telemetry` (los campos de `domain.config.ts`), que es lo que leen
 * `livePoll.getLatestTelemetryByVin` y `LiveChart`. Los nombres cambian a proposito: el
 * contrato nuevo dice `coolantC` y la tabla dice `coolantTemp`.
 */
export function toTelemetryRow(sample: TelemetrySample): Record<string, unknown> {
  return {
    vin: sample.vin,
    // epoch ms: es lo que escribe fleetSeed y lo que espera livePoll.
    timestamp: Date.parse(sample.ts),
    speed: sample.speedKmh ?? 0,
    rpm: sample.rpm ?? 0,
    coolantTemp: sample.coolantC ?? 0,
    fuelLevel: sample.fuelPct ?? 0,
    latitude: sample.lat ?? 0,
    longitude: sample.lon ?? 0,
    troubleCodes: sample.dtc ?? [],
    odometer: sample.odometerKm ?? 0,
    source: sample.source,
  };
}

/** Muestra del contrato -> muestra que ve la UI de monitoreo. */
export function fromTelemetryRow(row: Record<string, unknown>): TelemetrySample {
  const ts = row.timestamp;
  const ms = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(String(ts ?? ''));
  const sample: TelemetrySample = {
    vin: String(row.vin ?? '').toUpperCase(),
    ts: Number.isNaN(ms) ? new Date(0).toISOString() : new Date(ms).toISOString(),
    source: row.source === 'obd2' || row.source === 'manual' ? row.source : 'apk',
  };
  if (typeof row.speed === 'number') sample.speedKmh = row.speed;
  if (typeof row.rpm === 'number') sample.rpm = row.rpm;
  if (typeof row.coolantTemp === 'number') sample.coolantC = row.coolantTemp;
  if (typeof row.fuelLevel === 'number') sample.fuelPct = row.fuelLevel;
  if (typeof row.odometer === 'number') sample.odometerKm = row.odometer;
  if (typeof row.latitude === 'number') sample.lat = row.latitude;
  if (typeof row.longitude === 'number') sample.lon = row.longitude;
  if (Array.isArray(row.troubleCodes) && row.troubleCodes.length > 0) {
    sample.dtc = row.troubleCodes.filter((c): c is string => typeof c === 'string');
  }
  return sample;
}
