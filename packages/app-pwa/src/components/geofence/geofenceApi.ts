/**
 * geofenceApi.ts — Persistencia de GeofenceMap contra /api/fleet/geofence.
 *
 * La isla editaba la lista en memoria y nunca llegaba al servidor: al recargar, la geocerca
 * "creada" o "borrada" volvia como estaba. Aqui vive el unico camino de escritura del
 * componente, el mismo endpoint que usa la tabla y EntityForm.
 *
 * El tenant lo decide el servidor desde la sesion (resolveInstanceId); `instanceId` solo se
 * manda para que en desarrollo sin sesion apunte al mismo tenant que pinto la pagina.
 */
import {
  formatPolygonString,
  parsePolygonString,
  type Geofence,
  type GeofencePoint,
  type GeofenceType,
} from '../../lib/geofence.js';

export const GEOFENCE_API = '/api/fleet/geofence';

export interface GeofenceInput {
  fleetId: string;
  name: string;
  type: GeofenceType;
  vertices: GeofencePoint[];
  alertOnEnter: boolean;
  alertOnExit: boolean;
}

type FetchFn = typeof fetch;

/** Registro de la entidad (polygon como texto) -> Geofence de la UI. */
export function geofenceFromRecord(r: any, fallbackFleetId = 'fleet-default'): Geofence {
  return {
    id: String(r.id),
    fleetId: r.fleetId || fallbackFleetId,
    name: r.name || 'Sin nombre',
    type: r.type || 'custom',
    alertOnEnter: typeof r.alertOnEnter === 'boolean' ? r.alertOnEnter : true,
    alertOnExit: typeof r.alertOnExit === 'boolean' ? r.alertOnExit : true,
    vertices: Array.isArray(r.vertices) ? r.vertices : parsePolygonString(r.polygon || ''),
    createdAt: r.createdAt || Date.now(),
    updatedAt: r.updatedAt || Date.now(),
  };
}

/** Geofence de la UI -> cuerpo de la entidad `geofence` (campos de domain.config.ts). */
export function geofenceToBody(g: GeofenceInput): Record<string, unknown> {
  return {
    name: g.name,
    fleetId: g.fleetId,
    type: g.type,
    polygon: formatPolygonString(g.vertices),
    alertOnEnter: g.alertOnEnter,
    alertOnExit: g.alertOnExit,
  };
}

function url(instanceId: string, id?: string): string {
  const q = new URLSearchParams();
  if (id) q.set('id', id);
  q.set('instanceId', instanceId);
  return `${GEOFENCE_API}?${q.toString()}`;
}

async function failure(res: Response, what: string): Promise<Error> {
  let detail = '';
  try {
    detail = String(((await res.json()) as { error?: unknown })?.error ?? '');
  } catch {
    /* cuerpo no JSON */
  }
  if (res.status === 401) return new Error(`${what}: la sesion expiro, vuelve a iniciar sesion.`);
  if (res.status === 403) return new Error(`${what}: tu rol no tiene permiso para esta accion.`);
  return new Error(`${what}: ${detail || `el servidor respondio ${res.status}`}.`);
}

export async function createGeofenceRemote(
  input: GeofenceInput,
  instanceId: string,
  fetchFn: FetchFn = fetch,
): Promise<Geofence> {
  const res = await fetchFn(url(instanceId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(geofenceToBody(input)),
  });
  if (!res.ok) throw await failure(res, 'No se pudo crear la geocerca');
  const { data } = (await res.json()) as { data: any };
  return geofenceFromRecord(data, input.fleetId);
}

export async function updateGeofenceRemote(
  id: string,
  input: GeofenceInput,
  instanceId: string,
  fetchFn: FetchFn = fetch,
): Promise<Geofence> {
  const res = await fetchFn(url(instanceId, id), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(geofenceToBody(input)),
  });
  if (!res.ok) throw await failure(res, 'No se pudo guardar la geocerca');
  const { data } = (await res.json()) as { data: any };
  return geofenceFromRecord(data, input.fleetId);
}

export async function deleteGeofenceRemote(
  id: string,
  instanceId: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const res = await fetchFn(url(instanceId, id), { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'No se pudo eliminar la geocerca');
}
