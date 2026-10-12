import { computeNextService } from '../../lib/maintenance';
/**
 * commitments.ts — Lo que el vehiculo DEBE: cambios de pieza proximos, mantenimientos
 * programados y documentos por vencer. Es la lista que la UI ordena por urgencia.
 *
 * Decisiones:
 *  - Urgencia: `overdue` si ya se paso (km o dias negativos), `soon` si vence en <= 1000 km
 *    o <= 30 dias, `planned` en el resto. El corte de 30 dias es el mismo que usa
 *    `checkExpiry` de lib/document.ts para marcar un documento "expiring", asi que el
 *    HUD y el panel de documentos no se contradicen.
 *  - Orden: vencidos, luego `soon`, luego `planned`; dentro de cada grupo por lo que vence
 *    antes. Un compromiso sin fecha ni km se va al final: no hay con que ordenarlo y no debe
 *    tapar a los que si.
 *  - Sin duplicados: "cambio de aceite" del calendario y la pieza `engine_oil` del catalogo
 *    describen el mismo trabajo. Se agrupan por ranura (o por texto normalizado cuando no hay
 *    ranura) y se conserva la pieza, que trae vida util, km restante y costo; del calendario
 *    solo se rescata la fecha, que es el dato que la pieza no tiene.
 */
import type { Commitment, PartSlotId, PartState, UsageUnit, VehicleFamily } from '../contracts';
import { slotsForCatalogPart } from '../parts';
import {
  type MaintenanceRow,
  type VehicleRow,
  daysUntil,
  normalizeText,
  num,
  str,
} from './records';

/** Ventana de anticipacion en km: lo que el conductor puede planear. */
export const SOON_KM = 1000;
/** Lo mismo en maquinaria, en horas de motor: ~una semana de trabajo. */
export const SOON_H = 50;
/** Intervalo por defecto de un servicio de maquinaria sin `nextKm` (manuales: 500 h). */
export const SERVICE_INTERVAL_H = 500;
/** Ventana de anticipacion en dias (misma que `checkExpiry` de lib/document.ts). */
export const SOON_DAYS = 30;

const URGENCY_ORDER: Record<Commitment['urgency'], number> = { overdue: 0, soon: 1, planned: 2 };
const WORST_FIRST = ['overdue', 'soon', 'planned'] as const;

export interface CommitmentInput {
  vehicle: VehicleRow;
  family: VehicleFamily;
  /** Unidad de odometerKm y de los km de los registros ('h' en maquinaria). */
  unit?: UsageUnit;
  odometerKm?: number;
  /** Salud de piezas ya calculada (partsHealth): de aqui salen los cambios de pieza. */
  parts: PartState[];
  maintenance: MaintenanceRow[];
  /** SOAT y tecnomecanica: filas de entidad `document` con `expiry`. */
  documents: { id?: string; kind?: string; expiry?: string }[];
  now: Date;
}

/**
 * Urgencia a partir de lo que falta. Sin ningun dato, `planned`: no se inventa urgencia
 * sobre un compromiso del que no se sabe cuando vence.
 */
export function urgencyOf(remainingKm?: number, remainingDays?: number, soonKm = SOON_KM): Commitment['urgency'] {
  if (remainingKm !== undefined && remainingKm < 0) return 'overdue';
  if (remainingDays !== undefined && remainingDays < 0) return 'overdue';
  if (remainingKm !== undefined && remainingKm <= soonKm) return 'soon';
  if (remainingDays !== undefined && remainingDays <= SOON_DAYS) return 'soon';
  return 'planned';
}

const vehicleIdOf = (v: VehicleRow): string => str(v.id) ?? '';
const soonOf = (input: CommitmentInput): number => (input.unit === 'h' ? SOON_H : SOON_KM);

function remainingKmOf(odo: number | undefined, dueKm: number | undefined): number | undefined {
  return odo === undefined || dueKm === undefined ? undefined : dueKm - odo;
}

/** Un cambio de pieza por cada ranura con dato y proximo vencimiento conocido. */
function partCommitments(input: CommitmentInput): Commitment[] {
  const vehicleId = vehicleIdOf(input.vehicle);
  const out: Commitment[] = [];
  // Un repuesto que cubre varias ranuras (pastillas delanteras = freno izquierdo y derecho)
  // es UN cambio, no dos: se agrupa por repuesto y vencimiento y se queda la primera ranura.
  const seen = new Set<string>();
  for (const p of input.parts) {
    // Solo las piezas con dato: de una `unknown` no se puede afirmar que toque cambio.
    if (p.healthPct === null || p.nextDueKm === undefined) continue;
    const groupKey = `${normalizeText(p.label)}|${p.nextDueKm}`;
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);
    const remainingKm = remainingKmOf(input.odometerKm, p.nextDueKm);
    out.push({
      id: `${vehicleId}-part-${p.slotId}`,
      vehicleId,
      kind: 'part_change',
      title: p.label,
      slotId: p.slotId,
      dueKm: p.nextDueKm,
      remainingKm,
      urgency: urgencyOf(remainingKm, undefined, soonOf(input)),
      status: 'pending',
      source: 'catalog',
      estCostCOP: p.estCostCOP,
    });
  }
  return out;
}

function maintenanceCommitments(input: CommitmentInput): Commitment[] {
  const vehicleId = vehicleIdOf(input.vehicle);
  const out: Commitment[] = [];
  for (const m of input.maintenance) {
    const status = str(m.status) ?? '';
    // Solo lo que sigue pendiente. 'completed' y 'cancelled' son pasado, y un estado
    // desconocido tambien: no se puede afirmar que algo este vivo si nadie lo marco.
    if (!['scheduled', 'overdue', 'in_progress'].includes(status)) continue;

    const next = computeNextService({
      vehicleId,
      type: str(m.type) ?? 'mantenimiento',
      km: num(m.km) ?? 0,
      date: str(m.date) ?? '',
      cost: num(m.cost) ?? 0,
      workshop: str(m.workshop) ?? '',
      // En maquinaria el intervalo por defecto de lib/maintenance (10 000) seria en horas:
      // se fija aqui el de los manuales cuando el registro no trae el proximo servicio.
      nextKm: num(m.nextKm) ?? (input.unit === 'h' && num(m.km) !== undefined ? (num(m.km) as number) + SERVICE_INTERVAL_H : undefined),
      nextDate: str(m.nextDate),
      status,
      notes: str(m.notes),
      description: str(m.description),
    });

    // Sin km ni nextKm en el registro, computeNextService derivaria nextKm = 0 + intervalo:
    // un compromiso fantasma "vencido a 10.000 km". Solo se cuenta por km si hay km real.
    const kmKnown = num(m.km) !== undefined || num(m.nextKm) !== undefined;
    const remainingKm = kmKnown ? remainingKmOf(input.odometerKm, next.nextKm ?? undefined) : undefined;
    const remainingDays = daysUntil(next.nextDate ?? undefined, input.now);
    if (remainingKm === undefined && remainingDays === undefined) continue;

    out.push({
      id: `${vehicleId}-maint-${str(m.id) ?? `${num(m.km) ?? 0}-${str(m.date) ?? ''}`}`,
      vehicleId,
      kind: 'maintenance',
      title: titleOfMaintenance(m),
      slotId: slotOfMaintenance(m, input.family),
      dueKm: next.nextKm ?? undefined,
      dueDate: next.nextDate ?? undefined,
      remainingKm,
      remainingDays,
      urgency: urgencyOf(remainingKm, remainingDays, soonOf(input)),
      status: 'pending',
      source: 'maintenance',
      estCostCOP: num(m.cost),
    });
  }
  return out;
}

/** SOAT y tecnomecanica del propio vehiculo: `document` con `expiry`. */
function documentCommitments(input: CommitmentInput): Commitment[] {
  const vehicleId = vehicleIdOf(input.vehicle);
  const out: Commitment[] = [];
  for (const d of input.documents) {
    const expiry = str(d.expiry);
    if (!expiry) continue;
    const remainingDays = daysUntil(expiry, input.now);
    if (remainingDays === undefined) continue;
    const kind = str(d.kind) ?? 'documento';
    out.push({
      id: `${vehicleId}-doc-${str(d.id) ?? normalizeText(kind).replace(/ +/g, '-')}`,
      vehicleId,
      kind: 'document',
      title: `Renovar ${kind}`,
      dueDate: expiry.slice(0, 10),
      remainingDays,
      urgency: urgencyOf(undefined, remainingDays),
      status: 'pending',
      source: 'document',
    });
  }
  return out;
}

/**
 * Ranura que describe un mantenimiento del calendario. Usa el mismo vocabulario que
 * `slotsForCatalogPart`, asi que "Cambio de aceite" y "Revision de frenos" caen en las
 * ranuras que el 3D construye.
 */
export function slotOfMaintenance(
  m: MaintenanceRow,
  family: VehicleFamily,
): PartSlotId | undefined {
  const text = normalizeText(
    [str(m.type) ?? '', str(m.notes) ?? '', str(m.description) ?? ''].join(' '),
  );
  if (!text) return undefined;
  for (const keyword of [
    'aceite',
    'filtro',
    'buj',
    'bater',
    'cadena',
    'embrague',
    'pastilla',
    'freno',
    'llanta',
    'amortiguador',
  ]) {
    if (!text.includes(keyword)) continue;
    const slots = slotsForCatalogPart(keyword, '', family);
    if (slots.length) return slots[0];
  }
  return undefined;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function titleOfMaintenance(m: MaintenanceRow): string {
  const t = str(m.type);
  const notes = str(m.notes);
  if (t && notes && normalizeText(t) !== normalizeText(notes)) return `${cap(t)} — ${notes}`;
  return cap(t ?? notes ?? 'Mantenimiento');
}

function mergeGroup(items: Commitment[]): Commitment {
  // La pieza manda: trae vida util, km restante y costo estimado del catalogo.
  const base = items.find((c) => c.kind === 'part_change') ?? items[0];
  const dates = items
    .map((c) => c.dueDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  const kms = items.map((c) => c.remainingKm).filter((k): k is number => k !== undefined);
  const dayList = items.map((c) => c.remainingDays).filter((d): d is number => d !== undefined);
  const urgency = WORST_FIRST.find((u) => items.some((c) => c.urgency === u)) ?? 'planned';
  return {
    ...base,
    dueDate: dates[0],
    dueKm: base.dueKm ?? items.find((c) => c.dueKm !== undefined)?.dueKm,
    remainingKm: kms.length ? Math.min(...kms) : undefined,
    remainingDays: dayList.length ? Math.min(...dayList) : undefined,
    estCostCOP: base.estCostCOP ?? items.find((c) => c.estCostCOP !== undefined)?.estCostCOP,
    urgency,
  };
}

/**
 * Agrupa por "lo mismo que hay que hacer": la ranura si la hay (dos 参考 del mismo
 *keyword en carro y moto), si no, el texto normalizado. Un grupo de mas de un elemento
 * se funde en uno solo.
 */
function dedupe(items: Commitment[]): Commitment[] {
  const groups = new Map<string, Commitment[]>();
  for (const c of items) {
    const key = c.slotId ? `slot:${c.slotId}` : `text:${normalizeText(c.title)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.values()].map((g) => (g.length === 1 ? g[0] : mergeGroup(g)));
}

/**
 * Orden de la lista. Para mezclar km y dias en un mismo criterio se usa una escala
 * aproximada (1 dia ~ 50 km de ciudad): es solo para ordenar, y el desempate por titulo
 * deja la lista estable cuando dos vencen a la vez.
 */
const DUE_SCALE_KM_PER_DAY = 50;
/** En maquinaria: un dia de obra son ~8 horas de motor. */
const DUE_SCALE_H_PER_DAY = 8;

export function sortCommitments(items: Commitment[], perDay = DUE_SCALE_KM_PER_DAY): Commitment[] {
  const due = (c: Commitment): number => {
    const kms = c.remainingKm ?? Number.POSITIVE_INFINITY;
    const days = (c.remainingDays ?? Number.POSITIVE_INFINITY) * perDay;
    return Math.min(kms, days);
  };
  return [...items].sort((a, b) => {
    const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (u !== 0) return u;
    const d = due(a) - due(b);
    if (d !== 0) return d;
    return a.title.localeCompare(b.title, 'es');
  });
}

/** Lista de compromisos del vehiculo, ordenada y sin duplicados. */
export function buildCommitments(input: CommitmentInput): Commitment[] {
  const all = [
    ...partCommitments(input),
    ...maintenanceCommitments(input),
    ...documentCommitments(input),
  ];
  return sortCommitments(dedupe(all), input.unit === 'h' ? DUE_SCALE_H_PER_DAY : DUE_SCALE_KM_PER_DAY);
}

/**
 * SOAT y tecnomecanica del propio vehiculo (`vehicle.soatExpiry` / `tecnoExpiry`), que es
 * donde la flota los guarda. Las filas de entidad `document` llegan aparte por
 * `documents` y se deduplican por texto: el mismo documento no aparece dos veces aunque
 * este en los dos sitios.
 */
export function vehicleDocumentExpiries(vehicle: VehicleRow): { kind: string; expiry: string }[] {
  const out: { kind: string; expiry: string }[] = [];
  const soat = str(vehicle.soatExpiry);
  if (soat) out.push({ kind: 'SOAT', expiry: soat.slice(0, 10) });
  const tecno = str(vehicle.tecnoExpiry);
  if (tecno) out.push({ kind: 'Tecnomecánica', expiry: tecno.slice(0, 10) });
  return out;
}
