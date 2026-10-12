// maintenance.ts — Helpers puros de calendario de mantenimiento (WAVE-11.05, issue #874).
//
// Capa fina sobre la entity `maintenance` (whitelisteada en `domain.config.ts`).
// Toda la lógica es pura (sin DOM/storage) para poder testearse con vitest.
//
// Convención de campos del record:
//   vehicleId, type, km, date (ISO YYYY-MM-DD), cost, workshop,
//   nextKm?, nextDate?, status, notes?/description?
//
// Si nextKm/nextDate no vienen en el record, se derivan:
//   nextKm = km + SERVICE_INTERVAL_KM (10000)
//   nextDate = date + SERVICE_INTERVAL_MONTHS (6)

export const SERVICE_INTERVAL_KM = 10_000;
export const SERVICE_INTERVAL_MONTHS = 6;

export type MaintenanceStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'overdue';

export interface MaintenanceFields extends Record<string, unknown> {
  vehicleId: string;
  type: string;
  km: number;
  date: string; // ISO YYYY-MM-DD
  cost: number;
  workshop: string;
  nextKm?: number;
  nextDate?: string; // ISO YYYY-MM-DD
  status: string;
  notes?: string;
  description?: string;
}

export type CalendarState = 'vencido' | 'proximo' | 'ok' | 'completado';

/** Parsea YYYY-MM-DD a Date local (evita el desfase UTC del constructor Date). */
export function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // El constructor Date normaliza en vez de fallar: `new Date(2026, 12, 45)`
  // es el 14 de febrero de 2027 y no da NaN. Sin esta comprobacion de rango, un
  // "2026-13-45" tecleado a mano se aceptaba como una fecha de mantenimiento
  // real, y los vehiculos quedaban con el proximo servicio 15 meses antes de
  // tiempo. Se compara la fecha reconstruida con las partes que se leyeron: si
  // no coinciden, la entrada estaba fuera de rango.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** Formatea Date a YYYY-MM-DD. */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Suma meses calendario a una fecha ISO. */
export function addMonthsISO(iso: string, months: number): string | null {
  const d = parseISODate(iso);
  if (!d) return null;
  d.setMonth(d.getMonth() + months);
  return toISODate(d);
}

/** Próximo servicio: usa nextKm/nextDate si existen, si no los deriva. */
export function computeNextService(r: MaintenanceFields): {
  nextKm: number | null;
  nextDate: string | null;
} {
  const nextKm =
    typeof r.nextKm === 'number' && r.nextKm > 0
      ? r.nextKm
      : typeof r.km === 'number'
        ? r.km + SERVICE_INTERVAL_KM
        : null;
  const nextDate =
    typeof r.nextDate === 'string' && parseISODate(r.nextDate)
      ? r.nextDate
      : typeof r.date === 'string'
        ? addMonthsISO(r.date, SERVICE_INTERVAL_MONTHS)
        : null;
  return { nextKm, nextDate };
}

/**
 * Estado del servicio respecto a hoy (referencia inyectable para tests).
 * - completado/cancelado → 'completado'
 * - nextDate < hoy → 'vencido'
 * - nextDate dentro de 30 días → 'proximo'
 * - resto → 'ok'
 */
export function serviceState(
  r: MaintenanceFields,
  todayISO?: string,
): CalendarState {
  if (r.status === 'completed' || r.status === 'cancelled') return 'completado';
  const { nextDate } = computeNextService(r);
  const ref = todayISO ?? toISODate(new Date());
  if (!nextDate) return 'ok';
  if (nextDate < ref) return 'vencido';
  const refD = parseISODate(ref);
  const nextD = parseISODate(nextDate);
  if (!refD || !nextD) return 'ok';
  const diffDays = Math.round(
    (nextD.getTime() - refD.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diffDays <= 30 ? 'proximo' : 'ok';
}

/** Filtra records por vehicleId ('all' = sin filtro). */
export function filterByVehicle<T extends { vehicleId?: unknown }>(
  records: T[],
  vehicleId: string,
): T[] {
  if (!vehicleId || vehicleId === 'all') return records;
  return records.filter((r) => r.vehicleId === vehicleId);
}

/** Ordena por nextDate ascendente (los sin fecha van al final). */
export function sortByNextDate(
  records: MaintenanceFields[],
): MaintenanceFields[] {
  return [...records].sort((a, b) => {
    const na = computeNextService(a).nextDate ?? 'zzzz';
    const nb = computeNextService(b).nextDate ?? 'zzzz';
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
}

/**
 * Agrupa records por día (YYYY-MM-DD) usando su `date`.
 * Retorna Map ordenado por día ascendente.
 */
export function groupByDay(
  records: MaintenanceFields[],
): Map<string, MaintenanceFields[]> {
  const map = new Map<string, MaintenanceFields[]>();
  for (const r of records) {
    const key =
      typeof r.date === 'string' && parseISODate(r.date) ? r.date : 'sin-fecha';
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return new Map(
    [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}
