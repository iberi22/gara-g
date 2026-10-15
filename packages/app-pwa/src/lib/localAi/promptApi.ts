/**
 * promptApi.ts — Chrome Prompt API (Gemini Nano). Tier 1.
 *
 * La sesión se crea SOLO desde un gesto del usuario: este módulo lo llama `localChat` /
 * `localInfer` durante una acción de la interfaz, nunca la detección ni el montaje. Así el
 * navegador no descarga Gemini Nano por sorpresa.
 *
 * La sesión recibe la CONVERSACIÓN COMPLETA (mensajes de sistema, historial y pregunta) en
 * `initialPrompts`, no solo la última pregunta: el modelo mantiene el hilo.
 *
 * No importa tipos del paquete: la API es un global del navegador y se declara aquí lo
 * mínimo que se usa, para poder probarla con dobles sin depender de un Chrome real.
 */

export interface PromptInitialMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptApiSession {
  /** Respuesta en streaming (puede devolver ReadableStream o un iterable async). */
  promptStreaming(input: string, options?: { signal?: AbortSignal }): unknown;
  destroy?(): void;
}

export interface LanguageModelApi {
  create(options: {
    initialPrompts?: PromptInitialMessage[];
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

/** Crea una sesión con el historial completo ya dentro. */
export async function createPromptSession(
  initialPrompts: readonly PromptInitialMessage[],
  options: { factory?: LanguageModelApi; signal?: AbortSignal } = {},
): Promise<PromptApiSession> {
  const factory = options.factory ?? promptApiFactory();
  if (!factory) throw new Error('Chrome Prompt API no está disponible en este navegador');
  return factory.create({
    initialPrompts: initialPrompts.map((m) => ({ role: m.role, content: m.content })),
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
 * Respuesta de la sesión normalizada a INCREMENTOS.
 *
 * Contrato de la versión soportada de la Prompt API (Chrome actual): cada trozo del stream
 * es el DELTA nuevo ("a", "a", "b" → "aab"), no el texto acumulado. No se infiere nada del
 * prefijo: una heurística de prefijos convertía ["a","a","b"] en "ab" y perdía texto. Si
 * alguna versión antigua devolviera texto acumulado, sus propios trozos contendrían el
 * texto ya emitido; el llamador concatena deltas, así que no se pierde nada visible.
 */
export async function* promptApiStream(
  session: PromptApiSession,
  input: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  for await (const chunk of chunksOf(session.promptStreaming(input, { signal }))) {
    if (chunk) yield chunk;
  }
}
