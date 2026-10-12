/**
 * PUT /api/garage/notes/:vehicleId — Notas tecnicas del vehiculo (torques, capacidades,
 * referencias, observaciones del dueno). El asistente las usa como dato del vehiculo.
 *
 * Cuerpo: { techNotes: [{label, value}], techNotesText: string }. Requiere permiso de
 * actualizar vehiculos; 404 si el vehiculo no es del tenant de la sesion.
 */
import type { APIRoute } from 'astro';
import { parseNotes } from '../../../../garage/assistant/store';
import { instanceIdFor } from '../../../../garage/domain/tenant';
import { getEntity, updateEntity } from '../../../../lib/domain';
import { bad, json } from '../../../../lib/fleetApi';
import { can } from '../../../../lib/rbac';
import { forbidden, getAuthUser, unauthorized } from '../../fleetApi/auth';

export const prerender = false;

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, 'vehicle', 'update')) return forbidden(`Rol ${user.role} no puede editar vehiculos`);

  const vehicleId = params.vehicleId as string | undefined;
  if (!vehicleId) return bad('Falta el id del vehiculo');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('JSON invalido');
  }
  const parsed = parseNotes(body);
  if (!parsed.ok) return bad(parsed.error);

  const instanceId = instanceIdFor(request, locals);
  const vehicle = await getEntity('vehicle', vehicleId, instanceId);
  if (!vehicle) return bad('Vehiculo no encontrado', 404);
  await updateEntity('vehicle', vehicleId, { ...parsed.notes }, instanceId);
  return json({ ok: true, ...parsed.notes });
};
