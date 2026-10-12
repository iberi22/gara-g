/**
 * guestGarage.ts — El garage en modo invitado: los datos viven en IndexedDB de este navegador.
 *
 * Fija el `IndexedDbAdapter` como almacen de domain.ts (una vez, solo en el navegador) y reusa
 * los mismos builders que el servidor (`buildGarageSnapshot`, `buildVehicleDetail`) con el
 * tenant `local-device`. Ningun fetch: ni /api/garage ni /api/fleet.
 *
 * Las escrituras pasan por `createEntity`, `updateEntity` y `deleteEntity` de domain.ts. Las
 * funciones `resolve*Draft` son puras: validan el formulario y devuelven la fila lista para
 * guardar, o los errores por campo.
 */
import { LOCAL_INSTANCE_ID } from '../../lib/appMode';
import { CHILE_DEMO_SAMPLE_VEHICLE } from '../../lib/demoChile';
import {
  type DomainRecord,
  createEntity,
  deleteEntity,
  getEntity,
  getStorageAdapter,
  listEntities,
  setStorageAdapter,
  updateEntity,
} from '../../lib/domain';
import {
  VEHICLE_CATALOG,
  VEHICLE_TYPE_LABELS,
  type UsageUnit,
  type VehicleType,
  findModel,
  usageUnitOfModel,
  usageUnitOfType,
} from '../../lib/vehicleCatalog';
import type { GarageSnapshot, VehicleDetail } from '../../garage/contracts';
import { buildGarageSnapshot, buildVehicleDetail } from '../../garage/domain/snapshot';

/**
 * Fija el almacen IndexedDB como el de domain.ts. Solo navegador; `idb` se carga aqui con
 * import dinamico y no entra al bundle SSR. Idempotente: si ya esta fijado no hace nada.
 */
export async function ensureLocalStore(): Promise<void> {
  const { getLocalAdapter } = await import('../../lib/local/indexedDbAdapter');
  const local = getLocalAdapter();
  if (getStorageAdapter() !== local) setStorageAdapter(local);
}

export async function loadLocalSnapshot(): Promise<GarageSnapshot> {
  await ensureLocalStore();
  return buildGarageSnapshot(LOCAL_INSTANCE_ID);
}

export async function loadLocalDetail(id: string): Promise<VehicleDetail | null> {
  await ensureLocalStore();
  return buildVehicleDetail(LOCAL_INSTANCE_ID, id);
}

// --- Vehiculo de ejemplo ------------------------------------------------------

/**
 * Marca de "ya intente este producto": en cuanto existe, `ensureDemoVehicle` no vuelve a
 * sembrar. Sin ella, un visitante que borra sus vehiculos veria reaparecer el ejemplo.
 */
const DEMO_SEED_FLAG = 'garage:demo-seeded:v1';

/**
 * Siembra UN vehiculo de ejemplo para que el garage no nazca vacio en una demo.
 *
 * Solo la primera vez de cada navegador, solo en modo local (`local-device`) y solo si el
 * tenant aun no tiene vehiculos. Idempotente por diseño: nunca duplica, nunca pisa datos.
 * Vive fuera de `loadLocalSnapshot` a proposito — los tests del garage siguen viendo un
 * almacen vacio salvo que pidan la siembra explicitamente.
 */
export async function ensureDemoVehicle(): Promise<void> {
  await ensureLocalStore();
  try {
    if (localStorage.getItem(DEMO_SEED_FLAG)) return;
    const existing = await listEntities('vehicle', LOCAL_INSTANCE_ID);
    if (existing.length > 0) {
      localStorage.setItem(DEMO_SEED_FLAG, '1');
      return;
    }
    // El primer camion tolva de la flota demo chilena (Kenworth T800, esta en el catalogo):
    // el mismo que el visitante ve despues en la vista de solo lectura de esa flota.
    await addLocalVehicle({
      make: CHILE_DEMO_SAMPLE_VEHICLE.make,
      model: CHILE_DEMO_SAMPLE_VEHICLE.model,
      type: CHILE_DEMO_SAMPLE_VEHICLE.type,
      plate: CHILE_DEMO_SAMPLE_VEHICLE.plate,
      year: CHILE_DEMO_SAMPLE_VEHICLE.year,
      status: 'active',
      unit: 'km',
      usage: CHILE_DEMO_SAMPLE_VEHICLE.usage,
    });
    localStorage.setItem(DEMO_SEED_FLAG, '1');
  } catch {
    // IndexedDB o localStorage bloqueados (navegacion privada): el garage se queda vacio
    // y el visitante sigue viendo el boton de agregar. Sembrar nunca es un requisito.
  }
}

// --- Catalogo para el formulario ---------------------------------------------

export const OTHER_MODEL_KEY = 'otro';

export interface CatalogOption {
  key: string;
  make: string;
  model: string;
  label: string;
  type: VehicleType;
  unit: UsageUnit;
  years: number[];
}

export interface CatalogGroup {
  make: string;
  options: CatalogOption[];
}

/** Modelos del catalogo agrupados por marca, para un <select> con <optgroup>. */
export function catalogGroups(): CatalogGroup[] {
  return VEHICLE_CATALOG.map((mk) => ({
    make: mk.name,
    options: mk.models.map((m) => ({
      key: `${mk.name}|${m.model}`,
      make: mk.name,
      model: m.model,
      label: m.model,
      type: m.type,
      unit: usageUnitOfModel(m),
      years: m.yearsAvailable,
    })),
  })).sort((a, b) => a.make.localeCompare(b.make, 'es'));
}

export function findCatalogOption(key: string): CatalogOption | undefined {
  for (const g of catalogGroups()) {
    const hit = g.options.find((o) => o.key === key);
    if (hit) return hit;
  }
  return undefined;
}

export const TYPE_OPTIONS = VEHICLE_TYPE_LABELS;

// --- Validacion pura --------------------------------------------------------

export type Errors = Record<string, string>;
export type Draft<T> = { ok: true; value: T } | { ok: false; errors: Errors };

const toNumber = (raw: string | number | undefined | null): number | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  const t = raw.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

export function usageLabel(unit: UsageUnit): string {
  return unit === 'h' ? 'Horómetro (horas)' : 'Kilometraje (km)';
}

/** Campo donde se guarda la lectura: `hours` en maquinaria, `mileage` en el resto (como la nube). */
const usageField = (unit: UsageUnit): 'hours' | 'mileage' => (unit === 'h' ? 'hours' : 'mileage');

export interface VehicleFormInput {
  modelKey: string; // 'Marca|Modelo' del catalogo, o OTHER_MODEL_KEY
  make?: string;
  model?: string;
  type?: string;
  plate?: string;
  year?: string | number;
  usage?: string | number;
}

export interface VehicleDraft {
  make: string;
  model: string;
  type: VehicleType;
  plate: string;
  year: number;
  status: 'active';
  unit: UsageUnit;
  usage: number;
}

export function resolveVehicleDraft(input: VehicleFormInput, now: Date = new Date()): Draft<VehicleDraft> {
  const errors: Errors = {};
  let make = '';
  let model = '';
  let type: VehicleType | undefined;
  let unit: UsageUnit = 'km';

  if (input.modelKey === OTHER_MODEL_KEY) {
    make = (input.make ?? '').trim();
    model = (input.model ?? '').trim();
    if (!make) errors.make = 'Escribe la marca.';
    if (!model) errors.model = 'Escribe el modelo.';
    type = VEHICLE_TYPE_LABELS.find((t) => t.value === input.type)?.value;
    if (!type) errors.type = 'Elige el tipo de vehículo.';
    else unit = usageUnitOfType(type);
    // Si lo que escribio existe en el catalogo, el catalogo manda (misma regla que la nube).
    const known = make && model ? findModel(make, model) : undefined;
    if (known) {
      make = known.make;
      model = known.model;
      type = known.type;
      unit = usageUnitOfModel(known);
      delete errors.type;
    }
  } else {
    const opt = findCatalogOption(input.modelKey);
    if (!opt) errors.modelKey = 'Elige un modelo del catálogo u "Otro".';
    else {
      make = opt.make;
      model = opt.model;
      type = opt.type;
      unit = opt.unit;
    }
  }

  const plate = (input.plate ?? '').trim().toUpperCase();
  if (unit === 'km' && !plate && !errors.type && !errors.modelKey) errors.plate = 'Escribe la placa.';

  const year = toNumber(input.year);
  const maxYear = now.getFullYear() + 1;
  if (year === undefined || !Number.isInteger(year) || year < 1950 || year > maxYear) {
    errors.year = `Escribe un año entre 1950 y ${maxYear}.`;
  }

  const usage = toNumber(input.usage);
  if (usage === undefined || usage < 0) {
    errors.usage = unit === 'h' ? 'Escribe las horas del horómetro (0 o más).' : 'Escribe el kilometraje (0 o más).';
  }

  if (Object.keys(errors).length || !type) return { ok: false, errors };
  return {
    ok: true,
    value: { make, model, type, plate, year: year as number, status: 'active', unit, usage: usage as number },
  };
}

export interface MaintenanceFormInput {
  type?: string;
  date?: string;
  reading?: string | number;
  cost?: string | number;
  workshop?: string;
  notes?: string;
}

export interface MaintenanceDraft {
  type: string;
  date: string;
  reading: number | undefined;
  cost: number | undefined;
  workshop: string;
  notes: string;
}

export function resolveMaintenanceDraft(input: MaintenanceFormInput, today: Date = new Date()): Draft<MaintenanceDraft> {
  const errors: Errors = {};
  const type = (input.type ?? '').trim();
  if (!type) errors.type = 'Escribe qué se hizo (por ejemplo, cambio de aceite).';

  const date = (input.date ?? '').trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00`) : Number.NaN;
  if (Number.isNaN(parsed)) errors.date = 'Elige la fecha.';
  else if (parsed > today.getTime() + 24 * 3600 * 1000) errors.date = 'La fecha no puede ser futura.';

  const rawReading = typeof input.reading === 'string' ? input.reading.trim() : input.reading;
  const reading = toNumber(input.reading);
  if (rawReading !== undefined && rawReading !== '' && (reading === undefined || reading < 0)) {
    errors.reading = 'La lectura debe ser un número de 0 o más.';
  }
  const rawCost = typeof input.cost === 'string' ? input.cost.trim() : input.cost;
  const cost = toNumber(input.cost);
  if (rawCost !== undefined && rawCost !== '' && (cost === undefined || cost < 0)) {
    errors.cost = 'El costo debe ser un número de 0 o más.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { type, date, reading, cost, workshop: (input.workshop ?? '').trim(), notes: (input.notes ?? '').trim() },
  };
}

/** Lectura (km u horas) positiva o error. */
export function resolveUsage(raw: string | number | undefined, unit: UsageUnit): Draft<{ usage: number }> {
  const usage = toNumber(raw);
  if (usage === undefined || usage < 0) {
    return { ok: false, errors: { usage: unit === 'h' ? 'Escribe las horas del horómetro (0 o más).' : 'Escribe el kilometraje (0 o más).' } };
  }
  return { ok: true, value: { usage } };
}

// --- Escrituras --------------------------------------------------------------

type Row = Record<string, unknown>;

export async function addLocalVehicle(draft: VehicleDraft): Promise<DomainRecord<Row>> {
  await ensureLocalStore();
  return createEntity(
    'vehicle',
    {
      make: draft.make,
      model: draft.model,
      type: draft.type,
      plate: draft.plate || undefined,
      year: draft.year,
      status: draft.status,
      [usageField(draft.unit)]: draft.usage,
    },
    LOCAL_INSTANCE_ID,
  );
}

export async function setLocalUsage(vehicleId: string, unit: UsageUnit, usage: number): Promise<boolean> {
  await ensureLocalStore();
  const updated = await updateEntity('vehicle', vehicleId, { [usageField(unit)]: usage }, LOCAL_INSTANCE_ID);
  return updated !== null;
}

export async function addLocalMaintenance(
  vehicleId: string,
  unit: UsageUnit,
  draft: MaintenanceDraft,
  currentUsage?: number,
): Promise<void> {
  await ensureLocalStore();
  const reading = draft.reading ?? currentUsage;
  await createEntity(
    'maintenance',
    {
      vehicleId,
      type: draft.type,
      date: draft.date,
      ...(reading !== undefined ? { [usageField(unit) === 'hours' ? 'hours' : 'km']: reading } : {}),
      cost: draft.cost,
      workshop: draft.workshop || undefined,
      notes: draft.notes || undefined,
      status: 'completed',
    },
    LOCAL_INSTANCE_ID,
  );
  // Una lectura mayor que la del vehiculo la adelanta: el contador no se queda atras.
  if (draft.reading !== undefined && (currentUsage === undefined || draft.reading > currentUsage)) {
    await updateEntity('vehicle', vehicleId, { [usageField(unit)]: draft.reading }, LOCAL_INSTANCE_ID);
  }
}

export interface VehicleEdit {
  plate: string;
  make: string;
  model: string;
  year: number;
}

export function resolveVehicleEdit(
  input: { plate?: string; make?: string; model?: string; year?: string | number },
  unit: UsageUnit,
  now: Date = new Date(),
): Draft<VehicleEdit> {
  const errors: Errors = {};
  const make = (input.make ?? '').trim();
  const model = (input.model ?? '').trim();
  const plate = (input.plate ?? '').trim().toUpperCase();
  if (!make) errors.make = 'Escribe la marca.';
  if (!model) errors.model = 'Escribe el modelo.';
  if (unit === 'km' && !plate) errors.plate = 'Escribe la placa.';
  const year = toNumber(input.year);
  const maxYear = now.getFullYear() + 1;
  if (year === undefined || !Number.isInteger(year) || year < 1950 || year > maxYear) {
    errors.year = `Escribe un año entre 1950 y ${maxYear}.`;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { plate, make, model, year: year as number } };
}

export async function updateLocalVehicle(id: string, edit: VehicleEdit): Promise<boolean> {
  await ensureLocalStore();
  const patch: Row = { make: edit.make, model: edit.model, year: edit.year, plate: edit.plate || undefined };
  return (await updateEntity('vehicle', id, patch, LOCAL_INSTANCE_ID)) !== null;
}

/** Borra el vehiculo y todo lo que colgaba de el (mantenimientos, combustible, documentos, alertas). */
export async function deleteLocalVehicle(id: string): Promise<boolean> {
  await ensureLocalStore();
  const exists = await getEntity('vehicle', id, LOCAL_INSTANCE_ID);
  if (!exists) return false;
  for (const entity of ['maintenance', 'fuelLog', 'document', 'alert'] as const) {
    const rows = await listEntities<{ vehicleId?: string }>(entity, LOCAL_INSTANCE_ID);
    for (const r of rows) if (r.vehicleId === id) await deleteEntity(entity, r.id, LOCAL_INSTANCE_ID);
  }
  const ok = await deleteEntity('vehicle', id, LOCAL_INSTANCE_ID);
  try {
    localStorage.removeItem(`garage:paint:${id}`);
  } catch {
    // almacenamiento bloqueado: la pintura huerfana no estorba
  }
  return ok;
}
