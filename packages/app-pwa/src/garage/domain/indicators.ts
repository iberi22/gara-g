/**
 * indicators.ts — Las ocho pastillas del HUD (cuatro a cada lado del 3D). Los ids son los
 * mismos que usa `mock.ts`, porque la UI y sus tests los reconocen.
 *
 *   left:  health (salud general) · odo (odometro) · next (proximo cambio) · docs (SOAP)
 *   right: eff (consumo km/L) · cost (gasto del mes) · alerts (alertas sin reconocer)
 *          link (APK/OBD: en linea o ultima señal)
 *
 * Reglas de tono, iguales a los umbrales de `statusForHealth` para que la pastilla y el
 * color de la pieza no se contradigan: salud >= 35 ok, < 35 warn, < 15 critical, <= 0
 * overdue. `progress` (0..1) existe solo donde hay barra (anillo de salud, anillo del
 * documento); los numeros sin escala no lo llevan.
 *
 * El gasto del mes usa el mes natural en curso respecto a `now`; el consumo se calcula con
 * el promedio del rendimiento de las cargas (el campo que ya calcula `computeKmPerLiter` de
 * lib/fuelLog.ts). Sin datos, el valor es "—" y el tono `neutral`: es preferible a un 0
 * que sugiere "consume cero".
 *
 * Las unidades, la moneda y el nombre del documento obligatorio salen de lib/market.ts: en
 * Chile el HUD dice SOAP y km/L; en Colombia, SOAT y km/gal. `buildIndicators` acepta el
 * mercado como parametro para que los tests comprueben los dos sin tocar el entorno.
 */
import type { Commitment, Indicator, PartState, Tone, UsageUnit } from '../contracts';
import {
  LITERS_PER_GALLON,
  MARKET,
  documentKindLabel,
  formatMoney,
  formatNumber,
  volumeLiters,
  type MarketConfig,
} from '../../lib/market';
import { SOON_DAYS } from './commitments';
import {
  type AlertRow,
  type FuelLogRow,
  type VehicleRow,
  daysUntil,
  normalizeText,
  num,
  str,
} from './records';

export interface IndicatorsInput {
  vehicle: VehicleRow;
  overallHealthPct: number | null;
  /** Unidad de odometerKm y de los km de compromisos y cargas ('h' = horometro). */
  unit?: UsageUnit;
  odometerKm?: number;
  parts: PartState[];
  commitments: Commitment[];
  fuelLogs: FuelLogRow[];
  alerts: AlertRow[];
  /** Filas de entidad `document` del vehiculo, por si el SOAT no esta en la fila del vehiculo. */
  documents?: { kind?: string; expiry?: string }[];
  /** Ultima muestra de telemetria (epoch ms) o undefined si nunca hubo. */
  lastTelemetryMs?: number;
  now: Date;
  /** Ventana de "en linea" en segundos (ONLINE_WINDOW_S de contracts.ts). */
  onlineWindowS?: number;
}

const DEFAULT_ONLINE_WINDOW_S = 120;

/**
 * Tono de la salud GLOBAL. Usa una escala mas benevola que la de una pieza suelta: el
 * promedio de todas las piezas de un vehiculo nunca llega a cero (una sola pieza al 0 % no
 * hunde el conjunto), asi que si se usaran los cortes de pieza (35/15) virtually ningun
 * vehiculo llegaria a `ok` y la pastilla siempre diria "aviso". Los cortes de aqui son los
 * que usa `mock.ts` (71 y 92 = ok, 63 = warn), para que el snapshot real y el de
 * demostracion se lean igual.
 */
export function toneForHealth(pct: number | null): Tone {
  if (pct === null) return 'neutral';
  if (pct >= 70) return 'ok';
  if (pct >= 40) return 'warn';
  return 'critical';
}

export function toneForDays(days: number | undefined): Tone {
  if (days === undefined) return 'neutral';
  if (days < 0) return 'critical';
  if (days <= SOON_DAYS) return 'warn';
  return 'ok';
}

const km = (n: number, market: MarketConfig) => formatNumber(n, market);
const cop = (n: number, market: MarketConfig) => formatMoney(Math.round(n), market);
/** Consumo del vehiculo en la unidad del mercado a partir de km/L. */
const eff = (kmPerLiter: number, market: MarketConfig): number =>
  market.volumeUnit === 'L' ? kmPerLiter : kmPerLiter * LITERS_PER_GALLON;

/** "hace 20 s" / "hace 3 días": el texto que el usuario lee en la pastilla. */
export function sinceLabel(ms: number | undefined, now: Date): string | undefined {
  if (ms === undefined) return undefined;
  const diffS = Math.max(0, Math.round((now.getTime() - ms) / 1000));
  if (diffS < 60) return `Última señal hace ${diffS} s`;
  const min = Math.round(diffS / 60);
  if (min < 60) return `Última señal hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Última señal hace ${h} h`;
  const d = Math.round(h / 24);
  return `Última señal hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

/** SOAP/SOAT del vehiculo (o el documento mas proximo que se parezca). */
function soatDays(
  vehicle: VehicleRow,
  documents: { kind?: string; expiry?: string }[],
  now: Date,
): number | undefined {
  const own = str(vehicle.soatExpiry);
  const fromVehicle = own ? daysUntil(own, now) : undefined;
  if (fromVehicle !== undefined) return fromVehicle;
  // El tipo guardado puede venir en cualquiera de los dos vocabularios ('SOAT' o 'SOAP').
  const doc = documents.find((d) => {
    const k = normalizeText(d.kind ?? '');
    return k.includes('soat') || k.includes('soap');
  });
  return doc ? daysUntil(str(doc.expiry), now) : undefined;
}

function leftIndicators(input: IndicatorsInput, market: MarketConfig): Indicator[] {
  const health = input.overallHealthPct;
  const out: Indicator[] = [];

  out.push({
    id: 'health',
    label: 'Salud general',
    value: health === null ? '—' : String(health),
    unit: health === null ? undefined : '%',
    tone: toneForHealth(health),
    progress: health === null ? undefined : health / 100,
    hint: health === null ? 'Sin datos de piezas' : undefined,
  });

  const hours = input.unit === 'h';
  const usage = hours ? 'h' : 'km';
  out.push({
    id: 'odo',
    label: hours ? 'Horómetro' : 'Odómetro',
    value: input.odometerKm === undefined ? '—' : km(input.odometerKm, market),
    unit: input.odometerKm === undefined ? undefined : usage,
    tone: 'neutral',
  });

  // "Próximo cambio": el compromiso mas urgente. El signo se muestra porque el HUD lo usa
  // como alerta: "−350 km" se lee de un vistazo como vencido.
  const next = input.commitments[0];
  if (!next) {
    out.push({ id: 'next', label: 'Próximo cambio', value: '—', tone: 'neutral' });
  } else {
    const over = next.remainingKm !== undefined ? next.remainingKm : next.remainingDays;
    out.push({
      id: 'next',
      label: 'Próximo cambio',
      value: over === undefined ? '—' : `${over < 0 ? '−' : ''}${km(Math.abs(over), market)}`,
      unit: over === undefined ? undefined : next.remainingKm !== undefined ? usage : 'días',
      tone: next.urgency === 'overdue' ? 'critical' : next.urgency === 'soon' ? 'warn' : 'ok',
      hint: next.title,
    });
  }

  const docDays = soatDays(input.vehicle, input.documents ?? [], input.now);
  out.push({
    id: 'docs',
    label: documentKindLabel('SOAT', market),
    value: docDays === undefined ? '—' : String(Math.abs(docDays)),
    unit: docDays === undefined ? undefined : 'días',
    tone: toneForDays(docDays),
    progress: docDays === undefined ? undefined : Math.max(0, Math.min(1, docDays / 365)),
    hint:
      docDays === undefined
        ? `Sin ${documentKindLabel('SOAT', market)} registrado`
        : docDays < 0
          ? 'Vencido'
          : undefined,
  });

  return out;
}

/**
 * Consumo de maquinaria en volumen por hora: volumen cargado entre la primera y la ultima
 * carga dividido por las horas de motor entre ellas (la primera carga no cuenta: llena lo
 * que se gasto ANTES del periodo). Sin dos cargas con horometro no hay dato.
 * El volumen se lee en litros (volumeLiters) y se devuelve en la unidad del mercado.
 */
function volumePerHour(
  fuelLogs: FuelLogRow[],
  market: MarketConfig,
): { value: number; n: number } | undefined {
  const logs = fuelLogs
    .map((f) => ({ h: num(f.km), liters: volumeLiters(f) }))
    .filter((f): f is { h: number; liters: number } => f.h !== undefined && f.liters !== null && f.liters > 0)
    .sort((a, b) => a.h - b.h);
  if (logs.length < 2) return undefined;
  const span = logs[logs.length - 1].h - logs[0].h;
  if (span <= 0) return undefined;
  const liters = logs.slice(1).reduce((a, f) => a + f.liters, 0);
  const perHour = liters / span;
  return { value: market.volumeUnit === 'L' ? perHour : perHour / LITERS_PER_GALLON, n: logs.length };
}

function rightIndicators(input: IndicatorsInput, market: MarketConfig): Indicator[] {
  const out: Indicator[] = [];

  if (input.unit === 'h') {
    const vph = volumePerHour(input.fuelLogs, market);
    out.push({
      id: 'eff',
      label: 'Consumo',
      value: vph === undefined ? '—' : vph.value.toFixed(1),
      unit: vph === undefined ? undefined : `${market.volumeUnit}/h`,
      tone: 'neutral',
      hint: vph ? `${vph.n} cargas` : 'Registra dos cargas con horómetro',
    });
    return out.concat(restIndicators(input, market));
  }

  // Consumo: promedio del rendimiento de las cargas, normalizado a km/L.
  const effs = input.fuelLogs
    .map((f) => {
      const perLiter = num(f.kmPerLiter);
      if (perLiter !== undefined && perLiter > 0) return perLiter;
      const perGallon = num(f.kmPerGallon);
      return perGallon !== undefined && perGallon > 0 ? perGallon / LITERS_PER_GALLON : undefined;
    })
    .filter((v): v is number => v !== undefined && v > 0);
  const avgKmPerLiter = effs.length ? effs.reduce((a, b) => a + b, 0) / effs.length : undefined;
  out.push({
    id: 'eff',
    label: 'Consumo',
    value: avgKmPerLiter === undefined ? '—' : eff(avgKmPerLiter, market).toFixed(0),
    unit: avgKmPerLiter === undefined ? undefined : market.efficiencyUnit,
    // 4 km/L es el equivalente de 15 km/gal, el corte historico de la pastilla.
    tone: avgKmPerLiter === undefined ? 'neutral' : avgKmPerLiter < 4 ? 'warn' : 'ok',
    hint: effs.length ? `${effs.length} cargas` : 'Sin cargas registradas',
  });

  return out.concat(restIndicators(input, market));
}

/** Lo que no depende de la unidad: gasto del mes, alertas, senal. */
function restIndicators(input: IndicatorsInput, market: MarketConfig): Indicator[] {
  const out: Indicator[] = [];
  // Gasto del mes natural en curso.
  const monthStart = Date.parse(`${input.now.toISOString().slice(0, 7)}-01T00:00:00Z`);
  const cost = input.fuelLogs
    .filter((f) => {
      const at = Date.parse(str(f.date) ?? '');
      return Number.isFinite(at) && at >= monthStart;
    })
    .reduce((acc, f) => acc + (num(f.cost) ?? 0), 0);
  out.push({
    id: 'cost',
    label: 'Gasto del mes',
    value: cost === 0 ? '—' : cop(cost, market),
    tone: 'neutral',
  });

  const active = input.alerts.filter((a) => a.acknowledged !== true);
  const critical = active.filter((a) => {
    const s = normalizeText(str(a.severity) ?? '');
    return s.includes('critical') || s.includes('danger');
  });
  out.push({
    id: 'alerts',
    label: 'Alertas',
    value: String(active.length),
    tone: critical.length ? 'critical' : active.length ? 'warn' : 'ok',
    hint: critical.length ? `${critical.length} críticas` : undefined,
  });

  const window = (input.onlineWindowS ?? DEFAULT_ONLINE_WINDOW_S) * 1000;
  const connected =
    input.lastTelemetryMs !== undefined && input.now.getTime() - input.lastTelemetryMs <= window;
  const hint = connected
    ? sinceLabel(input.lastTelemetryMs, input.now)
    : input.lastTelemetryMs === undefined
      ? 'Sin señal de la APK'
      : sinceLabel(input.lastTelemetryMs, input.now);
  out.push({
    id: 'link',
    label: 'APK',
    value: connected
      ? 'En línea'
      : input.lastTelemetryMs === undefined
        ? 'Sin señal'
        : 'Última señal',
    tone: connected ? 'ok' : 'neutral',
    hint,
  });

  return out;
}

/** Las ocho pastillas del HUD. */
export function buildIndicators(
  input: IndicatorsInput,
  market: MarketConfig = MARKET,
): { left: Indicator[]; right: Indicator[] } {
  return { left: leftIndicators(input, market), right: rightIndicators(input, market) };
}

/**
 * Las piezas que estan mal: las pastillas de aviso del HUD las cuentan y el panel de estado
 * las ordena. No es un indicador por si mismo; vive aqui para no duplicar el filtro.
 */
export function attentionParts(parts: PartState[]): PartState[] {
  return parts.filter(
    (p) => p.status === 'overdue' || p.status === 'critical' || p.status === 'warn',
  );
}
