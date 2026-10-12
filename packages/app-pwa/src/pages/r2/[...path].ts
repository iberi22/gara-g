import { env } from 'cloudflare:workers';
/**
 * src/pages/r2/[...path].ts — Sirve archivos del bucket privado (R2).
 *
 * GET /r2/{tenant}/{clave} → R2 get({key})
 * GET /r2/{tenant}/{clave}?inline=1 → el navegador lo muestra en vez de bajarlo
 *
 * Este bucket es el vault de documentos: SOAT, tecnoMecánica, pólizas. Son PII
 * de conductores y vehículos, y hasta el 2026-10-01 esta ruta era pública con
 * `Cache-Control: public, max-age=31536000, immutable` y
 * `Access-Control-Allow-Origin: *`. Eso dejaba un documento borrado vivo un año
 * en el edge del navegador, y cualquiera que se enterara de la clave (por un CSV
 * exportado, un log o un Referer) lo descargaba sin sesión.
 *
 * Tres cambios:
 *   1. Requiere sesión. Sale de PUBLIC_PATHS (ver src/middleware.ts).
 *   2. Exige que la clave empiece por el tenant de la sesión. Sin eso, un
 *      usuario autenticado de un solo tenant podía leer los de todos.
 *   3. Cabeceras privadas, con `nosniff`, y sin CORS abierto.
 *
 * Lo de `?inline=1` no abre nada de eso: solo cambia la disposición a `inline`
 * y solo para PDF e imágenes, los dos tipos que el navegador puede mostrar sin
 * ejecutar nada del bucket. `attachment` + `no-store` siguen siendo el defecto.
 */
import type { APIRoute } from 'astro';
import { getSessionUser } from '../../lib/session';

/** Tipos que el navegador puede pintar sin ejecutar contenido activo. */
const INLINE_TYPES = (contentType: string): boolean =>
  contentType === 'application/pdf' || contentType.startsWith('image/');

/** Nombre para la cabecera: metadato original, si lo hay; si no, el final de la clave. */
function displayName(object: R2ObjectBody, key: string): string {
  const raw = object.customMetadata?.originalName || key.split('/').pop() || 'documento';
  // Sin comillas ni saltos de línea: va dentro de una cabecera HTTP.
  return raw.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}

export const GET: APIRoute = async ({ params, cookies, locals, url }) => {
  const key = params.path;

  if (!key) return notFound();

  // --- Sesión ---------------------------------------------------------------
  const token = cookies.get('session')?.value ?? '';
  const user = token ? await getSessionUser(token) : null;
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Aislamiento por tenant ------------------------------------------------
  // La sesión es la única fuente del tenant: nunca del `instanceId` de la query,
  // que el cliente controla.
  const tenant = (locals as { tenant?: { instanceId?: string } } | undefined)?.tenant?.instanceId;
  if (!tenant) {
    return new Response(JSON.stringify({ ok: false, error: 'Sesion sin tenant' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!key.startsWith(`${tenant}/`)) {
    // 404 y no 403: confirmar que la clave existe de otro tenant ya es filtrar.
    return notFound();
  }

  const r2 = (env as unknown as { SWAL_R2?: R2Bucket }).SWAL_R2;
  if (!r2) {
    return new Response(JSON.stringify({ ok: false, error: 'Almacenamiento no disponible' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let object: R2ObjectBody | null = null;
  try {
    object = await r2.get(key);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Almacenamiento no disponible' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!object) return notFound();

  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
  // `?inline=1` solo vale para lo que el navegador puede mostrar sin ejecutar
  // nada; para el resto se cae al `attachment` de siempre, que es lo que
  // impide que un documento se ejecute o se incruste desde su propia URL.
  const inline = url.searchParams.get('inline') === '1' && INLINE_TYPES(contentType);

  const headers = new Headers({
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': inline ? `inline; filename="${displayName(object, key)}"` : 'attachment',
  });
  if (inline) {
    // Un documento embebido puede vivir en el edge: cinco minutos y privado, en vez
    // del no-store del resto. Las imagenes van enjauladas; los PDF no, porque Chrome
    // se niega a abrir su visor de PDF en un documento con CSP `sandbox` (pinta
    // "bloqueado") y ver el manual dentro del expediente es justo el caso de uso.
    // El visor de PDF corre en su propio origen, no en el de la app.
    headers.set('Cache-Control', 'private, max-age=300');
    if (contentType !== 'application/pdf') headers.set('Content-Security-Policy', 'sandbox');
  } else {
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  }
  if (object.size) headers.set('Content-Length', String(object.size));
  if (object.etag) headers.set('ETag', object.etag);

  return new Response(object.body, { status: 200, headers });
};

function notFound(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
