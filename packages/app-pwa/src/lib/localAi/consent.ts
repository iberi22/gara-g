/**
 * consent.ts — Consentimiento persistente para la IA local, POR MOTOR.
 *
 * El almacén (`gara_local_ai_consent`) guarda UNA entrada por motor:
 * `{ webllm?: { modelId, at }, promptApi?: { at } }`.
 *
 * - `webllm`: el id del catálogo (`config.ts`) que el usuario autorizó descargar con
 *   WebLLM. Es la ÚNICA autorización con la que una consulta puede usar el motor ya
 *   cargado. WebLLM solo recibe este id (o el catálogo por defecto de la tarjeta):
 *   nunca un id de otro motor.
 * - `promptApi`: la autorización de la descarga de Gemini Nano que gestiona el propio
 *   navegador (Chrome Prompt API). `create()` puede iniciar esa descarga, así que la
 *   inferencia solo la llama con este consentimiento (o cuando la API ya está en
 *   `available` y no hay nada que descargar).
 *
 * Migración: los valores antiguos de ranura única (`{ modelId, acceptedAt }`) se leen
 * como `webllm` si el id es del catálogo WebLLM, como `promptApi` si es
 * `prompt-api:gemini-nano`, y se descartan en cualquier otro caso. Solo se aceptan
 * ids del catálogo real: un valor manipulado en el almacenamiento no autoriza nada.
 */
import { LOCAL_MODELS } from './config';

/** Clave de `localStorage` (espacio de nombres de la app). */
export const LOCAL_AI_CONSENT_KEY = 'gara_local_ai_consent';

/**
 * Autorización para la descarga de Gemini Nano que gestiona el propio navegador (Chrome
 * Prompt API). Vive en la entrada `promptApi` del almacén, separada del tier 2.
 */
export const PROMPT_API_CONSENT_MODEL_ID = 'prompt-api:gemini-nano';

export type LocalAiEngine = 'webllm' | 'promptApi';

export interface WebllmConsent {
  modelId: string;
  /** Marca de tiempo de la aceptación (0 si no se pudo leer). */
  acceptedAt: number;
}

export interface PromptApiConsent {
  /** Marca de tiempo de la aceptación (0 si no se pudo leer). */
  acceptedAt: number;
}

/** Forma persistida: una entrada por motor. */
interface StoredConsent {
  webllm?: { modelId?: unknown; at?: unknown };
  promptApi?: { at?: unknown };
}

/** Compatibilidad: estado de ranura única (formato anterior). */
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

/** ¿Es un id del catálogo WebLLM (nunca un id de otro motor)? */
export function isWebllmModelId(id: unknown): id is string {
  return typeof id === 'string' && LOCAL_MODELS.some((model) => model.id === id);
}

/** Solo los modelos del catálogo y la Prompt API consentida son autorizables. */
export function isKnownModelId(id: unknown): id is string {
  if (id === PROMPT_API_CONSENT_MODEL_ID) return true;
  return isWebllmModelId(id);
}

function acceptedAtOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function readStored(): StoredConsent | undefined {
  const store = storage();
  if (!store) return undefined;
  try {
    const raw = store.getItem(LOCAL_AI_CONSENT_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredConsent & { modelId?: unknown; acceptedAt?: unknown };
    // Migración del formato anterior de ranura única.
    if (parsed.modelId !== undefined && parsed.webllm === undefined && parsed.promptApi === undefined) {
      if (parsed.modelId === PROMPT_API_CONSENT_MODEL_ID) {
        return { promptApi: { at: parsed.acceptedAt } };
      }
      if (isWebllmModelId(parsed.modelId)) {
        return { webllm: { modelId: parsed.modelId, at: parsed.acceptedAt } };
      }
      // Id desconocido: se descarta.
      return {};
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function persist(state: StoredConsent): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LOCAL_AI_CONSENT_KEY, JSON.stringify(state));
  } catch {
    /* almacenamiento no disponible (modo privado): se sigue sin persistir */
  }
}

/** Consentimiento del motor WebLLM, o `undefined` si no hay ninguno válido. */
export function webllmConsent(): WebllmConsent | undefined {
  const stored = readStored();
  const entry = stored?.webllm;
  if (!entry || !isWebllmModelId(entry.modelId)) return undefined;
  return { modelId: entry.modelId, acceptedAt: acceptedAtOf(entry.at) };
}

/** Consentimiento de la Prompt API (Gemini Nano), o `undefined`. */
export function promptApiConsent(): PromptApiConsent | undefined {
  const stored = readStored();
  if (!stored?.promptApi) return undefined;
  return { acceptedAt: acceptedAtOf(stored.promptApi.at) };
}

/**
 * Consentimiento guardado del motor WebLLM, o `undefined` si no hay ninguno válido.
 * (Compatibilidad: el formato anterior de ranura única migra a la entrada `webllm`.)
 */
export function readConsent(): LocalAiConsentState | undefined {
  const consent = webllmConsent();
  return consent ? { modelId: consent.modelId, acceptedAt: consent.acceptedAt } : undefined;
}

/** Modelo WebLLM autorizado por el usuario, o `undefined`. Nunca un id de otro motor. */
export function authorisedModelId(): string | undefined {
  return webllmConsent()?.modelId;
}

/** El usuario ya autorizó la descarga de Gemini Nano (Chrome Prompt API). */
export function hasPromptApiConsent(): boolean {
  return promptApiConsent() !== undefined;
}

/** Guarda la autorización del usuario para un modelo WebLLM del catálogo. */
export function saveWebllmConsent(modelId: string, acceptedAt: number = Date.now()): void {
  if (!isWebllmModelId(modelId)) return;
  const stored = readStored() ?? {};
  persist({ ...stored, webllm: { modelId, at: acceptedAt } });
}

/** Guarda la autorización del usuario para la descarga de Gemini Nano. */
export function savePromptApiConsent(acceptedAt: number = Date.now()): void {
  const stored = readStored() ?? {};
  persist({ ...stored, promptApi: { at: acceptedAt } });
}

/**
 * Guarda la autorización del usuario. (Compatibilidad: encamina cada id a su motor;
 * un id desconocido no se persiste.)
 */
export function saveConsent(modelId: string, acceptedAt: number = Date.now()): void {
  if (modelId === PROMPT_API_CONSENT_MODEL_ID) {
    savePromptApiConsent(acceptedAt);
    return;
  }
  saveWebllmConsent(modelId, acceptedAt);
}

/**
 * Retira la autorización. Sin motor, retira las dos entradas; con motor, solo la suya
 * (p. ej. al liberar el modelo WebLLM en este dispositivo sin tocar Nano).
 */
export function clearConsent(engine?: LocalAiEngine): void {
  if (engine === undefined) {
    const store = storage();
    if (!store) return;
    try {
      store.removeItem(LOCAL_AI_CONSENT_KEY);
    } catch {
      /* nada que borrar */
    }
    return;
  }
  const stored = readStored();
  if (!stored) return;
  const next: StoredConsent =
    engine === 'webllm'
      ? { ...(stored.promptApi ? { promptApi: stored.promptApi } : {}) }
      : { ...(stored.webllm ? { webllm: stored.webllm } : {}) };
  if (!next.webllm && !next.promptApi) {
    const store = storage();
    if (!store) return;
    try {
      store.removeItem(LOCAL_AI_CONSENT_KEY);
    } catch {
      /* nada que borrar */
    }
    return;
  }
  persist(next);
}
