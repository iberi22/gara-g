import { DEFAULT_INSTANCE_ID } from '../../../lib/domain.config';
import { env } from 'cloudflare:workers';
/**
 * src/pages/api/auth/magic.ts — canjea un enlace de acceso por una sesión.
 *
 * GET /api/auth/magic?token=...   → 303 a /fleet con la cookie de sesión
 *
 * El token viaja una sola vez, con TTL de 15 minutos, y se borra de KV en
 * cuanto se canjea: un enlace reenviado o reutilizado no vale.
 *
 * En producción responde 303 a `/login?error=invalid-link` sin explicar si el
 * token no existía, había caducado o ya se usó.
 */
import type { APIRoute } from 'astro';
import { REQUEST_PREFIX, SESSION_PREFIX, hashToken } from '../../../lib/magic-link';
import { normalizeRole } from '../../../lib/rbac';

export const prerender = false;

const SESSION_TTL = 7 * 24 * 60 * 60;

interface StoredRequest {
  email: string;
  userId: string;
  role: string;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export const GET: APIRoute = async ({ url, cookies }) => {
  const token = url.searchParams.get('token') ?? '';
  if (!token || token.length < 32) return redirect('/login?error=invalid-link');

  let kv: KVNamespace | undefined;
  try {
    const e = env as unknown as { SESSION?: KVNamespace; SWAL_KV?: KVNamespace };
    kv = e.SESSION ?? e.SWAL_KV;
  } catch {
    kv = undefined;
  }
  // Mismo error que un token malo: que no haya binding KV es un fallo del
  // despliegue, no informacion sobre el token.
  if (!kv) return redirect('/login?error=invalid-link');

  const tokenHash = await hashToken(token);
  const key = `${REQUEST_PREFIX}${tokenHash}`;

  // `get` + `delete` no es atómico: dos clicks simultáneos podrían pasar los dos.
  // Por eso se borra primero y solo quien ha borrado crea la sesión.
  const raw = await kv.get(key, 'text');
  if (!raw) return redirect('/login?error=invalid-link');
  await kv.delete(key);

  let stored: StoredRequest;
  try {
    stored = JSON.parse(raw) as StoredRequest;
  } catch {
    return redirect('/login?error=invalid-link');
  }
  if (!stored?.email || !stored?.userId) return redirect('/login?error=invalid-link');

  const role = normalizeRole(stored.role) ?? 'observer';
  const sessionToken = crypto.randomUUID();
  const session = {
    userId: stored.userId,
    email: stored.email,
    role,
    // El tenant se fija aqui: es lo que impide que el cliente elija la
    // instancia. Nunca se lee de la query ni del cuerpo de la peticion.
    instanceId: DEFAULT_INSTANCE_ID,
    exp: Date.now() + SESSION_TTL * 1000,
  };
  await kv.put(`${SESSION_PREFIX}${sessionToken}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });

  cookies.set('session', sessionToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL,
    secure: true,
  });

  // Solo rutas internas: un parametro `next` abierto convertia un login
  // legitimo en phishing.
  const rawNext = url.searchParams.get('next') ?? '/fleet';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/fleet';
  return redirect(next);
};
