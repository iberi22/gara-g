/**
 * POST /api/garage/assistant — Asistente de IA del expediente de un vehiculo.
 *
 * Cuerpo y respuesta: ver src/garage/assistant/handler.ts. Exige sesion (cualquier rol que
 * pueda leer vehiculos); el tenant sale de la sesion y el vehiculo se busca SOLO en el.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { AiBinding } from '../../../garage/assistant/ai';
import { handleAssistant } from '../../../garage/assistant/handler';
import { manualsOf, notesOf } from '../../../garage/assistant/store';
import { buildVehicleDetail } from '../../../garage/domain/snapshot';
import { instanceIdFor } from '../../../garage/domain/tenant';
import { getEntity } from '../../../lib/domain';
import { bad } from '../../../lib/fleetApi';
import { can } from '../../../lib/rbac';
import { forbidden, getAuthUser, unauthorized } from '../fleetApi/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, 'vehicle', 'read')) return forbidden(`Rol ${user.role} no puede leer vehicle`);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('JSON invalido');
  }

  const instanceId = instanceIdFor(request, locals);
  const ai = (env as unknown as { AI?: AiBinding }).AI;

  return handleAssistant(body, {
    ai,
    userId: user.userId ?? user.email ?? 'anon',
    async loadVehicle(vehicleId) {
      const detail = await buildVehicleDetail(instanceId, vehicleId);
      if (!detail) return null;
      const row = await getEntity<Record<string, unknown>>('vehicle', vehicleId, instanceId);
      const { techNotes, techNotesText } = notesOf(row);
      const manuals = (await manualsOf(instanceId, vehicleId)).map((m) => m.name);
      return { detail, notes: techNotes, notesText: techNotesText, manuals };
    },
  });
};
