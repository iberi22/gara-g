/**
 * index.ts — Punto único de la IA local del navegador (G3).
 *
 * - `localChat(messages, { onToken, signal, excerpts })`: asistente del expediente, en
 *   streaming, con la misma forma que el antiguo SSE para que la UI no cambie apenas.
 * - `localInfer(prompt, { system })`: generación de la AUI (devuelve una spec AuiSpec).
 *
 * Cadena de respaldo: Prompt API → WebGPU/WebLLM → reglas deterministas. Ninguna de las
 * dos funciones lanza hacia la interfaz: si un motor falla, se cae a las reglas. Tampoco
 * hay descargas implícitas: cargar el motor de WebGPU siempre es una acción del usuario.
 */
import { detectLocalAi, type AiTier } from './capabilities';
import { DEFAULT_LOCAL_MODEL } from './config';
import { createPromptSession, promptApiStream } from './promptApi';
import { RULES_MODEL, RULES_NEEDS_LOCAL_AI, rulesAnswer } from './rules';
import { loadWebllmEngine, webllmModelId, webllmStream } from './webllmEngine';
import type { ManualChunk } from '../../garage/assistant/manualText';

export type { AiTier } from './capabilities';
export { detectLocalAi, isLocalAiUsable, localAiEnvironment } from './capabilities';
export { RULES_LABEL, RULES_MODEL, RULES_NEEDS_LOCAL_AI, RULES_NO_MATCH } from './rules';

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalChatOptions {
  /** Fragmentos de manual ya elegidos por el navegador: base de la respuesta por reglas. */
  excerpts?: readonly ManualChunk[];
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
  /** Fuerza un nivel (p. ej. reglas mientras el usuario decide si descarga el modelo). */
  tier?: AiTier;
}

export interface LocalChatResult {
  via: AiTier;
  model: string;
  text: string;
  error?: string;
}

export interface LocalInferOptions {
  /** Prompt de sistema de la AUI (whitelist de componentes, contrato AuiSpec v1, ...). */
  system?: string;
  signal?: AbortSignal;
  tier?: AiTier;
}

export interface LocalInferResult {
  via: AiTier;
  model?: string;
  text?: string;
  /** JSON del modelo sin validar: `validateAui` (lib/aui.ts) aplica la whitelist. */
  spec?: unknown;
  error?: string;
}

const PROMPT_API_MODEL = 'gemini-nano';
const DEFAULT_AUI_SYSTEM = 'Responde SOLO con JSON válido de tipo AuiSpec version 1.';

function lastUser(messages: readonly LocalChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return messages[messages.length - 1]?.content ?? '';
}

function systemOf(messages: readonly LocalChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
}

/** Extrae el JSON de una respuesta aunque venga envuelta en ```json ... ```. */
function parseSpec(text: string): unknown | undefined {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Asistente del expediente con IA local y streaming. Nunca lanza: los fallos de motor caen
 * a las reglas, que responden con los fragmentos de manual ya elegidos.
 */
export async function localChat(
  messages: readonly LocalChatMessage[],
  options: LocalChatOptions = {},
): Promise<LocalChatResult> {
  const tier = options.tier ?? (await detectLocalAi());
  const question = lastUser(messages);
  let emitted = '';
  const emit = (chunk: string): void => {
    if (!chunk) return;
    emitted += chunk;
    options.onToken?.(chunk);
  };

  if (tier === 'prompt-api') {
    try {
      const session = await createPromptSession(systemOf(messages), { signal: options.signal });
      for await (const chunk of promptApiStream(session, question, options.signal)) emit(chunk);
      session.destroy?.();
      return { via: 'prompt-api', model: PROMPT_API_MODEL, text: emitted };
    } catch {
      if (options.signal?.aborted) return { via: 'prompt-api', model: PROMPT_API_MODEL, text: emitted };
    }
  }

  if (tier === 'webgpu') {
    try {
      const engine = await loadWebllmEngine();
      for await (const chunk of webllmStream(engine, [...messages], options.signal)) emit(chunk);
      return { via: 'webgpu', model: webllmModelId() ?? DEFAULT_LOCAL_MODEL, text: emitted };
    } catch {
      if (options.signal?.aborted) return { via: 'webgpu', model: webllmModelId() ?? DEFAULT_LOCAL_MODEL, text: emitted };
    }
  }

  const rules = rulesAnswer(question, options.excerpts ?? []);
  emit(emitted ? `\n\n${rules}` : rules);
  return { via: 'rules', model: RULES_MODEL, text: emitted };
}

/**
 * Generación de la AUI con IA local. Devuelve la spec sin validar (la valida `aui.ts`) o,
 * si el navegador solo tiene reglas, un mensaje claro en español. Nunca lanza.
 */
export async function localInfer(prompt: string, options: LocalInferOptions = {}): Promise<LocalInferResult> {
  const tier = options.tier ?? (await detectLocalAi());
  const system = options.system ?? DEFAULT_AUI_SYSTEM;

  if (tier === 'prompt-api') {
    try {
      const session = await createPromptSession(system, { signal: options.signal });
      let text = '';
      for await (const chunk of promptApiStream(session, prompt, options.signal)) text += chunk;
      session.destroy?.();
      const spec = parseSpec(text);
      if (spec) return { via: 'prompt-api', model: PROMPT_API_MODEL, text, spec };
    } catch {
      /* cae a las reglas */
    }
  }

  if (tier === 'webgpu') {
    try {
      const engine = await loadWebllmEngine();
      let text = '';
      const messages: LocalChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ];
      for await (const chunk of webllmStream(engine, messages, options.signal)) text += chunk;
      const spec = parseSpec(text);
      if (spec) return { via: 'webgpu', model: webllmModelId() ?? DEFAULT_LOCAL_MODEL, text, spec };
    } catch {
      /* cae a las reglas */
    }
  }

  return { via: 'rules', model: RULES_MODEL, error: RULES_NEEDS_LOCAL_AI };
}
