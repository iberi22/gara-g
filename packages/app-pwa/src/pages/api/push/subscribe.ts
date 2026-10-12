/**
 * /api/push/subscribe.ts — Stub de suscripción Web Push (P1.2, issue #917).
 *
 * Persiste la subscription como entity `notification`-like? NO: las push
 * subscriptions viven en KV/D1 solo cuando hay VAPID configurado. Sin
 * VAPID_* en env responde 501 (graceful off) para no romper el frontend.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const vapidPublic = (locals as any)?.runtime?.env?.VAPID_PUBLIC_KEY
    ?? (globalThis as any)?.process?.env?.VAPID_PUBLIC_KEY;
  if (!vapidPublic) {
    return new Response(
      JSON.stringify({ error: 'Web Push no configurado (falta VAPID_PUBLIC_KEY)' }),
      { status: 501, headers: { 'content-type': 'application/json' } },
    );
  }
  const sub: any = await request.json().catch(() => null);
  if (!sub?.endpoint) {
    return new Response(JSON.stringify({ error: 'Missing subscription endpoint' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true, stored: false }), {
    headers: { 'content-type': 'application/json' },
  });
};
