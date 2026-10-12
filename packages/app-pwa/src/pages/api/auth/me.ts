/**
 * src/pages/api/auth/me.ts — Devuelve el usuario actual desde KV SESSION.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ request }) => {
  const cookies = Object.fromEntries(
    request.headers.get('cookie')?.split(';').map(c => c.trim().split('=')) ?? []
  );
  const token = cookies['session'];

  if (!token) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
  if (!kv) {
    return new Response(JSON.stringify({ authenticated: false, error: 'KV unavailable' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionRaw = await kv.get(`token:${token}`);
  if (!sessionRaw) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = JSON.parse(sessionRaw) as { userId: string; email: string; role: string; exp: number };

  if (Date.now() > session.exp) {
    await kv.delete(`token:${token}`);
    return new Response(JSON.stringify({ authenticated: false, error: 'Session expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    authenticated: true,
    user: { userId: session.userId, email: session.email, role: session.role },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
