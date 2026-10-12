/**
 * src/pages/api/xavier/search.ts — proxy server-side a la memoria de agentes.
 *
 * El cliente NUNCA habla con Xavier directamente: lo haría contra localhost:8006
 * desde el navegador. Este endpoint corre en el Worker, que sí alcanza a Xavier.
 *
 * Endurecido el 2026-10-01: exige sesión y construye la consulta en el servidor.
 * Antes reenviaba el cuerpo del cliente sin tocar, así que una búsqueda pedía
 * sobre toda la memoria del ecosistema (que no está filtrada por proyecto ni por
 * tenant) y con los filtros que el usuario eligiera.
 */
import type { APIRoute } from 'astro';
import { callXavier, jsonResponse, readBody, requireSession } from './_proxy';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await requireSession(cookies);
  if (user instanceof Response) return user;

  const raw = (await readBody(request)) || '{}';
  let parsed: { query?: unknown; limit?: unknown; kind?: unknown; project?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return jsonResponse({ ok: false, error: 'Cuerpo JSON invalido' }, 400);
  }

  const query = typeof parsed.query === 'string' ? parsed.query.trim().slice(0, 500) : '';
  if (!query) return jsonResponse({ ok: false, error: 'Falta query' }, 400);

  const limitRaw = typeof parsed.limit === 'number' ? parsed.limit : 10;
  const limit = Math.min(Math.max(1, Math.trunc(limitRaw)), 50);

  const body = JSON.stringify({
    query,
    limit,
    // Namespace fijo del servidor: el cliente no amplía el alcance de la búsqueda.
    project: 'gara-g',
  });

  const result = await callXavier('/v1/memories/search', { method: 'POST', body });
  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
