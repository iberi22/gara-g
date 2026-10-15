// @vitest-environment jsdom
/**
 * localAi.test.ts — Cadena de respaldo de la IA local y "sin descargas silenciosas".
 *
 * Ninguna de las funciones lanza hacia la interfaz: si un motor falla, responde el nivel
 * de reglas. Y la deteccion / el montaje de la tarjeta de consentimiento NUNCA cargan el
 * motor de WebGPU (eso solo ocurre con el clic del usuario).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LocalAiConsent from '../../components/garage-dossier/LocalAiConsent.svelte';
import { detectLocalAi } from './capabilities';
import { localChat, localInfer } from './index';
import { RULES_LABEL, RULES_NEEDS_LOCAL_AI, RULES_NO_MATCH } from './rules';
import type { PromptApiSession } from './promptApi';
import type { ManualChunk } from '../../garage/assistant/manualText';

const mlc = vi.hoisted(() => ({ CreateMLCEngine: vi.fn() }));
vi.mock('@mlc-ai/web-llm', () => ({ CreateMLCEngine: mlc.CreateMLCEngine }));

const excerpts: ManualChunk[] = [
  { manual: 'Manual FZ', page: 42, text: 'Pares de apriete: tuerca del eje trasero 90 N·m.' },
];

async function* fromArray(values: string[]): AsyncGenerator<string> {
  for (const v of values) yield v;
}

function stubLanguageModel(create: (options: unknown) => Promise<PromptApiSession>): void {
  (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => 'available', create };
}

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  Reflect.deleteProperty(globalThis.navigator, 'gpu');
  mlc.CreateMLCEngine.mockReset();
  document.body.innerHTML = '';
});

const ask = [{ role: 'user' as const, content: '¿Qué aceite usa?' }];

describe('localChat · reglas', () => {
  it('responde con el fragmento literal y la etiqueta', async () => {
    const res = await localChat(ask, { tier: 'rules', excerpts });
    expect(res.via).toBe('rules');
    expect(res.text).toContain(RULES_LABEL);
    expect(res.text).toContain('tuerca del eje trasero 90 N·m');
  });

  it('sin fragmentos dice que no hay texto en los manuales', async () => {
    const res = await localChat(ask, { tier: 'rules' });
    expect(res.text).toBe(RULES_NO_MATCH);
  });

  it('hace streaming del texto por onToken', async () => {
    const parts: string[] = [];
    await localChat(ask, { tier: 'rules', excerpts, onToken: (t) => parts.push(t) });
    expect(parts.join('')).toContain(RULES_LABEL);
  });

  it('forzando reglas no toca la Prompt API', async () => {
    const create = vi.fn(async () => ({ promptStreaming: () => fromArray(['x']) }));
    stubLanguageModel(create);
    await localChat(ask, { tier: 'rules', excerpts });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('localChat · motor que falla', () => {
  it('si la Prompt API lanza, cae a las reglas', async () => {
    stubLanguageModel(async () => {
      throw new Error('sin permiso');
    });
    const res = await localChat(ask, { tier: 'prompt-api', excerpts });
    expect(res.via).toBe('rules');
    expect(res.text).toContain(RULES_LABEL);
  });

  it('hace streaming incremental de la Prompt API', async () => {
    stubLanguageModel(async () => ({ promptStreaming: () => fromArray(['Usa ', '10W-40']) }));
    const parts: string[] = [];
    const res = await localChat(ask, { tier: 'prompt-api', onToken: (t) => parts.push(t) });
    expect(res).toMatchObject({ via: 'prompt-api', model: 'gemini-nano' });
    expect(parts).toEqual(['Usa ', '10W-40']);
  });

  it('al cancelar no añade las reglas encima del texto parcial', async () => {
    const controller = new AbortController();
    stubLanguageModel(async () => ({
      async *promptStreaming() {
        yield 'parcial';
        controller.abort();
        throw new Error('abortado');
      },
    }));
    const res = await localChat(ask, { tier: 'prompt-api', signal: controller.signal });
    expect(res.text).toBe('parcial');
    expect(res.text).not.toContain(RULES_LABEL);
  });
});

describe('localInfer · AUI', () => {
  it('con solo reglas devuelve el mensaje de que hace falta IA local', async () => {
    const res = await localInfer('panel de mantenimiento', { tier: 'rules' });
    expect(res.via).toBe('rules');
    expect(res.error).toBe(RULES_NEEDS_LOCAL_AI);
    expect(res.spec).toBeUndefined();
  });

  it('si la Prompt API lanza, cae a reglas con el mismo mensaje', async () => {
    stubLanguageModel(async () => {
      throw new Error('boom');
    });
    const res = await localInfer('panel', { tier: 'prompt-api' });
    expect(res.via).toBe('rules');
    expect(res.error).toBe(RULES_NEEDS_LOCAL_AI);
  });

  it('parsea la spec JSON del modelo', async () => {
    stubLanguageModel(async () => ({
      promptStreaming: () => fromArray(['{"version":1,"components":[{"id":"c1","type":"Card","props":{}}]}']),
    }));
    const res = await localInfer('panel', { tier: 'prompt-api' });
    expect(res.via).toBe('prompt-api');
    expect(res.spec).toMatchObject({ version: 1 });
  });

  it('acepta la respuesta envuelta en un bloque de código', async () => {
    stubLanguageModel(async () => ({
      promptStreaming: () => fromArray(['```json\n{"version":1,"components":[]}\n```']),
    }));
    const res = await localInfer('panel', { tier: 'prompt-api' });
    expect(res.spec).toMatchObject({ version: 1 });
  });
});

describe('sin descargas silenciosas', () => {
  it('detectar y montar la tarjeta no cargan el motor de WebGPU', async () => {
    Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => null } });
    const tier = await detectLocalAi();
    expect(tier).toBe('webgpu');

    const app = mount(LocalAiConsent, { target: document.body, props: {} });
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    expect(mlc.CreateMLCEngine).not.toHaveBeenCalled();
    unmount(app);
  });
});
