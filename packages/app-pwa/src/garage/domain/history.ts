/**
 * history.ts — Linea de tiempo del vehiculo: todo lo que le ha pasado, mas reciente
 * primero. Es el panel "Historial" del garage.
 *
 * De donde sale cada evento:
 *  - `maintenance`: cada registro con su fecha/km/costo. Si su texto corresponde a una pieza
 *    del catalogo, se marca `part_change` (que es lo que el usuario recuerda: "me
 *    cambiaron las pastillas"); si no, se queda `maintenance`.
 *  - `fuelLog`: cada carga con su km, galones y costo.
 *  - `document`: emision/vencimiento de SOAT, tecnomecanica y demas.
 *  - `alert`: alertas del vehiculo, con su severidad.
 *  - telemetria: codigos DTC agrupados. Un mismo codigo que aparece en 40 muestras NO es 40
 *    filas: se agrupa por codigo y se cuenta ("P0301 x 43"), con la ultima vez visto. Esa
 *    es la forma en que un técnico lee un log: un codigo, cuantas veces, desde cuando.
 *
 * Orden: por fecha descendente (lo mas nuevo arriba) y, a igualdad de fecha, por titulo
 * para que la lista sea estable entre peticiones.
 */
import type { HistoryEvent, HistoryKind, PartSlotId, VehicleFamily } from '../contracts';
import { slotsForCatalogPart } from '../parts';
import {
  type AlertRow,
  type DocumentRow,
  type FuelLogRow,
  type MaintenanceRow,
  type TelemetryRow,
  isoOf,
  normalizeText,
  num,
  str,
  tidy,
} from './records';

/** Ventana (en muestras) para buscar el ultimo instante en que aparecio un DTC. */
export interface HistoryInput {
  vehicleId: string;
  family: VehicleFamily;
  maintenance: MaintenanceRow[];
  fuelLogs: FuelLogRow[];
  documents: DocumentRow[];
  alerts: AlertRow[];
  /** Muestras de telemetria del VIN del vehiculo (sin filtrar por tiempo). */
  telemetry: TelemetryRow[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function kindForMaintenance(
  text: string,
  family: VehicleFamily,
): { kind: HistoryKind; slots: PartSlotId[] } {
  const tokens = text.split(' ');
  const keywords = [
    'aceite',
    'filtro',
    'buj',
    'bater',
    'cadena',
    'arrastre',
    'embrague',
    'pastilla',
    'freno',
    'disco',
    'llanta',
    'amortiguador',
    'escape',
    // maquinaria amarilla
    'hidraulico',
    'diente',
    'dientes',
    'balde',
    'cuchilla',
    'cuchillas',
    'oruga',
    'zapatas',
    'pasadores',
    'bujes',
    'vertedera',
    'escarificador',
    'tambor',
  ];
  const slots = new Set<PartSlotId>();
  let hit = false;
  for (const kw of keywords) {
    if (!tokens.includes(kw)) continue;
    hit = true;
    for (const slot of slotsForCatalogPart(kw, '', family)) slots.add(slot);
  }
  return hit ? { kind: 'part_change', slots: [...slots] } : { kind: 'maintenance', slots: [] };
}

function maintenanceEvents(input: HistoryInput): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const m of input.maintenance) {
    const at = isoOf(m.date ?? m.km);
    if (!at) continue;
    const type = str(m.type);
    const notes = str(m.notes) ?? str(m.description);
    const title = type ? cap(type) : cap(notes ?? 'Mantenimiento');
    const text = normalizeText([type ?? '', notes ?? ''].join(' '));
    const { kind, slots } = kindForMaintenance(text, input.family);
    out.push({
      id: `hist-maint-${str(m.id) ?? at}`,
      vehicleId: input.vehicleId,
      at,
      kind,
      title: notes && notes !== title ? `${title} — ${tidy(notes)}` : title,
      detail: str(m.workshop) ? `Taller: ${str(m.workshop)}` : undefined,
      km: num(m.km),
      costCOP: num(m.cost),
      slotIds: slots.length ? slots : undefined,
    });
  }
  return out;
}

function fuelEvents(input: HistoryInput): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const f of input.fuelLogs) {
    const at = isoOf(f.date);
    if (!at) continue;
    const gallons = num(f.gallons);
    const kmpg = num(f.kmPerGallon);
    out.push({
      id: `hist-fuel-${str(f.id) ?? at}`,
      vehicleId: input.vehicleId,
      at,
      kind: 'fuel',
      title: 'Carga de combustible',
      detail: [
        gallons !== undefined ? `${gallons.toLocaleString('es-CO')} gal` : undefined,
        kmpg ? `${kmpg.toFixed(1)} km/gal` : undefined,
        str(f.station) ?? undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      km: num(f.km),
      costCOP: num(f.cost),
    });
  }
  return out;
}

function documentEvents(input: HistoryInput): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const d of input.documents) {
    const expiry = str(d.expiry);
    // Sin `expiry` un documento no tiene fecha que colocar en la linea de tiempo.
    if (!expiry) continue;
    const at = isoOf(expiry);
    if (!at) continue;
    const kind = str(d.kind) ?? 'Documento';
    out.push({
      id: `hist-doc-${str(d.id) ?? at}`,
      vehicleId: input.vehicleId,
      at,
      kind: 'document',
      title: `${kind} — vence ${expiry.slice(0, 10)}`,
      detail: str(d.status) ? `Estado: ${str(d.status)}` : undefined,
    });
  }
  return out;
}

function alertEvents(input: HistoryInput): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const a of input.alerts) {
    // La entidad `alert` no tiene fecha propia: usa created_at/updated_at de la fila.
    const at = isoOf(
      (a as Record<string, unknown>).created_at ?? (a as Record<string, unknown>).updated_at,
    );
    if (!at) continue;
    const severity = str(a.severity);
    out.push({
      id: `hist-alert-${str(a.id) ?? at}`,
      vehicleId: input.vehicleId,
      at,
      kind: 'alert',
      title: str(a.message) ?? cap(str(a.kind) ?? 'Alerta'),
      detail: [
        str(a.kind) ? `Tipo: ${str(a.kind)}` : undefined,
        severity ? `Severidad: ${severity}` : undefined,
        a.acknowledged ? undefined : 'Sin reconocer',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return out;
}

export interface DtcSummary {
  code: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

/** DTC agrupados por codigo: cuantos y cuando. Base del evento de historial. */
export function summarizeDtc(telemetry: TelemetryRow[]): DtcSummary[] {
  const byCode = new Map<string, { count: number; first: number; last: number }>();
  for (const t of telemetry) {
    const codes = Array.isArray(t.troubleCodes) ? t.troubleCodes : [];
    if (codes.length === 0) continue;
    const at = isoOf(t.timestamp);
    const ms = at ? Date.parse(at) : 0;
    for (const raw of codes) {
      const code = str(raw)?.toUpperCase();
      if (!code) continue;
      const cur = byCode.get(code);
      if (!cur) byCode.set(code, { count: 1, first: ms, last: ms });
      else {
        cur.count += 1;
        cur.first = Math.min(cur.first, ms);
        cur.last = Math.max(cur.last, ms);
      }
    }
  }
  return [...byCode.entries()]
    .map(([code, v]) => ({
      code,
      count: v.count,
      firstSeen: v.first ? new Date(v.first).toISOString() : '',
      lastSeen: v.last ? new Date(v.last).toISOString() : '',
    }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

function dtcEvents(input: HistoryInput): HistoryEvent[] {
  return summarizeDtc(input.telemetry)
    .filter((d) => d.lastSeen !== '')
    .map((d) => ({
      id: `hist-dtc-${d.code}`,
      vehicleId: input.vehicleId,
      at: d.lastSeen,
      kind: 'dtc' as const,
      title: `Código DTC ${d.code}`,
      detail:
        d.count === 1
          ? 'Detectado una vez'
          : `Detectado ${d.count.toLocaleString('es-CO')} veces · primera vez ${d.firstSeen.slice(0, 16).replace('T', ' ')}`,
    }));
}

/** Linea de tiempo del vehiculo, mas reciente primero. */
export function buildHistory(input: HistoryInput): HistoryEvent[] {
  const events = [
    ...maintenanceEvents(input),
    ...fuelEvents(input),
    ...documentEvents(input),
    ...alertEvents(input),
    ...dtcEvents(input),
  ];
  return events.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.title.localeCompare(b.title, 'es');
  });
}
