/**
 * src/pages/api/xavier/add.ts — escribe en la memoria de agentes desde el servidor.
 *
 * Complemento de search.ts: cada CRUD de dominio (src/lib/agentDomain.ts) deja un
 * rastro recuperable por el agente sin que el navegador tenga que alcanzar a Xavier.
 *
 * Endurecido el 2026-10-01, por tres motivos:
 *   1. Exige rol `admin`. Cualquiera autenticado podía escribir memorias que
 *      después leerían otros agentes: inyección de prompts persistente.
 *   2. El cuerpo lo construye el servidor. Antes se reenviaba el JSON del
 *      cliente tal cual, así que el `path` y el `kind` los elegía quien llamara.
 *   3. El namespace lo fija el servidor (`project: 'gara-g'`). No es una
 *      entrada de memoria, es el namespace obligatorio del que solo sale.
 */
import type { APIRoute } from 'astro';
import { callXavier, jsonResponse, readBody, requireAdmin, requireSession } from './_proxy';

export const prerender = false;

/** Lo único que el cliente decide: qué quiere registrar. */
const MAX_CONTENT_CHARS = 8_000;

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await requireSession(cookies);
  if (user instanceof Response) return user;

  const denied = requireAdmin(user);
  if (denied) return denied;

  const raw = (await readBody(request)) || '{}';
  let parsed: { text?: unknown; kind?: unknown; tags?: unknown; project?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return jsonResponse({ ok: false, error: 'Cuerpo JSON invalido' }, 400);
  }

  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) return jsonResponse({ ok: false, error: 'Falta text' }, 400);
  if (text.length > MAX_CONTENT_CHARS) {
    return jsonResponse({ ok: false, error: 'text excede el limite' }, 413);
  }

  const kind = typeof parsed.kind === 'string' ? parsed.kind.slice(0, 40) : 'gara-g';
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 12).map((t) => t.slice(0, 40))
    : [];

  // Namespace fijo: el `project` del cliente se descarta, no se propaga.
  const body = JSON.stringify({
    text,
    kind,
    tags,
    project: 'gara-g',
    tenant: user.tenant ?? null,
    source: `gara-g:${user.email}`,
  });

  const result = await callXavier('/v1/memories', { method: 'POST', body });
  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
