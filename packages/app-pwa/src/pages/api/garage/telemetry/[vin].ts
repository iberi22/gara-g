/**
 * /api/garage/telemetry/[vin].ts — GET: estado de monitoreo de un VIN (`MonitoringState`).
 *
 * GET /api/garage/telemetry/:vin → { vin, connected, lastSeen, latest, series }
 *
 * 404 si el VIN no es de un vehiculo de ESTE TENANT. Igual que en
 * /api/garage/vehicle/[id]: el 404 tambien es la proteccion de aislamiento (no se confirma
 * que ese VIN exista en otro cliente).
 *
 * Cualquier rol autenticado puede leer (admin, operator, observer): ver el propio vehiculo
 * en el mapa en vivo es una lectura, no una operacion. El VIN se compara en mayusculas
 * porque la APK lo puede mandar en minusculas.
 */
import type { APIRoute } from 'astro';
import { type TelemetryRow, type VehicleRow, vinOf } from '../../../../garage/domain/records';
import { instanceIdFor } from '../../../../garage/domain/tenant';
import { isValidVin } from '../../../../garage/telemetry/ingest';
import { emptyMonitoringState, monitoringState } from '../../../../garage/telemetry/monitoring';
import { listEntities } from '../../../../lib/domain';
import { bad, ensureSeeded, json } from '../../../../lib/fleetApi';
import { forbidden, getAuthUser, unauthorized } from '../../fleetApi/auth';
import { can } from '../../../../lib/rbac';

export const prerender = false;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  // Mismo criterio que /api/fleet/[entity]: un rol fuera del mapa RBAC no lee el garage.
  if (!can(user.role, 'telemetry', 'read')) return forbidden(`Rol ${user.role} no puede leer telemetry`);

  const rawVin = (params.vin as string | undefined) ?? '';
  const vin = rawVin.trim().toUpperCase();
  if (!vin) return bad('Falta el VIN');
  if (!isValidVin(vin)) return bad(`VIN inválido: ${rawVin}`);

  const instanceId = instanceIdFor(request, locals);
  await ensureSeeded();

  const vehicles = await listEntities<VehicleRow>('vehicle', instanceId);
  if (!vehicles.some((v) => vinOf(v) === vin)) return bad('VIN no encontrado en este tenant', 404);

  const rows = (await listEntities<TelemetryRow>('telemetry', instanceId)) as unknown as Record<
    string,
    unknown
  >[];
  // Un VIN con vehiculo pero sin una sola muestra responde con el estado vacio, no 404:
  // "todavia no ha enviado nada" y "no existe" son respuestas distintas para la APK.
  if (rows.length === 0) return json(emptyMonitoringState(vin));

  return json(monitoringState(vin, rows));
};
