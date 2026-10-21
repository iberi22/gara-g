/**
 * records.ts — Forma de las filas crudas que el garage lee de la tabla `entity`
 * y utilidades para interpretarlas sin `any`.
 *
 * Por que existe: las entidades de domain.config.ts guardan campos sueltos en un
 * JSON (`data`), asi que cada consumidor los lee con `as any` y cada uno se inventa su
 * regla para el odometro, la fecha o el nombre. Aqui queda UNA lectura tolerantemente
 * tipada (`num`, `str`, `isoOf`, `todayOf`) que usan partsHealth, commitments, history,
 * indicators y snapshot. Un campo puede venir con tipo equivocado porque lo escribio un
 * importador o un formulario: se ignora (undefined) en vez de romper el snapshot entero.
 *
 * Nada de este fichero escribe: es solo lectura y forma de datos.
 */
import type { DomainRecord } from '../../lib/domain';

// ---------------------------------------------------------------------------
// Filas crudas (data JSON de `entity`, mas las columnas de la tabla)
// ---------------------------------------------------------------------------

export interface VehicleRow extends Record<string, unknown> {
  plate?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  /** 'active' | 'maintenance' | 'decommissioned' (src/lib/vehicle.ts). */
  status?: string;
  type?: string;
  capacity?: string;
  soatExpiry?: string;
  tecnoExpiry?: string;
  photoUrl?: string;
  /** Odometro en km: el seed y los importadores lo guardan aqui. */
  mileage?: number;
  fleetId?: string;
  /** Nombre que escribio el usuario; si no, se compone marca + modelo. */
  name?: string;
  /** Pintura elegida por el usuario (#rrggbb). */
  color?: string;
  paint?: string;
  /** Armado 3D del usuario (VehicleBuild3d); sin sanear, ver build3d.ts. */
  build3d?: unknown;
}

export interface MaintenanceRow extends Record<string, unknown> {
  vehicleId: string;
  type?: string;
  km?: number;
  date?: string;
  cost?: number;
  workshop?: string;
  nextKm?: number;
  nextDate?: string;
  status?: string;
  notes?: string;
  description?: string;
}

export interface FuelLogRow extends Record<string, unknown> {
  vehicleId: string;
  date?: string;
  km?: number;
  gallons?: number;
  cost?: number;
  station?: string;
  kmPerGallon?: number;
}

export interface DocumentRow extends Record<string, unknown> {
  vehicleId: string;
  /** Texto libre del seed: 'SOAT', 'Tecnomecánica', 'Tarjeta de propiedad'. */
  kind?: string;
  expiry?: string;
  status?: string;
}

export interface AlertRow extends Record<string, unknown> {
  vehicleId: string;
  kind?: string;
  severity?: string;
  message?: string;
  acknowledged?: boolean;
}

export interface TelemetryRow extends Record<string, unknown> {
  vin: string;
  /** epoch en ms (como lo escribe fleetSeed) o ISO. */
  timestamp?: number | string;
  speed?: number;
  rpm?: number;
  coolantTemp?: number;
  fuelLevel?: number;
  latitude?: number;
  longitude?: number;
  troubleCodes?: string[];
  odometer?: number;
  hours?: number;
}

export type VehicleRecord = DomainRecord<VehicleRow>;
export type MaintenanceRecord = DomainRecord<MaintenanceRow>;
export type FuelLogRecord = DomainRecord<FuelLogRow>;
export type DocumentRecord = DomainRecord<DocumentRow>;
export type AlertRecord = DomainRecord<AlertRow>;
export type TelemetryRecord = DomainRecord<TelemetryRow>;

// ---------------------------------------------------------------------------
// Lecturas tolerantes
// ---------------------------------------------------------------------------

/** Numero finito o undefined. Cierra `NaN` de un importador con mal dato. */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Texto no vacio (recortado) o undefined. */
export function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

/**
 * Fecha ISO a string ISO. Acepta epoch en ms, epoch en s y texto ya ISO
 * (`2026-03-15` se trata a medianoche UTC). Devuelve undefined si no hay fecha.
 */
export function isoOf(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Un epoch en segundos (10 digitos) tambien aparece en importadores OBD2.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Epoch en ms de un campo de fecha, o undefined. */
export function msOf(v: unknown): number | undefined {
  const iso = isoOf(v);
  return iso ? Date.parse(iso) : undefined;
}

/** `YYYY-MM-DD` del instante de referencia; las fechas del dominio son de dia, no de hora. */
export function todayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Dias (enteros) entre hoy y una fecha ISO. Negativo = ya vencio. */
export function daysUntil(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return undefined;
  const today = Date.parse(`${todayOf(now)}T00:00:00Z`);
  return Math.round((t - today) / 86_400_000);
}

/** Minúsculas sin tildes, para comparar textos de usuario (nombres de repuestos). */
export function normalizeText(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      // Quita los signos combinantes que deja NFD, por propiedad Unicode en vez de por rango
      // literal: el rango escrito con los caracteres sueltos depende de que nadie los combine
      // al guardar el fichero, y asi se ve igual pero rompe.
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/** Texto con tildes conservado pero sin espacios dobles: para mostrar. */
export function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Interpretacion de negocio compartida
// ---------------------------------------------------------------------------

export type GarageStatus = 'active' | 'maintenance' | 'idle';

/**
 * `vehicle.status` usa el vocabulario de flota ('decommissioned'), el garage usa el suyo
 * ('idle'): un vehiculo dado de baja se muestra en el garage pero no como activo.
 */
export function garageStatusOf(status: unknown): GarageStatus {
  if (status === 'active') return 'active';
  if (status === 'maintenance' || status === 'in_progress') return 'maintenance';
  return 'idle';
}

/** Nombre visible del vehiculo: el del usuario; si no, marca + modelo; si no, placa. */
export function vehicleNameOf(v: VehicleRow): string {
  // `||` y no `??`: tidy() devuelve '' (no undefined) cuando no hay marca ni modelo, y
  // con `??` un vehiculo con solo placa se quedaba sin nombre.
  return str(v.name) || tidy([str(v.make), str(v.model)].filter(Boolean).join(' ')) || str(v.plate) || 'Vehículo';
}

/**
 * Odometro actual en km. Prioridad: el campo `mileage` del vehiculo; si no existe, el
 * mayor km registrado en sus mantenimientos, luego en sus cargas de combustible y por
 * ultimo el odometro de la ultima muestra de telemetria. Devolver undefined (y no 0)
 * cuando no hay ninguna fuente: "no lo se" no es "0 km".
 */
export function resolveOdometerKm(
  vehicle: VehicleRow,
  maintenance: MaintenanceRow[],
  fuelLogs: FuelLogRow[],
  telemetry: TelemetryRow[] = [],
): number | undefined {
  const own = num(vehicle.mileage) ?? num(vehicle.odometerKm) ?? num(vehicle.odometer);
  if (own !== undefined) return own;

  const maxOf = (values: (number | undefined)[]): number | undefined => {
    const ok = values.filter((v): v is number => v !== undefined && v >= 0);
    return ok.length ? Math.max(...ok) : undefined;
  };

  return (
    maxOf(maintenance.map((m) => num(m.km))) ??
    maxOf(fuelLogs.map((f) => num(f.km))) ??
    maxOf(telemetry.map((t) => num(t.odometer)))
  );
}

/**VIN en mayusculas y recortado: es la clave con la que se cruza la telemetria. */
export function vinOf(v: VehicleRow): string | undefined {
  const vin = str(v.vin);
  return vin ? vin.toUpperCase() : undefined;
}
