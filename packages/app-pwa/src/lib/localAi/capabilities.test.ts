/**
 * capabilities.test.ts — Detección de nivel de IA local. Sin descargas: solo sondas.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectLocalAi,
  isLocalAiUsable,
  localAiEnvironment,
  type GpuLike,
  type LanguageModelAvailabilityApi,
} from './capabilities';

const gpu: GpuLike = { requestAdapter: async () => null };

const languageModel = (state: string | (() => never)): LanguageModelAvailabilityApi => ({
  availability: () => (typeof state === 'function' ? state() : Promise.resolve(state)),
});

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  Reflect.deleteProperty(globalThis.navigator, 'gpu');
});

describe('detectLocalAi', () => {
  it('availability "available" da prompt-api', async () => {
    await expect(detectLocalAi({ languageModel: languageModel('available') })).resolves.toBe('prompt-api');
  });

  it('los estados legacy y de descarga del navegador también cuentan como prompt-api', async () => {
    for (const state of ['readily', 'downloadable', 'downloading', 'after-download']) {
      await expect(detectLocalAi({ languageModel: languageModel(state) })).resolves.toBe('prompt-api');
    }
  });

  it('"unavailable" con un navigator.gpu sano da webgpu', async () => {
    await expect(detectLocalAi({ languageModel: languageModel('unavailable'), gpu })).resolves.toBe('webgpu');
  });

  it('sin Prompt API y sin GPU da rules', async () => {
    await expect(detectLocalAi({})).resolves.toBe('rules');
  });

  it('una sonda que lanza no rompe: cae al siguiente nivel', async () => {
    const broken: LanguageModelAvailabilityApi = {
      availability: () => {
        throw new Error('boom');
      },
    };
    await expect(detectLocalAi({ languageModel: broken, gpu })).resolves.toBe('webgpu');
    await expect(detectLocalAi({ languageModel: broken })).resolves.toBe('rules');
  });

  it('un gpu sin requestAdapter no cuenta como WebGPU', async () => {
    await expect(detectLocalAi({ gpu: {} })).resolves.toBe('rules');
  });

  it('lee los globales reales del navegador', async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = languageModel('available');
    expect(localAiEnvironment().languageModel).toBeDefined();
    await expect(detectLocalAi()).resolves.toBe('prompt-api');

    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: gpu });
    await expect(detectLocalAi()).resolves.toBe('webgpu');
  });

  it('la deteccion no crea ninguna sesion (no descarga nada)', async () => {
    const create = vi.fn();
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create,
    };
    await detectLocalAi();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('isLocalAiUsable', () => {
  it('solo las reglas no se consideran IA', () => {
    expect(isLocalAiUsable('prompt-api')).toBe(true);
    expect(isLocalAiUsable('webgpu')).toBe(true);
    expect(isLocalAiUsable('rules')).toBe(false);
  });
});
