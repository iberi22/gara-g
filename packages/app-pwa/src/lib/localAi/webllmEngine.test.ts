/**
 * webllmEngine.test.ts — Adaptadores del tier 2 (WebGPU + WebLLM) sin GPU ni descarga.
 *
 * El motor real no se carga aquí: se prueba la normalización del stream, la sonda de
 * almacenamiento y que los ids de modelo son los de `config.ts` (verificados contra
 * `prebuiltAppConfig` del paquete instalado).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEBLLM_MODEL_OPTIONS,
  disposeWebllmEngine,
  hasEnoughStorage,
  storageStatus,
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
        create: async () => (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      },
    },
  };
}

afterEach(() => {
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

  it('pasa los mensajes y la señal a chat.completions.create', async () => {
    const create = vi.fn(async () => (async function* () {
      yield { choices: [{ delta: { content: 'x' } }] };
    })());
    const engine: WebllmEngine = { chat: { completions: { create } } };
    const messages: LocalChatMessage[] = [{ role: 'user', content: 'hola' }];
    const signal = new AbortController().signal;
    for await (const _chunk of webllmStream(engine, messages, signal)) {
      /* consume */
    }
    expect(create).toHaveBeenCalledWith({ messages, stream: true, signal });
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

  it('descargar sin motor cargado no lanza', async () => {
    await expect(disposeWebllmEngine()).resolves.toBeUndefined();
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
