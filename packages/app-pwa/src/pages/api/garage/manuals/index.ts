/**
 * GET /api/garage/manuals?vehicleId=... — Manuales del vehiculo con su estado de indexado.
 *
 * Solo lee el tenant de la sesion; un vehicleId de otro tenant devuelve lista vacia.
 */
import type { APIRoute } from 'astro';
import { manualsOf } from '../../../../garage/assistant/store';
import { instanceIdFor } from '../../../../garage/domain/tenant';
import { bad, json } from '../../../../lib/fleetApi';
import { can } from '../../../../lib/rbac';
import { forbidden, getAuthUser, unauthorized } from '../../fleetApi/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, 'document', 'read')) return forbidden(`Rol ${user.role} no puede leer documentos`);
  const vehicleId = url.searchParams.get('vehicleId');
  if (!vehicleId) return bad('Falta vehicleId');
  return json({ manuals: await manualsOf(instanceIdFor(request, locals), vehicleId) });
};
