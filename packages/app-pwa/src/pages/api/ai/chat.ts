/**
 * src/pages/api/ai/chat.ts — AI inference via Cloudflare Workers AI.
 *
 * POST /api/ai/chat
 * Body: { "messages": [{role, content}], "model": "@cf/meta/llama-3.1-70b-instruct" }
 * Response: { "response": string, "model": string }
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

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
    const body = await request.json() as {
      messages?: Array<{ role: string; content: string }>;
      model?: string;
    };
    const { messages, model = '@cf/meta/llama-3.1-70b-instruct' } = body ?? {};

    if (!messages?.length) {
      return jsonResponse({ error: 'messages requerido' }, 400);
    }

    const ai = (env as unknown as { AI?: { run: (model: string, options: unknown) => Promise<unknown> } }).AI;
    if (!ai) {
      return jsonResponse({ error: 'AI binding no disponible' }, 503);
    }

    const result = await ai.run(model, { messages }) as { response?: string };
    return jsonResponse({
      response: result.response ?? 'Sin respuesta del modelo',
      model,
    }, 200);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ai/chat] Error:', msg);
    return jsonResponse({ error: 'Error en inference', detail: msg }, 500);
  }
};
