/**
 * GET /api/mesh/room-key — Sala y clave de la replica de telemetria del tenant de la sesion.
 *
 * Por que existe: la telemetria en vivo (LiveChart) se replica entre dispositivos por edge-mesh
 * (PeerJS). Los instanceId son adivinables (p. ej. `demo-obras`) y cualquier nodo puede firmar
 * con su propia clave, asi que "conocer el instanceId" no puede ser lo que da acceso a la sala.
 * Ahora la sala se llama `telemetry/<roomId>` con un roomId derivado de un secreto del servidor,
 * y todo payload viaja cifrado con AES-256-GCM bajo una clave que solo este endpoint entrega.
 *
 * Contrato:
 * - Exige sesion (invitado o sin cookie -> 401). El middleware ya lo exige para /api/*; aqui se
 *   repite (defensa en profundidad) porque este endpoint reparte secretos.
 * - El tenant sale SIEMPRE de la sesion (locals.tenant / sesion KV). Ningun query param,
 *   cabecera ni cuerpo puede elegir otro instanceId: `?instanceId=` se ignora.
 * - Respuesta: { ok, roomId, epoch, key, previous: { epoch, key }, rotatesAt }. `key` es AES-256
 *   en base64url; `previous` permite al cliente descifrar mensajes de la epoca anterior durante
 *   el relevo. Epoca semanal (ver _roomKey.ts). `Cache-Control: no-store`.
 *
 * Derivacion (HKDF-SHA256, ver _roomKey.ts):
 *   roomId = HKDF(secret, info = 'gara-mesh-room-id/v1|<instanceId>')
 *   key    = HKDF(secret, salt = epoca, info = 'gara-mesh-room-key/v1|<instanceId>')
 *
 * SECRETO (binding del Worker): MESH_ROOM_SECRET. Hay que crearlo ANTES del primer despliegue:
 *     openssl rand -base64 48 | wrangler secret put MESH_ROOM_SECRET
 *   - Fuera de dev explicito (ver garage/devEnvironment.ts) sin secreto, o con menos de 32 caracteres,
 *     el endpoint responde 503 y la grafica queda en modo local: nunca cae a una sala sin cifrar.
 *   - En dev explicito usa un secreto de desarrollo PUBLICADO en el repo (no protege nada).
 *   - Rotarlo cambia todas las salas y claves: los dispositivos abiertos pierden la malla hasta
 *     recargar. El build no puede comprobar secretos; es un paso manual del despliegue.
 *   - Los tipos del binding estan en src/env.d.ts (Cloudflare.Env).
 *
 * Limite conocido: solo los administradores (propietarios) del tenant reciben la clave; operadores y observadores obtienen 403; quien la tuvo
 * conserva acceso hasta que pasan dos epocas, y el roomId no rota con la epoca.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sessionInstanceId } from '../../../garage/domain/tenant';
import { isExplicitDev } from '../../../garage/devEnvironment';
import { getAuthUser } from '../fleetApi/auth';
import { DEV_MESH_ROOM_SECRET, MIN_SECRET_LENGTH, deriveRoomKeys } from './_roomKey';
import { isRoomOwner } from './_roomOwner';

export const prerender = false;

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

/** `null` = no hay secreto utilizable. Fuera de dev explicito: >= 32 caracteres y distinto del de dev. */
function resolveSecret(): string | null {
  const configured = (env as unknown as { MESH_ROOM_SECRET?: unknown }).MESH_ROOM_SECRET;
  if (!isExplicitDev()) {
    return typeof configured === 'string' && configured.length >= MIN_SECRET_LENGTH && configured !== DEV_MESH_ROOM_SECRET
      ? configured
      : null;
  }
  return typeof configured === 'string' && configured.length > 0 ? configured : DEV_MESH_ROOM_SECRET;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return reply(401, { ok: false, error: 'No autenticado' });

  // Solo el tenant de la sesion: sin default silencioso, y la URL no se mira.
  const instanceId = sessionInstanceId(locals) ?? (user.instanceId || undefined);
  if (!instanceId) return reply(401, { ok: false, error: 'Sesion sin tenant' });

  if (!isRoomOwner(user)) return reply(403, { ok: false, error: 'Solo el propietario de la sala recibe la clave' });

  const secret = resolveSecret();
  if (!secret) return reply(503, { ok: false, error: 'Malla cifrada no configurada' });

  const keys = await deriveRoomKeys(secret, instanceId);
  return reply(200, { ok: true, ...keys });
};
