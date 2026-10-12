/**
 * ai.ts — Llamada a Workers AI para el asistente, con respaldo y streaming normalizado.
 *
 * Modelos (cuenta en plan Workers Free, verificado el 2026-10-02 contra la API de
 * modelos y con una consulta de mecanica real):
 *   1. @cf/openai/gpt-oss-120b — la respuesta mas precisa de los disponibles en el plan
 *      gratuito; razona antes de contestar (~60 neuronas por consulta corta).
 *   2. @cf/meta/llama-4-scout-17b-16e-instruct — respaldo si el primero falla o se agota
 *      la cuota diaria (10 000 neuronas) del modelo grande.
 * Los modelos de 1M de contexto (glm-5.3, deepseek-v4) exigen el plan pago de Workers.
 *
 * Los dos emiten SSE estilo OpenAI (`choices[0].delta.content`; gpt-oss manda antes
 * `delta.reasoning`). normalizeAiStream() lo convierte en un SSE propio y estable para el
 * navegador: `{"t": "..."}` por cada trozo de texto, `{"thinking": true}` una vez mientras
 * el modelo razona, y `{"done": true, "model": "..."}` al final.
 */

export const ASSISTANT_MODELS = ['@cf/openai/gpt-oss-120b', '@cf/meta/llama-4-scout-17b-16e-instruct'] as const;

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface AssistantRun {
  stream: ReadableStream<Uint8Array>;
  model: string;
}

const encoder = new TextEncoder();
const sse = (obj: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

/** Texto de un evento de Workers AI (formato OpenAI o el viejo `{response}`). */
export function deltaOf(event: unknown): { text?: string; thinking?: boolean } {
  if (!event || typeof event !== 'object') return {};
  const e = event as { response?: unknown; choices?: { delta?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown } }[] };
  const delta = e.choices?.[0]?.delta;
  if (delta) {
    if (typeof delta.content === 'string' && delta.content) return { text: delta.content };
    if (delta.reasoning || delta.reasoning_content) return { thinking: true };
    return {};
  }
  if (typeof e.response === 'string' && e.response) return { text: e.response };
  return {};
}

/** Convierte el SSE de Workers AI en el SSE del asistente (ver cabecera). */
export function normalizeAiStream(src: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  let announcedThinking = false;
  let sawText = false;
  const reader = src.getReader();

  const handleLine = (line: string, out: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    const d = deltaOf(event);
    if (d.text) {
      sawText = true;
      out.enqueue(sse({ t: d.text }));
    } else if (d.thinking && !announcedThinking && !sawText) {
      announcedThinking = true;
      out.enqueue(sse({ thinking: true }));
    }
  };

  return new ReadableStream<Uint8Array>({
    // Se lee hasta emitir algo o terminar: un pull que vuelve sin encolar no se repite
    // solo, y un trozo de red sin una linea completa dejaba el stream colgado.
    async pull(controller) {
      const before = controller.desiredSize;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          if (buffer.trim()) handleLine(buffer.trim(), controller);
          controller.enqueue(sse(sawText ? { done: true, model } : { error: 'El modelo no devolvio texto', model }));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          handleLine(buffer.slice(0, nl).trim(), controller);
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
        }
        if (controller.desiredSize !== before) return;
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}

/** SSE de una respuesta ya completa (cuando el binding no devuelve stream). */
function singleShot(text: string, model: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sse({ t: text }));
      controller.enqueue(sse({ done: true, model }));
      controller.close();
    },
  });
}

function textOf(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  if (typeof r.response === 'string') return r.response;
  const c = r.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : undefined;
}

/**
 * Corre el asistente con el primer modelo que responda. Lanza el ultimo error si
 * ninguno responde (la ruta lo traduce a 503 con un mensaje para el usuario).
 */
export async function runAssistant(
  ai: AiBinding,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  models: readonly string[] = ASSISTANT_MODELS,
): Promise<AssistantRun> {
  let lastError: unknown;
  for (const model of models) {
    try {
      const input: Record<string, unknown> = { messages, max_tokens: 1800, stream: true };
      if (model.includes('gpt-oss')) input.reasoning = { effort: 'low' };
      const result = await ai.run(model, input);
      if (result instanceof ReadableStream) return { stream: normalizeAiStream(result as ReadableStream<Uint8Array>, model), model };
      const text = textOf(result);
      if (text) return { stream: singleShot(text, model), model };
      lastError = new Error(`respuesta vacia de ${model}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Workers AI no respondio');
}
