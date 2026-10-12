/**
 * src/pages/api/auth/login.ts — Login con usuario/contraseña → sesión en KV SESSION.
 *
 * POST /api/auth/login
 * Body: { "email": string, "password": string }
 * Response: { "ok": true, "token": string, "role": string } | { "ok": false, "error": string }
 *
 * Backend: solo D1 (src/lib/authenticate.ts). Se busca el usuario activo en la tabla
 * `entity` (entity='user') del tenant y se verifica el password con PBKDF2. No hay usuarios
 * de demostracion: sin usuario en D1 la respuesta es 401 "Credenciales inválidas".
 *
 * KV SESSION format (inmutable): `token:{uuid}` → JSON({ userId, email, role, exp })
 * TTL: 7 días. Cookie `session` HttpOnly Secure SameSite=Strict Max-Age=7d.
 */
import type { APIRoute } from 'astro';
import { SESSION_TTL, authenticate } from '../../../lib/authenticate';
// Web Crypto global (no node:crypto — rompe en workerd). Token via crypto.randomUUID().
import { hashPassword } from '../../../lib/password';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const instanceId = new URL(request.url).searchParams.get('instanceId') ?? undefined;
    const result = await authenticate(body.email ?? '', body.password ?? '', instanceId);

    if (!result.ok || !result.token) {
      return jsonResponse({ ok: false, error: result.error }, result.status);
    }

    const response = jsonResponse({ ok: true, token: result.token, role: result.role }, 200);
    response.headers.set(
      'Set-Cookie',
      `session=${result.token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}; Path=/`,
    );
    return response;
  } catch (err) {
    // El detalle va al log, nunca a la respuesta: `err.message` devolvia cosas
    // como `D1_ERROR: no such table: entity: SQLITE_ERROR`, que encendia el
    // esquema y el motor de la base de datos a cualquiera que llame al login.
    console.error('[login error]', err);
    return jsonResponse({ ok: false, error: 'Error interno' }, 500);
  }
};

// Re-exportamos hashPassword por si otros endpoints quieren crear passwords
// (e.g. /api/auth/register). No se usa aquí directamente.
export { hashPassword };
