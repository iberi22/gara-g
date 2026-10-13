// vehicle.ts — Validadores puros + CRUD específico de Vehicle
// (WAVE-11.02, issue #877 — VehicleList + VIN/plate validation).
//
// Capa fina sobre los helpers genéricos de `domain.ts` (createEntity/listEntities/
// getEntity/updateEntity/deleteEntity) más lógica de negocio:
//   - `validateVIN(vin)` — 17 chars alfanuméricos sin I/O/Q (NORMA ISO 3779 / US NHTSA).
//   - `validatePlate(plate)` — Colombia carro ABC123/ABC-123, moto ABC12D, Mercosur ABC1D23,
//     o Chile ABCD-12 (actual) / AB-1234 (antigua).
//   - `normalizePlate(plate)` — mayúsculas + forma con guion para las placas chilenas.
//   - `validateVehicleFields(v)` — chequea make/model/fleetId/año/rango.
//
// instance_id isolation: toda fila lleva instance_id, todo query filtra por el
// (delegado a `domain.ts` → MemoryAdapter).

import { isMachineryType, normalizeVehicleType } from './vehicleCatalog';
import { localizeText } from './market.js';
import {
  createEntity,
  listEntities,
  getEntity,
  updateEntity,
  deleteEntity,
  type DomainRecord,
} from './domain.js';

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type VehicleStatus = 'active' | 'maintenance' | 'decommissioned';

export interface VehicleFields extends Record<string, unknown> {
  plate: string;          // ABC123 / ABC-123 (carro), ABC12D (moto), ABC1D23 (Mercosur), ABCD-12 / AB-1234 (Chile)
  vin: string;            // 17 chars, A-Z0-9 sin I/O/Q
  make: string;           // Tesla, Ford, Toyota
  model: string;          // Model 3, F-150
  year: number;           // 1900..current year+1
  status: VehicleStatus;
  fleetId: string;
  type?: string;          // VehicleType del catalogo (src/lib/vehicleCatalog.ts)
  mileage?: number;       // odometro en km (vehiculos de via)
  hours?: number;         // horometro en horas de motor (maquinaria amarilla)
  capacity?: string;      // texto libre: '5 Pax', '3.5 ton', '40 ton' (ver seed)
  soatExpiry?: string;    // ISO date (YYYY-MM-DD)
  tecnoExpiry?: string;   // ISO date (YYYY-MM-DD)
  photoUrl?: string;      // URL a foto del vehículo
}

export type VehicleRecord = DomainRecord<VehicleFields>;

export const VEHICLE_STATUSES: VehicleStatus[] = [
  'active',
  'maintenance',
  'decommissioned',
];

// ── Validadores puros (sin dependencias de DOM/storage) ──────────────────────

/**
 * Valida un VIN (Vehicle Identification Number) según ISO 3779 / US NHTSA:
 *   - exactamente 17 caracteres
 *   - solo A-Z y 0-9 (mayúsculas)
 *   - NO se permiten las letras I, O, Q (para evitar confusión con 1, 0)
 *
 * @param vin - VIN a validar (sin espacios; el caller debe trim() antes)
 * @returns true si el VIN es estructuralmente válido
 */
export function validateVIN(vin: string): boolean {
  if (typeof vin !== 'string') return false;
  if (vin.length !== 17) return false;
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

/** Chile, formato actual (2007+): 4 letras + 2 dígitos, p. ej. ZZBC-11. */
const CHILE_CURRENT = /^([A-Z]{4})-?(\d{2})$/;
/** Chile, formato antiguo: 2 letras + 4 dígitos, p. ej. AB-1234. */
const CHILE_LEGACY = /^([A-Z]{2})-?(\d{4})$/;

/**
 * Normaliza una placa escrita por una persona a su forma canónica.
 *
 * - Siempre: quita espacios al inicio/final y pasa a mayúsculas.
 * - Chile (actual ABCD12 / antigua AB1234): la forma canónica lleva guion
 *   (`ZZBC-11`, `AB-1234`). La lámina chilena trae puntos o separadores
 *   (`ZZ·BC·11`), así que para estos formatos se ignoran espacios, puntos y `·`.
 * - El resto (Colombia, Mercosur, maquinaria) solo cambia de mayúsculas: el guion
 *   de las colombianas se respeta tal como venga y un espacio interno sigue siendo
 *   inválido para `validatePlate`.
 *
 * La usan la API (`/api/fleet/vehicle`, antes de validar y guardar) y la UI
 * (VehicleTable) para que las dos acepten y guarden lo mismo.
 */
export function normalizePlate(plate: string): string {
  if (typeof plate !== 'string') return plate;
  const upper = plate.trim().toUpperCase();
  const compact = upper.replace(/[\s.·]/g, '');
  const cl = CHILE_CURRENT.exec(compact) ?? CHILE_LEGACY.exec(compact);
  return cl ? `${cl[1]}-${cl[2]}` : upper;
}

/**
 * Valida una matrícula/placa de vehículo ya normalizada.
 * Acepta (SOLO uppercase, case-sensitive):
 *   - Colombia carro:      [A-Z]{3}-?\d{3}             e.g. ABC-123 o ABC123
 *   - Colombia moto:       [A-Z]{3}-?\d{2}[A-Z]        e.g. ABC12D o ABC-12D
 *   - Mercosur (Colombia 2017+): [A-Z]{3}\d[A-Z]\d{2}  e.g. ABC1D23
 *   - Chile actual:        [A-Z]{4}-?\d{2}             e.g. ZZBC-11 o ZZBC11
 *   - Chile antigua:       [A-Z]{2}-?\d{4}             e.g. AB-1234 o AB1234
 *
 * El guion es solo formato: la placa oficial colombiana no lo lleva y la gente la
 * escribe de las dos maneras. Antes solo se aceptaba ABC-123 y Mercosur, asi que
 * ninguna moto colombiana (ABC12D) se podia registrar. Las chilenas se añadieron
 * para la flota de volquetas de Chile (tenant flota-demo-chile): sin ellas la API
 * rechazaba crear o editar cualquier camión chileno.
 *
 * El validator es case-SENSITIVE — la placa debe estar en mayúsculas. Para
 * aceptar lo que escribe una persona, pásala antes por `normalizePlate`.
 *
 * @param plate - placa a validar (sin espacios al inicio/final; el caller debe trim() antes)
 * @returns true si la placa es estructuralmente válida
 */
export function validatePlate(plate: string): boolean {
  if (typeof plate !== 'string') return false;
  // Vacío → inválido (vacío es falla explícita, no un edge case silencioso)
  if (plate.length === 0) return false;
  // Regla: sólo letras A-Z (mayúsculas) y dígitos 0-9 (sin guiones extra, sin espacios, sin minúsculas).
  if (!/^[A-Z0-9-]+$/.test(plate)) return false;
  const colombiaCar = /^[A-Z]{3}-?\d{3}$/;
  const colombiaMoto = /^[A-Z]{3}-?\d{2}[A-Z]$/;
  const mercosur = /^[A-Z]{3}\d[A-Z]\d{2}$/;
  return (
    colombiaCar.test(plate) ||
    colombiaMoto.test(plate) ||
    mercosur.test(plate) ||
    CHILE_CURRENT.test(plate) ||
    CHILE_LEGACY.test(plate)
  );
}

/**
 * Serie de maquinaria (PIN / numero de serie del fabricante): la maquinaria vieja no trae
 * VIN de 17 caracteres. Se acepta de 6 a 20 letras/digitos en mayuscula.
 */
export function validateMachineSerial(serial: string): boolean {
  return typeof serial === 'string' && /^[A-Z0-9-]{6,20}$/.test(serial);
}

/** Placa de maquinaria (registro RUNT de maquinaria): letras y digitos, de 4 a 10. */
export function validateMachinePlate(plate: string): boolean {
  return typeof plate === 'string' && /^[A-Z0-9-]{4,10}$/.test(plate);
}

export interface VehicleValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Valida un payload parcial de Vehicle y devuelve la lista de errores.
 *
 * Reglas:
 *   - vin: 17 chars A-Z0-9 sin I/O/Q (obligatorio)
 *   - plate: carro ABC123/ABC-123, moto ABC12D, Mercosur ABC1D23 o Chile ABCD-12/AB-1234
 *     (obligatorio; se valida tras `normalizePlate`, así que minúsculas y ABCD12 valen)
 *   - make: string no-vacía (obligatorio)
 *   - model: string no-vacía (obligatorio)
 *   - fleetId: string no-vacía (obligatorio)
 *   - year: número entero entre 1900 y (current year + 1)
 *   - status: uno de VEHICLE_STATUSES
 *   - type, capacity, soatExpiry, tecnoExpiry, photoUrl: opcionales
 *
 * @param v - payload parcial (campos vacíos o faltantes son tolerados)
 * @returns { ok, errors[] } — `ok=true` si y solo si `errors.length === 0`
 */
export function validateVehicleFields(
  v: Partial<VehicleFields>,
): VehicleValidationResult {
  const errors: string[] = [];
  const blank = (x: unknown): boolean => x === undefined || x === null || String(x).trim() === '';

  // ── type (opcional, pero si viene debe ser del catalogo) ────────────────────
  if (!blank(v.type) && normalizeVehicleType(String(v.type)) === undefined) {
    errors.push(
      localizeText(
        'type desconocido (ver tipos del catalogo: moto, sedan, camion, volqueta, excavadora...)',
      ),
    );
  }
  // La maquinaria amarilla no tiene VIN de 17 ni placa de carro: serie y placa son libres
  // y opcionales (mucha maquinaria de obra no transita por via).
  const machine = isMachineryType(blank(v.type) ? undefined : String(v.type));

  // ── vin ─────────────────────────────────────────────────────────────────────
  if (machine) {
    if (!blank(v.vin) && !validateMachineSerial(String(v.vin).trim())) {
      errors.push('serie inválida (6 a 20 letras o dígitos en mayúscula)');
    }
  } else if (blank(v.vin)) {
    errors.push('vin es obligatorio');
  } else if (!validateVIN(String(v.vin).trim())) {
    errors.push('vin inválido (debe tener 17 caracteres A-Z0-9 sin I/O/Q)');
  }

  // ── plate ───────────────────────────────────────────────────────────────────
  if (machine) {
    if (!blank(v.plate) && !validateMachinePlate(normalizePlate(String(v.plate)))) {
      errors.push('placa de maquinaria inválida (4 a 10 letras o dígitos en mayúscula)');
    }
  } else if (blank(v.plate)) {
    errors.push('plate es obligatoria');
  } else if (!validatePlate(normalizePlate(String(v.plate)))) {
    errors.push('plate inválida (carro ABC123, moto ABC12D, Mercosur ABC1D23 o Chile ABCD-12 / AB-1234)');
  }

  // ── contadores de uso (opcionales, numeros >= 0) ───────────────────────────
  for (const [field, label] of [['mileage', 'kilometraje'], ['hours', 'horómetro']] as const) {
    const raw = v[field];
    if (blank(raw)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 5_000_000) errors.push(`${label} inválido (número mayor o igual a 0)`);
  }

  // ── make ────────────────────────────────────────────────────────────────────
  if (!v.make || String(v.make).trim() === '') {
    errors.push('make es obligatorio');
  }

  // ── model ───────────────────────────────────────────────────────────────────
  if (!v.model || String(v.model).trim() === '') {
    errors.push('model es obligatorio');
  }

  // ── fleetId ────────────────────────────────────────────────────────────────
  if (!v.fleetId || String(v.fleetId).trim() === '') {
    errors.push('fleetId es obligatorio');
  }

  // ── year ────────────────────────────────────────────────────────────────────
  if (v.year === undefined || v.year === null || Number.isNaN(Number(v.year))) {
    errors.push('year es obligatorio');
  } else {
    const y = Number(v.year);
    const minYear = 1900;
    const maxYear = new Date().getFullYear() + 1;
    if (!Number.isInteger(y) || y < minYear || y > maxYear) {
      errors.push(`year fuera de rango (${minYear}..${maxYear})`);
    }
  }

  // ── status (opcional, default 'active') ─────────────────────────────────────
  if (v.status !== undefined && !VEHICLE_STATUSES.includes(v.status)) {
    errors.push(`status inválido (${VEHICLE_STATUSES.join('|')})`);
  }

  // ── capacity (opcional, texto libre: '5 Pax', '40 ton') ─────────────────────
  if (v.capacity !== undefined && v.capacity !== null) {
    const c = String(v.capacity).trim();
    if (c.length > 40) {
      errors.push('capacity debe tener máximo 40 caracteres');
    }
  }

  // ── soatExpiry / tecnoExpiry (opcional) ─────────────────────────────────────
  const dateRe = /^\d{4}-\d{2}-\d{2}/;
  if (v.soatExpiry !== undefined && v.soatExpiry !== null && v.soatExpiry !== '') {
    if (!dateRe.test(String(v.soatExpiry))) {
      errors.push('soatExpiry debe ser ISO date (YYYY-MM-DD)');
    }
  }
  if (v.tecnoExpiry !== undefined && v.tecnoExpiry !== null && v.tecnoExpiry !== '') {
    if (!dateRe.test(String(v.tecnoExpiry))) {
      errors.push('tecnoExpiry debe ser ISO date (YYYY-MM-DD)');
    }
  }

  // ── photoUrl (opcional) ─────────────────────────────────────────────────────
  if (
    v.photoUrl !== undefined &&
    v.photoUrl !== null &&
    v.photoUrl !== '' &&
    !/^(https?:\/\/|\/)/.test(String(v.photoUrl))
  ) {
    errors.push('photoUrl debe empezar con http(s):// o /');
  }

  return { ok: errors.length === 0, errors };
}

// ── Helpers CRUD envueltos (mismo shape que driver.ts pero con domain) ──────

export async function createVehicle(
  data: VehicleFields,
  instanceId?: string,
): Promise<VehicleRecord> {
  return createEntity<VehicleFields>('vehicle', data, instanceId);
}

export async function listVehicles(instanceId?: string): Promise<VehicleRecord[]> {
  return listEntities<VehicleFields>('vehicle', instanceId);
}

export async function getVehicle(
  id: string,
  instanceId?: string,
): Promise<VehicleRecord | null> {
  return getEntity<VehicleFields>('vehicle', id, instanceId);
}

export async function updateVehicle(
  id: string,
  patch: Partial<VehicleFields>,
  instanceId?: string,
): Promise<VehicleRecord | null> {
  return updateEntity<VehicleFields>('vehicle', id, patch, instanceId);
}

export async function deleteVehicle(
  id: string,
  instanceId?: string,
): Promise<boolean> {
  return deleteEntity('vehicle', id, instanceId);
}