/**
 * webllmEngine.ts — WebGPU + WebLLM (tier 2, opcional).
 *
 * Port libre de framework del `useWebLLM.ts` de Shelf (`CreateMLCEngine` +
 * `chat.completions.create({ stream: true })`), adaptado a un módulo sin React y con carga
 * perezosa: la dependencia entra SOLO con `import()` y únicamente cuando el usuario pulsa
 * "Descargar modelo" en LocalAiConsent.svelte. Nunca entra en el bundle inicial ni en SSR.
 *
 * Nota de diseño: el spec hablaba de un "Web Worker engine"; se sigue la implementación de
 * referencia (Shelf/WebLLM) con `CreateMLCEngine` en el hilo principal porque es la que
 * está probada y no obliga a un fichero worker adicional. El `import()` dinámico mantiene
 * la garantía que importa: nada se descarga hasta el clic. Ver informe, sección decisiones.
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

export interface WebllmEngine {
  chat: {
    completions: {
      create(options: {
        messages: LocalChatMessage[];
        stream: true;
        signal?: AbortSignal;
      }): Promise<AsyncIterable<WebllmChunk>>;
    };
  };
  unload?(): Promise<void>;
}

interface StorageLike {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

let enginePromise: Promise<WebllmEngine> | undefined;
let loadedModelId: string | undefined;

/** Id del modelo cargado, o undefined si aún no hay ninguno. */
export function webllmModelId(): string | undefined {
  return loadedModelId;
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

/**
 * Carga el motor. Solo se llama desde el clic de la tarjeta de consentimiento; el
 * `import()` dinámico es lo que mantiene WebLLM fuera del bundle inicial y de SSR.
 */
export async function loadWebllmEngine(
  onProgress?: (progress: WebllmProgress) => void,
  modelId: string = DEFAULT_LOCAL_MODEL,
): Promise<WebllmEngine> {
  if (enginePromise && loadedModelId === modelId) return enginePromise;

  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  enginePromise = (async () => {
    const engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report: { progress?: number; text?: string }) =>
        onProgress?.({ progress: report.progress ?? 0, text: report.text ?? '' }),
    });
    loadedModelId = modelId;
    return engine as unknown as WebllmEngine;
  })();

  try {
    return await enginePromise;
  } catch (err) {
    enginePromise = undefined;
    loadedModelId = undefined;
    throw err;
  }
}

/** Descarga el motor y libera la GPU (al cancelar o cerrar el asistente). */
export async function disposeWebllmEngine(): Promise<void> {
  const engine = enginePromise ? await enginePromise.catch(() => undefined) : undefined;
  enginePromise = undefined;
  loadedModelId = undefined;
  await engine?.unload?.();
}

/** Texto del chat en streaming, ya normalizado a incrementos. */
export async function* webllmStream(
  engine: WebllmEngine,
  messages: LocalChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const chunks = await engine.chat.completions.create({ messages, stream: true, signal });
  for await (const chunk of chunks) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

/** Modelos ofrecidos en la tarjeta de consentimiento (ids reales de config.ts). */
export const WEBLLM_MODEL_OPTIONS = LOCAL_MODELS;
