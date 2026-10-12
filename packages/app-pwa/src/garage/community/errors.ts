/**
 * errors.ts — Errores de la comunidad (foro y wiki) con el codigo HTTP ya decidido.
 *
 * Por que: las reglas de negocio del foro/wiki (hilo cerrado, seccion de solo
 * lectura, conflicto de revision, limite de ritmo) son distintas en cada ruta y
 * cada una tiene su codigo. Si cada ruta tradujera `throw new Error`, el codigo
 * HTTP quedaria repartido por doce ficheros y easy de olvidar el 403 de la
 * wiki. Aqui el error nace con su status y `errorResponse()` lo convierte, de modo
 * que anadir una regla nueva es anadir un `CommunityError` y nada mas.
 *
 * Los mensajes van en espanol porque los ve un usuario final en el JSON de la API.
 */

export interface CommunityErrorDetails {
  /** Version actual de la seccion (wiki) o limite que se alcanzo (ritmo). */
  [key: string]: unknown;
}

export class CommunityError extends Error {
  readonly status: number;
  readonly details: CommunityErrorDetails;

  constructor(message: string, status = 400, details: CommunityErrorDetails = {}) {
    super(message);
    this.name = 'CommunityError';
    this.status = status;
    this.details = details;
  }
}

/** 401: la peticion no trae sesion valida. */
export function notAuthenticated(): CommunityError {
  return new CommunityError('No autenticado', 401);
}

/** 404 */
export function notFound(what: string): CommunityError {
  return new CommunityError(`${what} no encontrado`, 404);
}

/**
 * Convierte cualquier error en la respuesta JSON de la API.
 *
 * Un `CommunityError` conserva su status y sus detalles (p. ej. la revision
 * vigente que recibe el cliente en un 409). Cualquier otro fallo es un bug: se
 * registra en el log del isolate y se responde 500 con un mensaje generico, para
 * no filtrar rutas ni SQL al navegador.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof CommunityError) {
    return new Response(JSON.stringify({ ok: false, error: err.message, ...err.details }), {
      status: err.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  console.error('[comunidad] fallo no controlado:', err);
  return new Response(JSON.stringify({ ok: false, error: 'Error interno de la comunidad' }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}

/** Respuesta 429 con `Retry-After` en segundos (obligatorio para que el cliente espere). */
export function tooManyMessages(retryAfterSec: number, scope: 'short' | 'daily'): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error:
        scope === 'daily'
          ? 'Limite diario de mensajes alcanzado'
          : 'Vas muy rapido, espera un momento',
      retryAfter: retryAfterSec,
    }),
    {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': String(retryAfterSec) },
    },
  );
}
