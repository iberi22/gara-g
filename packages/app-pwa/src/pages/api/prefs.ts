/**
 * GET/PUT /api/prefs — Preferencias de interfaz del usuario de la sesion.
 *
 * GET devuelve { prefs } resueltas contra el esquema (defaults si nunca guardo nada).
 * PUT recibe { prefs }, las valida y las guarda; si quedan con onboarded=true, fija la
 * cookie que le dice al middleware que no vuelva a mandar al usuario al onboarding.
 * Las preferencias son de interfaz, no permisos: cualquier rol puede guardar las suyas.
 */
import type { APIRoute } from 'astro';
import { instanceIdFor } from '../../garage/domain/tenant';
import { bad, json } from '../../lib/fleetApi';
import { loadUserPrefs, MAX_PREFS_BYTES, onboardedCookie, saveUserPrefs } from '../../lib/prefs.server';
import { getAuthUser, unauthorized } from './fleetApi/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  const prefs = await loadUserPrefs(user.userId, instanceIdFor(request, locals));
  return json({ ok: true, prefs });
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const raw = await request.text();
  if (raw.length > MAX_PREFS_BYTES) return bad('Preferencias demasiado grandes', 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad('JSON invalido');
  }
  const input = body && typeof body === 'object' ? (body as { prefs?: unknown }).prefs : undefined;
  if (!input || typeof input !== 'object') return bad('Falta prefs');

  const prefs = await saveUserPrefs(user.userId, instanceIdFor(request, locals), input);
  const res = json({ ok: true, prefs });
  if (prefs.onboarded) res.headers.append('Set-Cookie', onboardedCookie(user.userId, new URL(request.url).protocol === 'https:'));
  return res;
};
