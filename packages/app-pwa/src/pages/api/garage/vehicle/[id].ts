/**
 * /api/garage/vehicle/[id].ts — GET: un vehiculo del tenant con todo su historial.
 *
 * GET /api/garage/vehicle/:id → { vehicle: GarageVehicle, history: HistoryEvent[] }
 *
 * 404 si el id no existe EN ESTE TENANT. Ese 404 es tambien la proteccion de aislamiento:
 * un cliente que pide el id de otro tenant recibe "no encontrado", no "no autorizado",
 * porque responder 403 confirmaria que ese id existe en algun sitio.
 *
 * El tenant sale de la sesion; nunca del id de la URL ni de `?instanceId=`.
 */
import type { APIRoute } from 'astro';
import { buildVehicleDetail } from '../../../../garage/domain/snapshot';
import { instanceIdFor } from '../../../../garage/domain/tenant';
import { bad, ensureSeeded, json } from '../../../../lib/fleetApi';
import { forbidden, getAuthUser, unauthorized } from '../../fleetApi/auth';
import { can } from '../../../../lib/rbac';

export const prerender = false;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  // Mismo criterio que /api/fleet/[entity]: un rol fuera del mapa RBAC no lee el garage.
  if (!can(user.role, 'vehicle', 'read')) return forbidden(`Rol ${user.role} no puede leer vehicle`);

  const id = params.id as string | undefined;
  if (!id) return bad('Falta el id del vehículo');

  const instanceId = instanceIdFor(request, locals);
  await ensureSeeded();

  const detail = await buildVehicleDetail(instanceId, id);
  if (!detail) return bad('Vehículo no encontrado', 404);
  return json(detail);
};
