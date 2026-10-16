/**
 * webllmEngine.test.ts — Registro del motor (tier 2) sin GPU ni descarga real.
 *
 * Fija el contrato REAL del paquete instalado (`@mlc-ai/web-llm` 0.2.86):
 *  - `chat.completions.create({ messages, stream: true })` NO acepta `signal`;
 *  - la generación se corta con `interruptGenerate()` y los recursos con `unload()`.
 * Además comprueba que el motor real vive en un Web Worker (`CreateWebWorkerMLCEngine`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEBLLM_MODEL_OPTIONS,
  disposeWebllmEngine,
  hasEnoughStorage,
  loadWebllmEngine,
  loadedWebllmEngine,
  storageStatus,
  webllmModelId,
  webllmStream,
  type WebllmChunk,
  type WebllmEngine,
} from './webllmEngine';
import { DEFAULT_LOCAL_MODEL, LOW_MEMORY_LOCAL_MODEL, MIN_FREE_STORAGE_MB } from './config';
import type { LocalChatMessage } from './index';

function fakeEngine(chunks: WebllmChunk[]): WebllmEngine {
  return {
    chat: {
      completions: {
        create: async () =>
          (async function* () {
            for (const chunk of chunks) yield chunk;
          })(),
      },
    },
    interruptGenerate: vi.fn(),
    unload: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

afterEach(async () => {
  await disposeWebllmEngine();
  Reflect.deleteProperty(globalThis.navigator, 'storage');
});

describe('webllmStream', () => {
  it('emite solo los deltas con texto', async () => {
    const engine = fakeEngine([
      { choices: [{ delta: { content: 'Hola' } }] },
      { choices: [{ delta: {} }] },
      { choices: [{ delta: { content: ' mundo' } }] },
    ]);
    const parts: string[] = [];
    for await (const chunk of webllmStream(engine, [])) parts.push(chunk);
    expect(parts.join('')).toBe('Hola mundo');
  });

  it('NO pasa signal a la petición (no existe en el contrato del paquete)', async () => {
    const create = vi.fn(
      async (_request: { messages: LocalChatMessage[]; stream: true }) =>
        (async function* () {
          yield { choices: [{ delta: { content: 'x' } }] };
        })(),
    );
    const engine: WebllmEngine = { chat: { completions: { create } } };
    const messages: LocalChatMessage[] = [{ role: 'user', content: 'hola' }];
    const controller = new AbortController();
    for await (const _chunk of webllmStream(engine, messages, controller.signal)) {
      /* consume */
    }
    expect(create).toHaveBeenCalledWith({ messages, stream: true });
    expect(Object.keys(create.mock.calls[0][0]).sort()).toEqual(['messages', 'stream']);
  });

  it('al abortar llama a interruptGenerate y no emite más trozos', async () => {
    const controller = new AbortController();
    const interruptGenerate = vi.fn();
    const create = vi.fn(async () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'uno' } }] };
        controller.abort();
        yield { choices: [{ delta: { content: 'dos' } }] };
      })(),
    );
    const engine: WebllmEngine = { chat: { completions: { create } }, interruptGenerate };
    const parts: string[] = [];
    for await (const chunk of webllmStream(engine, [], controller.signal)) parts.push(chunk);
    expect(interruptGenerate).toHaveBeenCalledTimes(1);
    expect(parts).toEqual(['uno']);
  });

  it('sin señal no registra nada y devuelve todos los deltas', async () => {
    const engine = fakeEngine([{ choices: [{ delta: { content: 'a' } }] }, { choices: [{ delta: { content: 'b' } }] }]);
    const parts: string[] = [];
    for await (const chunk of webllmStream(engine, [])) parts.push(chunk);
    expect(parts).toEqual(['a', 'b']);
  });
});

describe('registro del motor', () => {
  it('carga con la fábrica inyectada y deja el modelo disponible', async () => {
    const engine = fakeEngine([]);
    const loaded = await loadWebllmEngine({ modelId: LOW_MEMORY_LOCAL_MODEL, createEngine: async () => engine });
    expect(loaded).toBe(engine);
    expect(webllmModelId()).toBe(LOW_MEMORY_LOCAL_MODEL);
    expect(loadedWebllmEngine(LOW_MEMORY_LOCAL_MODEL)).toBe(engine);
    expect(loadedWebllmEngine(DEFAULT_LOCAL_MODEL)).toBeUndefined();
  });

  it('reutiliza el motor si se pide el mismo modelo (no vuelve a crear)', async () => {
    const engine = fakeEngine([]);
    const createEngine = vi.fn(async () => engine);
    await loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, createEngine });
    await loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, createEngine });
    expect(createEngine).toHaveBeenCalledTimes(1);
  });

  it('un modelo distinto libera el anterior (nunca conviven dos)', async () => {
    const first = fakeEngine([]);
    const second = fakeEngine([]);
    await loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, createEngine: async () => first });
    await loadWebllmEngine({ modelId: LOW_MEMORY_LOCAL_MODEL, createEngine: async () => second });
    expect(first.unload).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(webllmModelId()).toBe(LOW_MEMORY_LOCAL_MODEL);
  });

  it('si la señal ya está abortada al cargar no se crea ningún motor', async () => {
    const createEngine = vi.fn(async () => fakeEngine([]));
    const controller = new AbortController();
    controller.abort();
    await expect(loadWebllmEngine({ signal: controller.signal, createEngine })).rejects.toThrow(/cancel/i);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it('si abortan durante la carga, el motor recién creado se libera', async () => {
    const engine = fakeEngine([]);
    const controller = new AbortController();
    const createEngine = vi.fn(async () => {
      controller.abort();
      return engine;
    });
    await expect(
      loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, signal: controller.signal, createEngine }),
    ).rejects.toThrow(/cancel/i);
    expect(engine.unload).toHaveBeenCalledTimes(1);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(webllmModelId()).toBeUndefined();
  });

  it('rechaza un id fuera del catálogo sin tocar la fábrica (nunca Nano)', async () => {
    const { PROMPT_API_CONSENT_MODEL_ID } = await import('./consent');
    const createEngine = vi.fn(async () => fakeEngine([]));
    await expect(
      loadWebllmEngine({ modelId: PROMPT_API_CONSENT_MODEL_ID, createEngine }),
    ).rejects.toThrow(/desconocido/i);
    expect(createEngine).not.toHaveBeenCalled();
    expect(webllmModelId()).toBeUndefined();
    await expect(loadWebllmEngine({ modelId: 'modelo-inventado', createEngine })).rejects.toThrow(
      /desconocido/i,
    );
    expect(createEngine).not.toHaveBeenCalled();
  });

  it('dispose descarga y libera el motor cargado', async () => {
    const engine = fakeEngine([]);
    await loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, createEngine: async () => engine });
    await disposeWebllmEngine();
    expect(engine.unload).toHaveBeenCalledTimes(1);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(loadedWebllmEngine()).toBeUndefined();
  });

  it('descargar sin motor cargado no lanza', async () => {
    await expect(disposeWebllmEngine()).resolves.toBeUndefined();
  });
});

describe('almacenamiento', () => {
  it('sin dato de almacenamiento no bloquea; con dato exige el minimo', () => {
    expect(hasEnoughStorage(null)).toBe(true);
    expect(hasEnoughStorage(MIN_FREE_STORAGE_MB)).toBe(true);
    expect(hasEnoughStorage(MIN_FREE_STORAGE_MB - 1)).toBe(false);
  });

  it('calcula el espacio libre de navigator.storage.estimate', async () => {
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({ quota: 4 * 1024 * 1024 * 1024, usage: 1024 * 1024 * 1024 }),
        persisted: async () => true,
      },
    });
    const info = await storageStatus();
    expect(info.availableMb).toBe(3 * 1024);
    expect(info.persisted).toBe(true);
  });

  it('sin navigator.storage devuelve sin dato, sin lanzar', async () => {
    await expect(storageStatus()).resolves.toEqual({ availableMb: null, persisted: false });
  });
});

describe('catalogo de modelos', () => {
  it('usa los ids verificados del paquete instalado', () => {
    expect(DEFAULT_LOCAL_MODEL).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
    expect(LOW_MEMORY_LOCAL_MODEL).toBe('SmolLM2-360M-Instruct-q4f16_1-MLC');
    expect(WEBLLM_MODEL_OPTIONS.map((m) => m.id)).toEqual([
      'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      'SmolLM2-360M-Instruct-q4f16_1-MLC',
    ]);
  });
});

describe('el motor real vive en un Web Worker', () => {
  const readSrc = (rel: string) => readFileSync(join(process.cwd(), 'src/lib/localAi', rel), 'utf8');

  it('el cliente usa CreateWebWorkerMLCEngine y el worker su handler', () => {
    expect(readSrc('webllmClient.ts')).toMatch(/CreateWebWorkerMLCEngine\(/);
    expect(readSrc('webllm.worker.ts')).toMatch(/WebWorkerMLCEngineHandler/);
    // El navegador sin worker no: nunca CreateMLCEngine en el hilo principal.
    expect(readSrc('webllmEngine.ts')).not.toMatch(/CreateMLCEngine\b/);
    expect(readSrc('webllmClient.ts')).not.toMatch(/CreateMLCEngine\b/);
  });

  it('la dependencia entra siempre con import() dinámico', () => {
    for (const f of ['webllmEngine.ts', 'webllmClient.ts', 'webllm.worker.ts']) {
      expect(readSrc(f)).not.toMatch(/from '@mlc-ai\/web-llm'/);
    }
    expect(readSrc('webllmClient.ts')).toMatch(/await import\('@mlc-ai\/web-llm'\)/);
  });
});
