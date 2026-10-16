/**
 * consent.ts — Consentimiento persistente para la IA local con descarga.
 *
 * Cubre el tier 2 (WebGPU + WebLLM) y la descarga de Gemini Nano de la Chrome Prompt API
 * (id `prompt-api:gemini-nano`):
 * El usuario acepta una sola vez qué modelo quiere descargar; ese `modelId` queda guardado
 * en `localStorage` (bajo el espacio de nombres `gara_`) y es la ÚNICA autorización con la
 * que una consulta puede usar un motor ya cargado. Si la autorización no existe, la
 * inferencia no carga nada: responde el nivel de reglas.
 *
 * Solo se aceptan ids del catálogo real (`config.ts`): un valor manipulado en el
 * almacenamiento no autoriza ninguna descarga.
 */
import { LOCAL_MODELS } from './config';

/** Clave de `localStorage` (espacio de nombres de la app). */
export const LOCAL_AI_CONSENT_KEY = 'gara_local_ai_consent';

/**
 * Autorización para la descarga de Gemini Nano que gestiona el propio navegador (Chrome
 * Prompt API). Vive en el MISMO almacén que el tier 2: `create()` puede iniciar esa
 * descarga, así que la inferencia solo la llama con este consentimiento (o cuando la API
 * ya está en `available` y no hay nada que descargar).
 */
export const PROMPT_API_CONSENT_MODEL_ID = 'prompt-api:gemini-nano';

export interface LocalAiConsentState {
  modelId: string;
  /** Marca de tiempo de la aceptación (0 si no se pudo leer). */
  acceptedAt: number;
}

function storage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Solo los modelos del catálogo y la Prompt API consentida son autorizables. */
export function isKnownModelId(id: unknown): id is string {
  if (id === PROMPT_API_CONSENT_MODEL_ID) return true;
  return typeof id === 'string' && LOCAL_MODELS.some((model) => model.id === id);
}

/** Consentimiento guardado, o `undefined` si no hay ninguno válido. */
export function readConsent(): LocalAiConsentState | undefined {
  const store = storage();
  if (!store) return undefined;
  try {
    const raw = store.getItem(LOCAL_AI_CONSENT_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { modelId?: unknown; acceptedAt?: unknown };
    if (!isKnownModelId(parsed.modelId)) return undefined;
    return {
      modelId: parsed.modelId,
      acceptedAt: typeof parsed.acceptedAt === 'number' ? parsed.acceptedAt : 0,
    };
  } catch {
    return undefined;
  }
}

/** Modelo autorizado por el usuario, o `undefined`. */
export function authorisedModelId(): string | undefined {
  return readConsent()?.modelId;
}

/** El usuario ya autorizó la descarga de Gemini Nano (Chrome Prompt API). */
export function hasPromptApiConsent(): boolean {
  return readConsent()?.modelId === PROMPT_API_CONSENT_MODEL_ID;
}

/** Guarda la autorización del usuario para un modelo del catálogo. */
export function saveConsent(modelId: string, acceptedAt: number = Date.now()): void {
  if (!isKnownModelId(modelId)) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LOCAL_AI_CONSENT_KEY, JSON.stringify({ modelId, acceptedAt }));
  } catch {
    /* almacenamiento no disponible (modo privado): se sigue sin persistir */
  }
}

/** Retira la autorización (p. ej. al liberar el modelo en este dispositivo). */
export function clearConsent(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(LOCAL_AI_CONSENT_KEY);
  } catch {
    /* nada que borrar */
  }
}
