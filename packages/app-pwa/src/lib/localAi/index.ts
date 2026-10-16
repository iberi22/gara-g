/**
 * index.ts — Punto único de la IA local del navegador (G3).
 *
 * - `localChat(messages, { onToken, signal, excerpts })`: asistente del expediente, en
 *   streaming, con la misma forma que el antiguo SSE para que la UI no cambie apenas.
 * - `localInfer(prompt, { system })`: generación de la AUI (devuelve una spec AuiSpec).
 *
 * Cadena de respaldo: Prompt API → WebGPU/WebLLM → reglas deterministas. Reglas de oro:
 *  - La inferencia NUNCA descarga un modelo sin permiso. La Prompt API se usa sola solo si
 *    ya está en `available`; con descarga pendiente (`downloadable`/`downloading`) exige el
 *    consentimiento explícito de Gemini Nano (`prompt-api:gemini-nano` en `consent.ts`).
 *    El motor WebGPU que se usa es el YA cargado Y autorizado; si no hay, responden las reglas.
 *  - Una respuesta vacía es un fallo, no un éxito: se sigue con el siguiente motor.
 *  - Un stream que falla a mitad es un FALLO: se descarta el parcial, se avisa con
 *    `onReset` para que la UI limpie los tokens, y se sigue con el siguiente motor. Solo la
 *    cancelación del usuario conserva el parcial y detiene la cadena (marcada `cancelled`).
 *  - Ninguna función lanza hacia la interfaz: el peor caso siempre es una respuesta útil
 *    de las reglas.
 */
import { detectLocalAi, promptApiState, type AiTier } from './capabilities';
import { authorisedModelId, hasPromptApiConsent } from './consent';
import { createPromptSession, promptApiStream, type PromptInitialMessage } from './promptApi';
import { RULES_MODEL, RULES_NEEDS_LOCAL_AI, rulesAnswer } from './rules';
import {
  loadedWebllmEngine,
  webllmModelId,
  webllmStream,
  type WebllmEngine,
} from './webllmEngine';
import type { ManualChunk } from '../../garage/assistant/manualText';

export type { AiTier } from './capabilities';
export { detectLocalAi, isLocalAiUsable, localAiEnvironment } from './capabilities';
export {
  LOCAL_AI_CONSENT_KEY,
  PROMPT_API_CONSENT_MODEL_ID,
  authorisedModelId,
  clearConsent,
  hasPromptApiConsent,
  promptApiConsent,
  readConsent,
  saveConsent,
  savePromptApiConsent,
  saveWebllmConsent,
  webllmConsent,
} from './consent';
export { RULES_LABEL, RULES_MODEL, RULES_NEEDS_LOCAL_AI, RULES_NO_MATCH } from './rules';
export {
  consentOffers,
  hasConsentOffer,
  type ConsentOffers,
  type ConsentOfferState,
} from './consentOffers';

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalChatOptions {
  /** Fragmentos de manual ya elegidos por el navegador: base de la respuesta por reglas. */
  excerpts?: readonly ManualChunk[];
  onToken?: (chunk: string) => void;
  /**
   * La UI limpia los tokens parciales cuando un motor falla a mitad del stream y la
   * cadena sigue con el siguiente motor. En una cancelación del usuario NO se llama:
   * el parcial se conserva.
   */
  onReset?: () => void;
  signal?: AbortSignal;
  /** Fuerza un nivel (p. ej. reglas explícitas). Por defecto, el detectado. */
  tier?: AiTier;
  /** Modelo autorizado. Por defecto, el consentido en `consent.ts`. */
  modelId?: string;
  /** Motor WebLLM ya cargado (lo inyectan los tests; en producción sale del registro). */
  engine?: WebllmEngine;
}

export interface LocalChatResult {
  via: AiTier;
  model: string;
  text: string;
  error?: string;
  /** La cadena se detuvo por una cancelación del usuario; el parcial se conserva. */
  cancelled?: boolean;
}

export interface LocalInferOptions {
  /** Prompt de sistema de la AUI (whitelist de componentes, contrato AuiSpec v1, ...). */
  system?: string;
  signal?: AbortSignal;
  tier?: AiTier;
  /** Modelo autorizado. Por defecto, el consentido en `consent.ts`. */
  modelId?: string;
  /** Motor WebLLM ya cargado (lo inyectan los tests). */
  engine?: WebllmEngine;
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

/**
 * Reparto para la Prompt API: el historial completo va en `initialPrompts` y el último
 * mensaje del usuario como turno a responder. Así el modelo no pierde la conversación.
 */
export function splitForPromptApi(messages: readonly LocalChatMessage[]): {
  initial: PromptInitialMessage[];
  prompt: string;
} {
  const all: PromptInitialMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const last = all[all.length - 1];
  if (last && last.role === 'user') {
    return { initial: all.slice(0, -1), prompt: last.content };
  }
  return { initial: all, prompt: '' };
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

/** Motor WebGPU disponible para esta consulta: ya cargado Y autorizado. Nunca carga. */
function availableEngine(options: LocalChatOptions | LocalInferOptions): WebllmEngine | undefined {
  if (options.engine) return options.engine;
  const modelId = options.modelId ?? authorisedModelId();
  return modelId ? loadedWebllmEngine(modelId) : undefined;
}

/** Etiqueta honesta del modelo con el que respondió WebGPU. */
function webllmLabel(options: LocalChatOptions | LocalInferOptions): string {
  return options.modelId ?? webllmModelId() ?? RULES_MODEL;
}

/**
 * ¿Se puede llamar a `create()` sin iniciar una descarga sorpresa? Solo cuando la Prompt
 * API ya está lista (`available`), o cuando el usuario autorizó la descarga de Gemini
 * Nano. En cualquier otro caso la rama de la Prompt API se salta entera: `create()` no
 * se llama y la cadena sigue con WebGPU y las reglas.
 */
async function promptApiAllowed(): Promise<boolean> {
  const state = await promptApiState();
  if (state === 'available' || state === 'readily') return true;
  return hasPromptApiConsent();
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
  /**
   * Un motor que falla a mitad descarta su parcial y avisa a la UI para que limpie los
   * tokens ya pintados. Sin parcial no hay nada que limpiar y no se avisa.
   */
  const failEngine = (base: number): void => {
    if (emitted.length > base) {
      emitted = emitted.slice(0, base);
      options.onReset?.();
    }
  };

  // 1. Prompt API (Gemini Nano), solo si ya está lista o el usuario autorizó su descarga.
  if (tier === 'prompt-api' && (await promptApiAllowed())) {
    const base = emitted.length;
    let failed = false;
    let session: Awaited<ReturnType<typeof createPromptSession>> | undefined;
    try {
      const { initial, prompt } = splitForPromptApi(messages);
      session = await createPromptSession(initial, { signal: options.signal });
      for await (const chunk of promptApiStream(session, prompt, options.signal)) emit(chunk);
    } catch {
      failed = true;
    } finally {
      session?.destroy?.();
    }
    if (options.signal?.aborted)
      return { via: 'prompt-api', model: PROMPT_API_MODEL, text: emitted, cancelled: true };
    if (failed) failEngine(base);
    else if (emitted.slice(base).trim())
      return { via: 'prompt-api', model: PROMPT_API_MODEL, text: emitted };
  }

  // 2. WebGPU + WebLLM: SOLO un motor ya cargado y autorizado. Aquí no se descarga nada.
  const engine = availableEngine(options);
  if (engine) {
    const base = emitted.length;
    let failed = false;
    try {
      for await (const chunk of webllmStream(engine, [...messages], options.signal)) emit(chunk);
    } catch {
      failed = true;
    }
    if (options.signal?.aborted)
      return { via: 'webgpu', model: webllmLabel(options), text: emitted, cancelled: true };
    if (failed) failEngine(base);
    else if (emitted.slice(base).trim())
      return { via: 'webgpu', model: webllmLabel(options), text: emitted };
  }

  // 3. Reglas deterministas: la red de seguridad, siempre disponible.
  const rules = rulesAnswer(question, options.excerpts ?? []);
  emit(emitted ? `\n\n${rules}` : rules);
  return { via: 'rules', model: RULES_MODEL, text: emitted };
}

/**
 * Generación de la AUI con IA local. Devuelve la spec sin validar (la valida `aui.ts`) o,
 * si no hay motor disponible, un mensaje claro en español. Nunca lanza y nunca descarga.
 */
export async function localInfer(prompt: string, options: LocalInferOptions = {}): Promise<LocalInferResult> {
  const tier = options.tier ?? (await detectLocalAi());
  const system = options.system ?? DEFAULT_AUI_SYSTEM;

  // 1. Prompt API (Gemini Nano): solo lista o con descarga consentida. Nunca `create()`
  // para iniciar una descarga sin permiso.
  if (tier === 'prompt-api' && (await promptApiAllowed())) {
    let session: Awaited<ReturnType<typeof createPromptSession>> | undefined;
    let text = '';
    try {
      session = await createPromptSession([{ role: 'system', content: system }], {
        signal: options.signal,
      });
      for await (const chunk of promptApiStream(session, prompt, options.signal)) text += chunk;
    } catch {
      text = '';
    } finally {
      session?.destroy?.();
    }
    const spec = parseSpec(text);
    if (spec) return { via: 'prompt-api', model: PROMPT_API_MODEL, text, spec };
  }

  // 2. WebGPU + WebLLM: motor ya cargado y autorizado, nunca una descarga.
  const engine = availableEngine(options);
  if (engine) {
    let text = '';
    try {
      const messages: LocalChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ];
      for await (const chunk of webllmStream(engine, messages, options.signal)) text += chunk;
    } catch {
      text = '';
    }
    const spec = parseSpec(text);
    if (spec) return { via: 'webgpu', model: webllmLabel(options), text, spec };
  }

  return { via: 'rules', model: RULES_MODEL, error: RULES_NEEDS_LOCAL_AI };
}
