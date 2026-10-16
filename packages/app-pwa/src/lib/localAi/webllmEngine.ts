/**
 * webllmEngine.ts — Registro del motor WebGPU + WebLLM (tier 2, opcional).
 *
 * Dos garantías de G3:
 *  1. Cargar el motor es una acción EXPLÍCITA del usuario (el clic de LocalAiConsent).
 *     `loadWebllmEngine` solo se llama desde ahí; la inferencia usa `loadedWebllmEngine` y,
 *     si no hay motor ya cargado y autorizado, no carga nada (responde el nivel de reglas).
 *  2. El motor aceptado NO se cambia durante una consulta: se guarda el `modelId` cargado y
 *     solo un nuevo clic del usuario puede reemplazarlo (y entonces se libera el anterior).
 *
 * El motor real vive en un Web Worker (`webllmClient.ts` -> `webllm.worker.ts`) y la
 * dependencia entra siempre con `import()` dinámico: nada de `@mlc-ai/web-llm` en el bundle
 * inicial ni en SSR.
 */
import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS, MIN_FREE_STORAGE_MB } from './config';
import type { LocalChatMessage } from './index';

export interface WebllmProgress {
  progress: number;
  text: string;
}

export interface WebllmChunk {
  choices?: { delta?: { content?: string } }[];
}

/**
 * Contrato mínimo que usamos del motor. `interruptGenerate`, `unload` y `dispose` son
 * opcionales para poder probar sin GPU; en producción el worker los implementa todos.
 */
export interface WebllmEngine {
  chat: {
    completions: {
      /** Contrato del paquete: `signal` NO existe en la petición. */
      create(options: { messages: LocalChatMessage[]; stream: true }): Promise<AsyncIterable<WebllmChunk>>;
    };
  };
  interruptGenerate?(): unknown;
  unload?(): Promise<void>;
  /** Termina el worker y libera la GPU (solo el motor real lo implementa). */
  dispose?(): void;
}

export type WebllmEngineFactory = (
  modelId: string,
  onProgress: (progress: WebllmProgress) => void,
  signal?: AbortSignal,
) => Promise<WebllmEngine>;

export interface LoadWebllmEngineOptions {
  modelId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: WebllmProgress) => void;
  /** Inyectable en tests; en producción, el motor real en un Web Worker. */
  createEngine?: WebllmEngineFactory;
}

interface StorageLike {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

let loadedEngine: WebllmEngine | undefined;
let loadedModelId: string | undefined;
let loading: Promise<WebllmEngine> | undefined;

/** Error de cancelación reconocible por la interfaz. */
export function abortError(): DOMException {
  return new DOMException('La carga del modelo local se canceló.', 'AbortError');
}

/** Id del modelo cargado, o undefined si aún no hay ninguno. */
export function webllmModelId(): string | undefined {
  return loadedModelId;
}

/**
 * Motor YA cargado. Si se pasa `modelId`, solo lo devuelve cuando es exactamente el cargado:
 * así una consulta nunca usa (ni reemplaza) un modelo distinto del autorizado.
 */
export function loadedWebllmEngine(modelId?: string): WebllmEngine | undefined {
  if (!loadedEngine) return undefined;
  if (modelId && loadedModelId !== modelId) return undefined;
  return loadedEngine;
}

function storage(): StorageLike | undefined {
  const scope = globalThis as { navigator?: { storage?: StorageLike } };
  return scope.navigator?.storage;
}

/** Espacio libre del navegador y si puede conservar la descarga frente a un desalojo. */
export async function storageStatus(): Promise<{ availableMb: number | null; persisted: boolean }> {
  const store = storage();
  if (!store?.estimate) return { availableMb: null, persisted: false };
  try {
    const { quota = 0, usage = 0 } = await store.estimate();
    const availableMb = Math.max(0, Math.floor((quota - usage) / (1024 * 1024)));
    const persisted = store.persisted ? await store.persisted() : false;
    return { availableMb, persisted };
  } catch {
    return { availableMb: null, persisted: false };
  }
}

/** Sin dato de almacenamiento no se bloquea la descarga; con dato, se exige el mínimo. */
export function hasEnoughStorage(availableMb: number | null): boolean {
  return availableMb === null || availableMb >= MIN_FREE_STORAGE_MB;
}

/** Pide almacenamiento persistente para que el navegador no borre los pesos. */
export async function requestPersistentStorage(): Promise<boolean> {
  const store = storage();
  try {
    return store?.persist ? await store.persist() : false;
  } catch {
    return false;
  }
}

/** Fábrica por defecto: el motor real, en un Web Worker (import dinámico del cliente). */
async function defaultFactory(
  modelId: string,
  onProgress: (progress: WebllmProgress) => void,
  signal?: AbortSignal,
): Promise<WebllmEngine> {
  const { createWorkerEngine } = await import('./webllmClient');
  return createWorkerEngine(modelId, onProgress, signal);
}

/**
 * Carga el motor. SOLO debe llamarse desde el clic de LocalAiConsent (nunca durante una
 * consulta ni al montar un componente). Si ya hay otro modelo cargado se libera primero:
 * nunca conviven dos modelos ni se cambia el modelo a mitad de una consulta.
 *
 * Solo acepta ids del catálogo WebLLM (`config.ts`): cualquier otro id (incluido el de
 * la Prompt API, que vive en otro motor) se rechaza sin tocar la fábrica.
 */
export async function loadWebllmEngine(options: LoadWebllmEngineOptions = {}): Promise<WebllmEngine> {
  const modelId = options.modelId ?? DEFAULT_LOCAL_MODEL;
  if (!LOCAL_MODELS.some((model) => model.id === modelId)) {
    throw new Error(`Modelo WebLLM desconocido: ${modelId}.`);
  }
  const signal = options.signal;
  if (signal?.aborted) throw abortError();
  if (loadedEngine && loadedModelId === modelId) return loadedEngine;

  if (loading || loadedEngine) await disposeWebllmEngine();
  if (signal?.aborted) throw abortError();

  const factory = options.createEngine ?? defaultFactory;
  const promise = (async () => {
    const engine = await factory(modelId, options.onProgress ?? (() => {}), signal);
    if (signal?.aborted) {
      try {
        await engine.unload?.();
      } catch {
        /* la GPU ya puede estar libre */
      }
      engine.dispose?.();
      throw abortError();
    }
    loadedEngine = engine;
    loadedModelId = modelId;
    return engine;
  })();

  loading = promise;
  try {
    return await promise;
  } catch (error) {
    loadedEngine = undefined;
    loadedModelId = undefined;
    throw error;
  } finally {
    if (loading === promise) loading = undefined;
  }
}

/** Descarga el motor y libera recursos (al cancelar o cerrar el asistente). */
export async function disposeWebllmEngine(): Promise<void> {
  const engine = loadedEngine;
  loadedEngine = undefined;
  loadedModelId = undefined;
  loading = undefined;
  if (!engine) return;
  try {
    await engine.unload?.();
  } catch {
    /* la GPU ya puede estar libre */
  }
  engine.dispose?.();
}

/**
 * Texto del chat en streaming, ya normalizado a incrementos.
 *
 * La cancelación es real: `signal` NO viaja a `chat.completions.create` (no está en el
 * contrato del paquete); al abortar se llama a `interruptGenerate()` y se corta el bucle.
 */
export async function* webllmStream(
  engine: WebllmEngine,
  messages: LocalChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (signal?.aborted) return;
  let interrupted = false;
  const onAbort = (): void => {
    interrupted = true;
    try {
      void engine.interruptGenerate?.();
    } catch {
      /* el motor ya había terminado */
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const chunks = await engine.chat.completions.create({ messages, stream: true });
    for await (const chunk of chunks) {
      if (interrupted || signal?.aborted) break;
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Modelos ofrecidos en la tarjeta de consentimiento (ids reales de config.ts). */
export const WEBLLM_MODEL_OPTIONS = LOCAL_MODELS;
