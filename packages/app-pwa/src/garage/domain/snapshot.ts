import { listEntities } from '../../lib/domain';
import { findModel, usageUnitOfModel } from '../../lib/vehicleCatalog';
/**
 * snapshot.ts — Ensambla el `GarageSnapshot` (la lista del garage) y el `VehicleDetail` (un
 * vehiculo con todo su historial) leyendo las entidades del tenant.
 *
 * Por que aqui y no en la API: la API solo resuelve sesion, tenant y errores; toda la
 * cuenta (salud de piezas, compromisos, historial, indicadores) vive en el dominio, que es
 * puro y testeable sin HTTP ni D1. `buildGarageSnapshot` es determinista para un `now`
 * dado, asi que dos llamadas con el mismo instante devuelven la misma salud.
 *
 * Aislamiento: TODAS las consultas usan el `instanceId` que le pasa la sesion. Aqui no se
 * deduce ningun tenant ni se acepta ninguno de la request; si hace falta, es la ruta la
 * que lo resuelve (`resolveInstanceId(request, locals.tenant?.instanceId)`).
 *
 * Nota sobre `mileage` vs `odometerKm`: la flota guarda el odometro en `vehicle.mileage`
 * (asi lo escribe fleetSeed), mientras que `GarageVehicle` lo llama `odometerKm`. La
 * traduccion vive en `records.resolveOdometerKm`, con el mantenimiento, el combustible y la
 * telemetria como respaldo.
 */
import type { GarageSnapshot, GarageVehicle, UsageUnit, VehicleDetail } from '../contracts';
import { buildCommitments, vehicleDocumentExpiries } from './commitments';
import { buildHistory } from './history';
import { buildIndicators } from './indicators';
import { computePartStates, overallHealthPct as weightedHealth } from './partsHealth';
import {
  type AlertRow,
  type DocumentRow,
  type FuelLogRow,
  type MaintenanceRow,
  type TelemetryRow,
  type VehicleRow,
  garageStatusOf,
  msOf,
  num,
  resolveOdometerKm,
  str,
  vehicleNameOf,
  vinOf,
} from './records';
import { bodyFor, specForVehicle } from './vehicleSpec';
import { versionRefFor } from './versionKey';

/** Todo lo que el garage necesita de un tenant, ya filtrado por vehiculo. */
export interface VehicleData {
  vehicle: VehicleRow & { id: string };
  maintenance: MaintenanceRow[];
  fuelLogs: FuelLogRow[];
  documents: DocumentRow[];
  alerts: AlertRow[];
  telemetry: TelemetryRow[];
}

const ofVehicle = <T extends { vehicleId?: string }>(rows: T[], id: string): T[] =>
  rows.filter((r) => str(r.vehicleId) === id);

const ofVin = (rows: TelemetryRow[], vin: string | undefined): TelemetryRow[] =>
  vin ? rows.filter((t) => (str(t.vin) ?? '').toUpperCase() === vin) : [];

/**
 * Carga las entidades del tenant y las reparte por vehiculo. Una sola pasada por entidad:
 * con N vehiculos son 6 consultas, no 6*N (el `listEntities` de MVP trae la entidad entera
 * y filtra en memoria; ver la nota de `docs/garage/ARCHITECTURE.md`).
 */
export async function loadTenantData(instanceId: string): Promise<Map<string, VehicleData>> {
  const [vehicles, maintenance, fuelLogs, documents, alerts, telemetry] = await Promise.all([
    listEntities<VehicleRow>('vehicle', instanceId),
    listEntities<MaintenanceRow>('maintenance', instanceId),
    listEntities<FuelLogRow>('fuelLog', instanceId),
    listEntities<DocumentRow>('document', instanceId),
    listEntities<AlertRow>('alert', instanceId),
    listEntities<TelemetryRow>('telemetry', instanceId),
  ]);

  const map = new Map<string, VehicleData>();
  for (const v of vehicles) {
    const id = str(v.id);
    if (!id) continue;
    const vin = vinOf(v);
    map.set(id, {
      vehicle: { ...v, id },
      maintenance: ofVehicle(maintenance, id),
      fuelLogs: ofVehicle(fuelLogs, id),
      documents: ofVehicle(documents, id),
      alerts: ofVehicle(alerts, id),
      telemetry: ofVin(telemetry, vin),
    });
  }
  return map;
}

/** Ultima muestra de telemetria de un VIN (epoch ms), o undefined. */
export function lastTelemetryMs(telemetry: TelemetryRow[]): number | undefined {
  let best: number | undefined;
  for (const t of telemetry) {
    const ms = msOf(t.timestamp);
    if (ms === undefined) continue;
    if (best === undefined || ms > best) best = ms;
  }
  return best;
}

/**
 * Unidad de uso del vehiculo: horas en maquinaria (familia o modelo del catalogo que lo
 * diga), km en todo lo demas.
 */
export function usageUnitOf(vehicle: VehicleRow): UsageUnit {
  if (bodyFor(vehicle).family === 'machinery') return 'h';
  const model = findModel(str(vehicle.make) ?? '', str(vehicle.model) ?? '');
  return usageUnitOfModel(model);
}

const hoursOf = (r: Record<string, unknown>): number | undefined =>
  num(r.hours) ?? num(r.hourMeter) ?? num(r.horometro);

/**
 * Datos de una maquina con el horometro puesto en los campos de km. Todo el calculo de
 * salud, compromisos e historial es por "contador de uso": asi sirve igual para km que para
 * horas, y la unidad viaja en `GarageVehicle.usageUnit` (ver contracts.ts). Los registros
 * viejos que guardaron las horas en `km` se respetan como horas.
 */
export function inUsageUnit(data: VehicleData, unit: UsageUnit): VehicleData {
  if (unit === 'km') return data;
  return {
    ...data,
    vehicle: { ...data.vehicle, mileage: hoursOf(data.vehicle) ?? num(data.vehicle.mileage), odometerKm: undefined, odometer: undefined },
    maintenance: data.maintenance.map((m) => ({ ...m, km: hoursOf(m) ?? num(m.km), nextKm: num(m.nextHours) ?? num(m.nextKm) })),
    fuelLogs: data.fuelLogs.map((f) => ({ ...f, km: hoursOf(f) ?? num(f.km), kmPerGallon: undefined })),
    telemetry: data.telemetry.map((t) => ({ ...t, odometer: num(t.hours) })),
  };
}

/** Un `GarageVehicle` completo a partir de los datos de un vehiculo del tenant. */
export function buildGarageVehicle(raw: VehicleData, now: Date): GarageVehicle {
  const unit = usageUnitOf(raw.vehicle);
  const data = inUsageUnit(raw, unit);
  const { vehicle } = data;
  const id = vehicle.id;
  const vin = vinOf(vehicle);
  const { family, body } = bodyFor(vehicle);
  const odometerKm = resolveOdometerKm(vehicle, data.maintenance, data.fuelLogs, data.telemetry);

  const parts = computePartStates({
    family,
    body,
    make: str(vehicle.make),
    model: str(vehicle.model),
    odometerKm,
    maintenance: data.maintenance,
  });
  const health = weightedHealth(parts);

  // SOAT y tecnomecanica viven en dos sitios (fila del vehiculo y entidad `document`): se
  // juntan y se deduplican por tipo para que el panel de documentos no los duplique.
  const docs = [
    ...vehicleDocumentExpiries(vehicle),
    ...data.documents.map((d) => ({ kind: str(d.kind), expiry: str(d.expiry) })),
  ];
  const seenDocs = new Set<string>();
  const uniqueDocs = docs.filter((d) => {
    const key = `${(d.kind ?? '').toLowerCase()}|${d.expiry}`;
    if (seenDocs.has(key)) return false;
    seenDocs.add(key);
    return true;
  });

  const commitments = buildCommitments({
    vehicle,
    family,
    unit,
    odometerKm,
    parts,
    maintenance: data.maintenance,
    documents: uniqueDocs,
    now,
  });

  const indicators = buildIndicators({
    vehicle,
    overallHealthPct: health,
    unit,
    odometerKm,
    parts,
    commitments,
    fuelLogs: data.fuelLogs,
    alerts: data.alerts,
    documents: uniqueDocs,
    lastTelemetryMs: lastTelemetryMs(data.telemetry),
    now,
  });

  return {
    id,
    plate: str(vehicle.plate),
    vin,
    name: vehicleNameOf(vehicle),
    make: str(vehicle.make),
    model: str(vehicle.model),
    year: num(vehicle.year),
    status: garageStatusOf(vehicle.status),
    spec: specForVehicle(vehicle, id),
    version: versionRefFor({
      make: str(vehicle.make),
      model: str(vehicle.model),
      year: num(vehicle.year),
    }),
    usageUnit: unit,
    odometerKm,
    overallHealthPct: health,
    indicators,
    parts,
    commitments,
  };
}

/** `GET /api/garage/vehicles`: el garage completo del tenant. */
export async function buildGarageSnapshot(
  instanceId: string,
  now: Date = new Date(),
): Promise<GarageSnapshot> {
  const data = await loadTenantData(instanceId);
  const vehicles = [...data.values()]
    .map((d) => buildGarageVehicle(d, now))
    // Orden estable: primero los que necesitan atencion (compromisos vencidos), luego por
    // nombre. Sin esto, el carrusel del HUD cambiaria de orden entre dos peticiones.
    .sort((a, b) => {
      const over = (v: GarageVehicle) =>
        v.commitments.filter((c) => c.urgency === 'overdue').length;
      const d = over(b) - over(a);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'es');
    });
  return { vehicles, generatedAt: now.toISOString() };
}

/**
 * `GET /api/garage/vehicle/:id`: un vehiculo con su historial. Devuelve null si el id no
 * existe EN ESTE TENANT (la ruta lo traduce a 404). No mira nunca otro `instanceId`.
 */
export async function buildVehicleDetail(
  instanceId: string,
  id: string,
  now: Date = new Date(),
): Promise<VehicleDetail | null> {
  const data = await loadTenantData(instanceId);
  const found = data.get(id);
  if (!found) return null;
  const vehicle = buildGarageVehicle(found, now);
  const { family } = bodyFor(found.vehicle);
  const inUnit = inUsageUnit(found, vehicle.usageUnit);
  const history = buildHistory({
    vehicleId: id,
    family,
    maintenance: inUnit.maintenance,
    fuelLogs: inUnit.fuelLogs,
    documents: inUnit.documents,
    alerts: inUnit.alerts,
    telemetry: inUnit.telemetry,
  });
  return { vehicle, history };
}
