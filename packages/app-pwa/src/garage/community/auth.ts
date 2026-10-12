/**
 * auth.ts — Puente entre las rutas de comunidad y la sesion.
 *
 * Vive dentro de la isla de comunidad en vez de en `src/lib/` porque hace dos cosas
 * que son de esta isla: decide si la peticion puede tocar el foro/wiki, y calcula el
 * pseudonimo del autor. `getAuthUser` (src/pages/api/fleetApi/auth.ts) es la pieza
 * compartida de la que esto depende y que no se toca.
 *
 * Orden de las comprobaciones en las rutas: sesion (401) -> versionKey valida
 * (400) -> cuerpo valido (400) -> ritmo (429) -> regla de negocio (403/404/409).
 * Asi un usuario sin sesion no puede ni siquiera medir el ritmo de otro autor.
 *
 * `requireUser` LANZA en vez de devolver un `Response | AuthUser`: asi el `user`
 * queda estrechado a `AuthUser` para el resto del handler, y el `catch` exterior
 * (que llama a `errorResponse`) convierte el 401 y los errores de negocio en su
 * respuesta HTTP. Devolver un `Response | AuthUser` obligaria a repetir el
 * `if (guard instanceof Response)` en las seis rutas sin estrechar el `user`.
 */
import { type AuthUser, getAuthUser, unauthorized } from '../../pages/api/fleetApi/auth';
import { CommunityError } from './errors';
import { type AuthorPseudonym, pseudonymFor } from './identity';

/** Rol que puede moderar el foro (fijar, cerrar, borrar). El resto no toca. */
export const MODERATOR_ROLE = 'admin';

/**
 * Sesion o 401. Lanza `CommunityError(401)`, que `errorResponse` traduce a su
 * respuesta JSON.
 */
export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new CommunityError('No autenticado', 401);
  return user;
}

/** Sesion leida de la peticion, o 401. Igual que `requireUser(await getAuthUser(req))`. */
export async function userFrom(request: Request): Promise<AuthUser> {
  return requireUser(await getAuthUser(request));
}

/** `true` si el usuario es de la sesion puede moderar. */
export function isModerator(user: AuthUser): boolean {
  return user.role === MODERATOR_ROLE;
}

/**
 * Pseudonimo del autor de una fila del foro/wiki: alias estable derivado del
 * userId con el secreto de la comunidad. Lo que sale de aqui es lo unico que se
 * guarda; el userId y el correo se quedan en la sesion.
 */
export function authorFor(user: AuthUser): Promise<AuthorPseudonym> {
  return pseudonymFor(user.userId);
}

/** 401 si no hay sesion, con el mensaje por defecto de la casa. */
export function unauthorizedResponse(): Response {
  return unauthorized();
}

/** Respuesta JSON con codigo arbitrario; el cuerpo siempre lleva `ok:false` + `error`. */
export function fail(
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ ok: false, error: message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Respuesta JSON 200 con `ok:true` y los datos del recurso. */
export function ok(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
