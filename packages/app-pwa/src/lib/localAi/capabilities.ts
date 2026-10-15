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
 * Estados en los que la Prompt API sirve: disponible ya, o disponible tras una descarga
 * que gestiona el propio navegador (no la pedimos nosotros).
 */
const PROMPT_API_USABLE = new Set(['available', 'readily', 'downloadable', 'downloading', 'after-download']);

/** Lee los globales reales del navegador (o los dobles del test). */
export function localAiEnvironment(): LocalAiEnvironment {
  const scope = globalThis as {
    LanguageModel?: LanguageModelAvailabilityApi;
    navigator?: { gpu?: GpuLike | null };
  };
  return { languageModel: scope.LanguageModel, gpu: scope.navigator?.gpu ?? null };
}

/**
 * Nivel disponible, de mejor a peor. No lanza: cualquier fallo de la sonda se trata como
 * "no disponible" y se cae al siguiente nivel (y en el peor caso, a las reglas).
 */
export async function detectLocalAi(env: LocalAiEnvironment = localAiEnvironment()): Promise<AiTier> {
  try {
    const lm = env.languageModel;
    if (lm && typeof lm.availability === 'function') {
      const state = String(await lm.availability());
      if (PROMPT_API_USABLE.has(state)) return 'prompt-api';
    }
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
