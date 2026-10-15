/**
 * promptApi.ts — Chrome Prompt API (Gemini Nano). Tier 1.
 *
 * La sesión se crea SOLO desde un gesto del usuario: este módulo lo llama `localChat` /
 * `localInfer` durante una acción de la interfaz, nunca la detección ni el montaje. Así el
 * navegador no descarga Gemini Nano por sorpresa.
 *
 * No importa tipos del paquete: la API es un global del navegador y se declara aquí lo
 * mínimo que se usa, para poder probarla con dobles sin depender de un Chrome real.
 */

export interface PromptApiSession {
  /** Respuesta en streaming (puede devolver ReadableStream o un iterable async). */
  promptStreaming(input: string, options?: { signal?: AbortSignal }): unknown;
  destroy?(): void;
}

export interface LanguageModelApi {
  create(options: {
    initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
    signal?: AbortSignal;
  }): Promise<PromptApiSession>;
}

/** El global `LanguageModel` del navegador, si existe y sabe crear sesiones. */
export function promptApiFactory(
  scope: { LanguageModel?: LanguageModelApi } = globalThis as { LanguageModel?: LanguageModelApi },
): LanguageModelApi | undefined {
  const lm = scope.LanguageModel;
  return lm && typeof lm.create === 'function' ? lm : undefined;
}

export async function createPromptSession(
  systemPrompt: string,
  options: { factory?: LanguageModelApi; signal?: AbortSignal } = {},
): Promise<PromptApiSession> {
  const factory = options.factory ?? promptApiFactory();
  if (!factory) throw new Error('Chrome Prompt API no está disponible en este navegador');
  return factory.create({
    initialPrompts: [{ role: 'system', content: systemPrompt }],
    signal: options.signal,
  });
}

/** Convierte lo que devuelva `promptStreaming` (ReadableStream o iterable) en texto. */
export async function* chunksOf(value: unknown): AsyncGenerator<string> {
  if (!value) return;
  const decoder = new TextDecoder();
  const textOf = (part: unknown): string => {
    if (typeof part === 'string') return part;
    if (part instanceof Uint8Array) return decoder.decode(part, { stream: true });
    return '';
  };
  const iterable = value as AsyncIterable<unknown>;
  if (typeof iterable[Symbol.asyncIterator] === 'function') {
    for await (const chunk of iterable) {
      const text = textOf(chunk);
      if (text) yield text;
    }
    return;
  }
  const readable = value as ReadableStream<Uint8Array | string>;
  if (typeof readable.getReader === 'function') {
    const reader = readable.getReader();
    for (;;) {
      const { value: part, done } = await reader.read();
      if (done) break;
      const text = textOf(part);
      if (text) yield text;
    }
  }
}

/**
 * Respuesta de la sesión ya normalizada a INCREMENTOS: algunas versiones de Chrome
 * devolvían el texto acumulado ("a", "ab", "abc") y otras el trozo nuevo ("a", "b", "c").
 */
export async function* promptApiStream(
  session: PromptApiSession,
  input: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let emitted = '';
  for await (const chunk of chunksOf(session.promptStreaming(input, { signal }))) {
    let delta = chunk;
    if (chunk.startsWith(emitted)) {
      delta = chunk.slice(emitted.length);
      emitted = chunk;
    } else {
      emitted += chunk;
    }
    if (delta) yield delta;
  }
}
