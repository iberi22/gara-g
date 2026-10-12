/**
 * src/lib/rbac.ts — Role-Based Access Control para GARA-G PWA.
 *
 * Define los roles y un mapa de permisos por (role, entity, action).
 * Los endpoints REST (/api/fleet/[entity]) y las páginas /fleet/* consumen
 * este módulo para autorizar operaciones.
 *
 * Roles:
 *   - admin:    full CRUD en todas las entidades + gestión de usuarios
 *   - operator: CRUD parcial (vehicles, drivers, maintenance, fuelLogs, alerts, telemetry)
 *               + subida/lectura de documentos; SIN acceso a users
 *   - observer: read-only total (excepto users)
 *
 * Multi-tenant: el aislamiento por instanceId se aplica ANTES del check de rol
 * (en listEntities/getEntity). Aquí solo decidimos qué puede hacer el usuario
 * una vez pasada la barrera de tenancy.
 */

export type Role = 'admin' | 'operator' | 'observer';

export const ROLES: readonly Role[] = ['admin', 'operator', 'observer'] as const;

export type Action = 'create' | 'read' | 'update' | 'delete';

/** Todas las entidades que el RBAC conoce. Debe coincidir con domain.config.ts entities[].name. */
export const RBAC_ENTITIES = [
  'user',
  'vehicle',
  'driver',
  'maintenance',
  'fuelLog',
  'alert',
  'geofence',
  'document',
  'telemetry',
  'fleet',
  'notification',
  'stats',
] as const;
export type RbacEntity = (typeof RBAC_ENTITIES)[number];

/**
 * Alias de segmento de URL a entidad del RBAC.
 *
 * `/api/fleet/files` y `/api/fleet/upload` no son entidades: son dos rutas que
 * operan sobre 'document'. El middleware derivaba la entidad del segmento del
 * path y se la pasaba tal cual a `can()`, así que buscaba el par ('files',
 * 'create') y ('upload', 'create'), que no existen en PERMISSIONS: `can()`
 * devolvía false para TODO rol y la subida de documentos respondía 403
 * siempre. El 403 tampoco decía la verdad: el permiso sí existía, bajo otro
 * nombre.
 *
 * Solo se mapean segmentos que no son entidades. Cualquier otro se queda como
 * está, para que un endpoint nuevo sin mapear siga denegando por defecto.
 */
export const RBAC_PATH_ALIASES: Record<string, RbacEntity> = {
  files: 'document',
  upload: 'document',
};

/** Resuelve el segmento de `/api/fleet/<segment>` a la entidad que autoriza `can()`. */
export function rbacEntityFor(segment: string | null | undefined): string | null {
  if (!segment) return null;
  return RBAC_PATH_ALIASES[segment] ?? segment;
}

/**
 * Mapa PERMISSIONS[role][entity] = lista de actions permitidas.
 * Si un (role, entity) no aparece en el mapa, se considera sin permisos.
 */
export const PERMISSIONS: Record<Role, Record<string, Action[]>> = {
  admin: {
    user: ['create', 'read', 'update', 'delete'],
    vehicle: ['create', 'read', 'update', 'delete'],
    driver: ['create', 'read', 'update', 'delete'],
    maintenance: ['create', 'read', 'update', 'delete'],
    fuelLog: ['create', 'read', 'update', 'delete'],
    alert: ['create', 'read', 'update', 'delete'],
    geofence: ['create', 'read', 'update', 'delete'],
    document: ['create', 'read', 'update', 'delete'],
    telemetry: ['create', 'read', 'update', 'delete'],
    fleet: ['create', 'read', 'update', 'delete'],
    notification: ['create', 'read', 'update', 'delete'],
    stats: ['read'],
  },
  operator: {
    user: [],
    vehicle: ['create', 'read', 'update'],
    driver: ['create', 'read', 'update'],
    maintenance: ['create', 'read', 'update'],
    fuelLog: ['create', 'read', 'update'],
    alert: ['create', 'read', 'update'],
    geofence: ['read'],
    // El operador es quien sube las fotos del vehículo y las facturas del
    // conductor: sin 'create' no podía cargar ni un SOAT y el vault quedaba
    // limitado al admin. Sigue sin poder actualizar ni borrar documentos.
    document: ['create', 'read'],
    telemetry: ['create', 'read'],
    fleet: ['read'],
    notification: ['create', 'read', 'update'],
    stats: ['read'],
  },
  observer: {
    user: [],
    vehicle: ['read'],
    driver: ['read'],
    maintenance: ['read'],
    fuelLog: ['read'],
    alert: ['read'],
    geofence: ['read'],
    document: ['read'],
    telemetry: ['read'],
    fleet: ['read'],
    notification: ['read'],
    stats: ['read'],
  },
};

/**
 * can(role, entity, action) — true si el rol puede ejecutar la acción sobre la entidad.
 * Devuelve false para roles desconocidos o entidades no listadas.
 */
export function can(role: Role | string | undefined | null, entity: string, action: Action): boolean {
  if (!role) return false;
  const perms = (PERMISSIONS as Record<string, Record<string, Action[]>>)[role];
  if (!perms) return false;
  const list = perms[entity];
  if (!list) return false;
  return list.includes(action);
}

/** Normaliza un role arbitrario a Role (o devuelve null si no es válido). */
export function normalizeRole(value: unknown): Role | null {
  if (typeof value !== 'string') return null;
  if ((ROLES as readonly string[]).includes(value)) return value as Role;
  return null;
}
