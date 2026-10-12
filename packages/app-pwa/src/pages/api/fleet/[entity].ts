/**
 * /api/fleet/[entity].ts — Generic REST endpoint for fleet entities with RBAC.
 *
 * GET ?instanceId=… → list  (admin/operator/observer)
 * POST body → create        (admin/operator — operator only on allowed entities)
 * GET /api/fleet/[entity]?id=… → single  (any authed)
 * PATCH /api/fleet/[entity]?id=… → update (admin/operator)
 * DELETE /api/fleet/[entity]?id=… → delete (admin only)
 *
 * RBAC enforced via src/lib/rbac.ts. Auth via src/pages/api/fleetApi/auth.ts.
 */
import type { APIRoute } from 'astro';
import {
  json,
  bad,
  resolveInstanceId,
  validateEntity,
  handleList,
  handleGet,
  handleCreate,
  handleUpdate,
  handleDelete,
} from '../../../lib/fleetApi';
import { can } from '../../../lib/rbac';
import { getAuthUser, unauthorized, forbidden } from '../fleetApi/auth';
import { createEntity, getEntity } from '../../../lib/domain';
import { alertToNotification } from '../../../lib/notifications';
import { normalizePlate, validateVehicleFields } from '../../../lib/vehicle';

/**
 * Deja la placa del body en su forma canónica (mayúsculas; Chile con guion: ZZBC-11)
 * antes de validar y guardar, para que `zzbc11` y `ZZBC-11` sean la misma placa.
 */
function normalizeVehicleBody(body: unknown): unknown {
  if (body && typeof body === 'object' && typeof (body as { plate?: unknown }).plate === 'string') {
    const b = body as { plate: string };
    b.plate = normalizePlate(b.plate);
  }
  return body;
}

export const prerender = false;

export const GET: APIRoute = async ({ params, request, locals }) => {
  const entity = params.entity as string;
  if (!validateEntity(entity)) return bad(`Invalid entity: ${entity}`);
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, entity, 'read')) return forbidden(`Rol ${user.role} no puede leer ${entity}`);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);
  if (id) return handleGet(entity, id, instanceId);
  return handleList(entity, instanceId);
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const entity = params.entity as string;
  if (!validateEntity(entity)) return bad(`Invalid entity: ${entity}`);
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, entity, 'create')) return forbidden(`Rol ${user.role} no puede crear ${entity}`);

  // Soporte para HTML forms (POST con _method=DELETE en form data)
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const override = formData.get('_method');
    const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);

    if (override === 'DELETE') {
      if (!can(user.role, entity, 'delete')) return forbidden(`Rol ${user.role} no puede borrar ${entity}`);
      const url = new URL(request.url);
      const id = url.searchParams.get('id') || (formData.get('id') as string);
      if (!id) return bad('Missing id');
      const result = await handleDelete(entity, id, instanceId);
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/fleet/${entity}s?instanceId=${instanceId}&deleted=${id}`,
        },
      });
    }
    // Fallback: form-as-JSON for POST
    const jsonBody: Record<string, unknown> = {};
    formData.forEach((v, k) => { jsonBody[k] = v; });
    return handleCreate(entity, jsonBody, instanceId);
  }

  // JSON body (default)
  const body = await request.json().catch(() => null);
  const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);
  if (entity === 'vehicle') normalizeVehicleBody(body);
  // Validación VIN/placa P1 (feat-vehicle-validators): rechaza creates inválidos con 400.
  if (entity === 'vehicle') {
    const v = validateVehicleFields((body ?? {}) as any);
    if (!v.ok) return bad(`Vehículo inválido: ${v.errors.join('; ')}`);
  }
  const created = await handleCreate(entity, body, instanceId);
  // Fan-out P1.2 (#917): toda alerta creada genera su notificación (best-effort, nunca rompe el create).
  if (entity === 'alert' && created.status >= 200 && created.status < 300) {
    try {
      await createEntity('notification', alertToNotification((body ?? {}) as any), instanceId);
    } catch {
      // best-effort: ignorar fallo de fan-out
    }
  }
  return created;
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const entity = params.entity as string;
  if (!validateEntity(entity)) return bad(`Invalid entity: ${entity}`);
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, entity, 'update')) return forbidden(`Rol ${user.role} no puede actualizar ${entity}`);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return bad('Missing id');
  const body = await request.json().catch(() => null);
  const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);
  if (entity === 'vehicle') normalizeVehicleBody(body);
  // Validación VIN/placa sobre el registro fusionado (PATCH parcial permitido).
  if (entity === 'vehicle') {
    const current = (await getEntity(entity, id, instanceId).catch(() => null)) as any;
    const v = validateVehicleFields({ ...(current ?? {}), ...((body ?? {}) as object) });
    if (!v.ok) return bad(`Vehículo inválido: ${v.errors.join('; ')}`);
  }
  return handleUpdate(entity, id, body, instanceId);
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const entity = params.entity as string;
  if (!validateEntity(entity)) return bad(`Invalid entity: ${entity}`);
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, entity, 'delete')) return forbidden(`Rol ${user.role} no puede borrar ${entity}`);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return bad('Missing id');
  const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);
  return handleDelete(entity, id, instanceId);
};
