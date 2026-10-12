/**
 * src/pages/api/auth/logout.ts — Logout: elimina sesión de KV SESSION.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS });

export const POST: APIRoute = async ({ request }) => {
  const cookies = Object.fromEntries(
    request.headers.get('cookie')?.split(';').map(c => c.trim().split('=')) ?? []
  );
  const token = cookies['session'];

  if (token) {
    const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
    if (kv) await kv.delete(`token:${token}`);
  }

  const response = new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
  response.headers.set('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/');
  return response;
};
