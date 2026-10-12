/**
 * src/lib/auth.ts — Helper de autenticación para endpoints protegidos.
 *
 * Extrae el token de la cookie `session` y valida contra KV SESSION.
 * Retorna { user, token } si válido, o null si no autenticado.
 */
import { env } from 'cloudflare:workers';

export interface AuthUser {
  userId: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

export async function authenticate(request: { headers: { get: (name: string) => string | null } }): Promise<AuthResult | null> {
  const cookies = Object.fromEntries(
    request.headers.get('cookie')?.split(';').map((c: string) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    }) ?? []
  );
  const token = cookies['session'];
  if (!token) return null;

  const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
  if (!kv) return null;

  const raw = await kv.get(`token:${token}`);
  if (!raw) return null;

  const session = JSON.parse(raw) as { userId: string; email: string; role: string; exp: number };
  if (Date.now() > session.exp) {
    await kv.delete(`token:${token}`);
    return null;
  }

  return { user: session as AuthUser, token };
}

export function unauthorized(message = 'No autenticado') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
