/**
 * indicators.ts — Las ocho pastillas del HUD (cuatro a cada lado del 3D). Los ids son los
 * mismos que usa `mock.ts`, porque la UI y sus tests los reconocen.
 *
 *   left:  health (salud general) · odo (odometro) · next (proximo cambio) · docs (SOAT)
 *   right: eff (consumo km/gal) · cost (gasto del mes) · alerts (alertas sin reconocer)
 *          link (APK/OBD: en linea o ultima señal)
 *
 * Reglas de tono, iguales a los umbrales de `statusForHealth` para que la pastilla y el
 * color de la pieza no se contradigan: salud >= 35 ok, < 35 warn, < 15 critical, <= 0
 * overdue. `progress` (0..1) existe solo donde hay barra (anillo de salud, anillo del
 * documento); los numeros sin escala no lo llevan.
 *
 * El gasto del mes usa el mes natural en curso respecto a `now`; el consumo se calcula con
 * el promedio de `kmPerGallon` de las cargas (el campo que ya calcula `computeKmPerGallon`
 * de lib/fuelLog.ts). Sin datos, el valor es "—" y el tono `neutral`: es preferible a un 0
 * que sugiere "consume cero".
 */
import type { Commitment, Indicator, PartState, Tone, UsageUnit } from '../contracts';
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

const km = (n: number) => n.toLocaleString('es-CO');
const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

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

/** SOAT del vehiculo (o el documento mas proximo que se parezca a un SOAT). */
function soatDays(
  vehicle: VehicleRow,
  documents: { kind?: string; expiry?: string }[],
  now: Date,
): number | undefined {
  const own = str(vehicle.soatExpiry);
  const fromVehicle = own ? daysUntil(own, now) : undefined;
  if (fromVehicle !== undefined) return fromVehicle;
  const doc = documents.find((d) => normalizeText(d.kind ?? '').includes('soat'));
  return doc ? daysUntil(str(doc.expiry), now) : undefined;
}

function leftIndicators(input: IndicatorsInput): Indicator[] {
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
    value: input.odometerKm === undefined ? '—' : km(input.odometerKm),
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
      value: over === undefined ? '—' : `${over < 0 ? '−' : ''}${km(Math.abs(over))}`,
      unit: over === undefined ? undefined : next.remainingKm !== undefined ? usage : 'días',
      tone: next.urgency === 'overdue' ? 'critical' : next.urgency === 'soon' ? 'warn' : 'ok',
      hint: next.title,
    });
  }

  const docDays = soatDays(input.vehicle, input.documents ?? [], input.now);
  out.push({
    id: 'docs',
    label: 'SOAT',
    value: docDays === undefined ? '—' : String(Math.abs(docDays)),
    unit: docDays === undefined ? undefined : 'días',
    tone: toneForDays(docDays),
    progress: docDays === undefined ? undefined : Math.max(0, Math.min(1, docDays / 365)),
    hint: docDays === undefined ? 'Sin SOAT registrado' : docDays < 0 ? 'Vencido' : undefined,
  });

  return out;
}

/**
 * Consumo de maquinaria en gal/h: galones cargados entre la primera y la ultima carga
 * dividido por las horas de motor entre ellas (la primera carga no cuenta: llena lo que
 * se gasto ANTES del periodo). Sin dos cargas con horometro no hay dato.
 */
function gallonsPerHour(fuelLogs: FuelLogRow[]): { value: number; n: number } | undefined {
  const logs = fuelLogs
    .map((f) => ({ h: num(f.km), gal: num(f.gallons) }))
    .filter((f): f is { h: number; gal: number } => f.h !== undefined && f.gal !== undefined && f.gal > 0)
    .sort((a, b) => a.h - b.h);
  if (logs.length < 2) return undefined;
  const span = logs[logs.length - 1].h - logs[0].h;
  if (span <= 0) return undefined;
  const gal = logs.slice(1).reduce((a, f) => a + f.gal, 0);
  return { value: gal / span, n: logs.length };
}

function rightIndicators(input: IndicatorsInput): Indicator[] {
  const out: Indicator[] = [];

  if (input.unit === 'h') {
    const gph = gallonsPerHour(input.fuelLogs);
    out.push({
      id: 'eff',
      label: 'Consumo',
      value: gph === undefined ? '—' : gph.value.toFixed(1),
      unit: gph === undefined ? undefined : 'gal/h',
      tone: 'neutral',
      hint: gph ? `${gph.n} cargas` : 'Registra dos cargas con horómetro',
    });
    return out.concat(restIndicators(input));
  }

  // Consumo: promedio de los km/gal que ya trae cada carga.
  const effs = input.fuelLogs
    .map((f) => num(f.kmPerGallon))
    .filter((v): v is number => v !== undefined && v > 0);
  const eff = effs.length ? effs.reduce((a, b) => a + b, 0) / effs.length : undefined;
  out.push({
    id: 'eff',
    label: 'Consumo',
    value: eff === undefined ? '—' : eff.toFixed(0),
    unit: eff === undefined ? undefined : 'km/gal',
    tone: eff === undefined ? 'neutral' : eff < 15 ? 'warn' : 'ok',
    hint: effs.length ? `${effs.length} cargas` : 'Sin cargas registradas',
  });

  return out.concat(restIndicators(input));
}

/** Lo que no depende de la unidad: gasto del mes, alertas, senal. */
function restIndicators(input: IndicatorsInput): Indicator[] {
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
    value: cost === 0 ? '—' : cop(cost),
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
export function buildIndicators(input: IndicatorsInput): { left: Indicator[]; right: Indicator[] } {
  return { left: leftIndicators(input), right: rightIndicators(input) };
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
