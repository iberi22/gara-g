/**
 * capabilities.ts — Detección del nivel de IA local disponible en ESTE navegador.
 *
 * Nunca descarga nada: solo pregunta. La sesión de la Prompt API se crea y el modelo de
 * WebLLM se carga únicamente desde un gesto del usuario (ver LocalAiConsent.svelte), nunca
 * durante la detección ni al montar un componente.
 */

export type AiTier = 'prompt-api' | 'webgpu' | 'rules';

/** Lo mínimo que se usa de `globalThis.LanguageModel` (Chrome Prompt API). */
export interface LanguageModelAvailabilityApi {
  availability(options?: Record<string, unknown>): Promise<string> | string;
}

/** Lo mínimo que se usa de `navigator.gpu`. */
export interface GpuLike {
  requestAdapter?: (...args: unknown[]) => unknown;
}

export interface LocalAiEnvironment {
  languageModel?: LanguageModelAvailabilityApi;
  gpu?: GpuLike | null;
}

/**
 * Estados en los que la Prompt API sirve SIN pedir nada más: el modelo ya está listo y
 * `create()` no inicia ninguna descarga. (`readily` es el nombre legacy de `available`.)
 *
 * `downloadable` / `downloading` / `after-download` NO sirven solos: `create()` puede
 * iniciar la descarga de Gemini Nano, así que solo cuentan cuando el usuario ya dio su
 * consentimiento explícito (ver `consent.ts`, id `prompt-api:gemini-nano`).
 */
const PROMPT_API_AUTO_USABLE = new Set(['available', 'readily']);

/** Estados en los que el navegador aún tiene que descargar Gemini Nano. */
export const PROMPT_API_DOWNLOAD_STATES: readonly string[] = [
  'downloadable',
  'downloading',
  'after-download',
];

import { hasPromptApiConsent } from './consent';

/** Lee los globales reales del navegador (o los dobles del test). */
export function localAiEnvironment(): LocalAiEnvironment {
  const scope = globalThis as {
    LanguageModel?: LanguageModelAvailabilityApi;
    navigator?: { gpu?: GpuLike | null };
  };
  return { languageModel: scope.LanguageModel, gpu: scope.navigator?.gpu ?? null };
}

/**
 * Estado crudo de `LanguageModel.availability()`, o `undefined` si no hay Prompt API o la
 * sonda falla. No crea sesiones: nunca descarga nada.
 */
export async function promptApiState(
  env: LocalAiEnvironment = localAiEnvironment(),
): Promise<string | undefined> {
  try {
    const lm = env.languageModel;
    if (!lm || typeof lm.availability !== 'function') return undefined;
    return String(await lm.availability());
  } catch {
    return undefined;
  }
}

/** `true` solo cuando el estado aún exige descargar Gemini Nano. */
export function isPromptApiDownloadState(state: string | undefined): boolean {
  return state !== undefined && PROMPT_API_DOWNLOAD_STATES.includes(state);
}

/**
 * Nivel disponible, de mejor a peor. No lanza: cualquier fallo de la sonda se trata como
 * "no disponible" y se cae al siguiente nivel (y en el peor caso, a las reglas).
 *
 * La Prompt API se ofrece sola SOLO cuando ya está lista (`available`). Con descarga
 * pendiente (`downloadable`/`downloading`) solo se ofrece si el usuario ya autorizó la
 * descarga de Gemini Nano en el almacén de consentimiento; leer ese almacén no descarga
 * nada, así que la detección sigue sin descargar.
 */
export async function detectLocalAi(env: LocalAiEnvironment = localAiEnvironment()): Promise<AiTier> {
  try {
    const state = await promptApiState(env);
    if (state !== undefined && PROMPT_API_AUTO_USABLE.has(state)) return 'prompt-api';
    if (isPromptApiDownloadState(state) && hasPromptApiConsent()) return 'prompt-api';
  } catch {
    /* sonda fallida: se sigue con el siguiente nivel */
  }
  try {
    if (env.gpu && typeof env.gpu.requestAdapter === 'function') return 'webgpu';
  } catch {
    /* sonda fallida: se sigue con las reglas */
  }
  return 'rules';
}

/** Un nivel es "usable con IA" si no es el de reglas deterministas. */
export function isLocalAiUsable(tier: AiTier): boolean {
  return tier !== 'rules';
}
