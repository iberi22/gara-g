/**
 * /api/garage/vehicles.ts — GET: el garage completo del tenant (`GarageSnapshot`).
 *
 * GET /api/garage/vehicles → { vehicles: GarageVehicle[], generatedAt: ISO }
 *
 * Reglas (mismas que /api/fleet/[entity], ver docs/garage/ARCHITECTURE.md):
 *  - Sesion obligatoria: sin cookie de sesion, 401. El middleware ya devuelve 401 JSON en
 *    /api/*, pero la ruta lo comprueba igual (mismo patron que fleetApi/auth.ts) para que el
 *    handler sea ejecutable en test y no dependa del middleware.
 *  - El tenant SIEMPRE sale de la sesion (`locals.tenant?.instanceId`), nunca de la
 *    request. `?instanceId=` se ignora en produccion. Un usuario autenticado que cambie el
 *    parametro no ve la flota de otro: la PK de D1 es (instance_id, entity, id).
 *  - Rol: cualquiera autenticado puede ver su propio garage (admin, operator y observer), que
 *    es lo que dice la tabla de la arquitectura.
 */
import type { APIRoute } from 'astro';
import { buildGarageSnapshot } from '../../../garage/domain/snapshot';
import { instanceIdFor } from '../../../garage/domain/tenant';
import { ensureSeeded, json } from '../../../lib/fleetApi';
import { forbidden, getAuthUser, unauthorized } from '../fleetApi/auth';
import { can } from '../../../lib/rbac';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  // Mismo criterio que /api/fleet/[entity]: un rol fuera del mapa RBAC no lee el garage.
  if (!can(user.role, 'vehicle', 'read')) return forbidden(`Rol ${user.role} no puede leer vehicle`);

  const instanceId = instanceIdFor(request, locals);
  await ensureSeeded();

  const snapshot = await buildGarageSnapshot(instanceId);
  return json(snapshot);
};
