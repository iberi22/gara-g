// @vitest-environment jsdom
/**
 * localAi.test.ts — Cadena de respaldo de la IA local, consentimiento y cancelación.
 *
 * Reglas que fija esta suite:
 *  - Ninguna consulta descarga un modelo: sin motor YA cargado y autorizado, responden las
 *    reglas (y `@mlc-ai/web-llm` no se toca).
 *  - Una respuesta VACÍA es un fallo: se sigue con el siguiente motor y se acaba en reglas.
 *  - El motor cargado se reutiliza solo para el modelo autorizado: nunca se cambia a otro.
 *  - La Prompt API recibe la conversación completa, no solo la última pregunta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LocalAiConsent from '../../components/garage-dossier/LocalAiConsent.svelte';
import { detectLocalAi } from './capabilities';
import { DEFAULT_LOCAL_MODEL, LOW_MEMORY_LOCAL_MODEL } from './config';
import { clearConsent, hasPromptApiConsent, PROMPT_API_CONSENT_MODEL_ID, saveConsent } from './consent';
import { localChat, localInfer } from './index';
import { RULES_LABEL, RULES_NEEDS_LOCAL_AI, RULES_NO_MATCH } from './rules';
import type { PromptApiSession } from './promptApi';
import { disposeWebllmEngine, loadWebllmEngine, type WebllmChunk, type WebllmEngine } from './webllmEngine';
import type { ManualChunk } from '../../garage/assistant/manualText';

const mlc = vi.hoisted(() => ({ CreateWebWorkerMLCEngine: vi.fn() }));
vi.mock('@mlc-ai/web-llm', () => ({ CreateWebWorkerMLCEngine: mlc.CreateWebWorkerMLCEngine }));

const excerpts: ManualChunk[] = [
  { manual: 'Manual FZ', page: 42, text: 'Pares de apriete: tuerca del eje trasero 90 N·m.' },
];

async function* fromArray(values: string[]): AsyncGenerator<string> {
  for (const v of values) yield v;
}

interface FakeEngine {
  engine: WebllmEngine;
  create: ReturnType<typeof vi.fn>;
  interruptGenerate: ReturnType<typeof vi.fn>;
  unload: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function fakeEngine(chunks: WebllmChunk[] = [{ choices: [{ delta: { content: 'respuesta del modelo' } }] }]): FakeEngine {
  const create = vi.fn(async () =>
    (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
  );
  const interruptGenerate = vi.fn();
  const unload = vi.fn(async () => {});
  const dispose = vi.fn();
  const engine: WebllmEngine = { chat: { completions: { create } }, interruptGenerate, unload, dispose };
  return { engine, create, interruptGenerate, unload, dispose };
}

function stubLanguageModel(
  create: (options: unknown) => Promise<PromptApiSession>,
  state: string = 'available',
): void {
  (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => state, create };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await disposeWebllmEngine();
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  Reflect.deleteProperty(globalThis.navigator, 'gpu');
  mlc.CreateWebWorkerMLCEngine.mockReset();
  clearConsent();
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

  it('forzando reglas no toca ni la Prompt API ni WebLLM', async () => {
    const create = vi.fn(async () => ({ promptStreaming: () => fromArray(['x']) }));
    stubLanguageModel(create);
    const { engine } = fakeEngine();
    await localChat(ask, { tier: 'rules', excerpts, engine, modelId: DEFAULT_LOCAL_MODEL });
    expect(create).not.toHaveBeenCalled();
    expect(mlc.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
  });
});

describe('localChat · Prompt API', () => {
  it('envía la conversación completa y pregunta solo el último turno del usuario', async () => {
    const promptStreaming = vi.fn(() => fromArray(['Usa ', '10W-40']));
    let received: unknown;
    stubLanguageModel(async (options) => {
      received = options;
      return { promptStreaming };
    });
    const parts: string[] = [];
    const messages = [
      { role: 'system' as const, content: 'SISTEMA' },
      { role: 'user' as const, content: '¿Qué aceite?' },
      { role: 'assistant' as const, content: 'Chequea el manual.' },
      { role: 'user' as const, content: '¿Y el torque?' },
    ];
    const res = await localChat(messages, { tier: 'prompt-api', onToken: (t) => parts.push(t) });
    expect(res).toMatchObject({ via: 'prompt-api', model: 'gemini-nano' });
    expect((received as { initialPrompts: unknown }).initialPrompts).toEqual([
      { role: 'system', content: 'SISTEMA' },
      { role: 'user', content: '¿Qué aceite?' },
      { role: 'assistant', content: 'Chequea el manual.' },
    ]);
    expect(promptStreaming).toHaveBeenCalledWith('¿Y el torque?', { signal: undefined });
    expect(parts).toEqual(['Usa ', '10W-40']);
  });

  it('una respuesta vacía NO es un éxito: cae a las reglas', async () => {
    stubLanguageModel(async () => ({ promptStreaming: () => fromArray([]) }));
    const res = await localChat(ask, { tier: 'prompt-api', excerpts });
    expect(res.via).toBe('rules');
    expect(res.text).toContain(RULES_LABEL);
  });

  it('si la Prompt API lanza cae a las reglas', async () => {
    stubLanguageModel(async () => {
      throw new Error('sin permiso');
    });
    const res = await localChat(ask, { tier: 'prompt-api', excerpts });
    expect(res.via).toBe('rules');
    expect(res.text).toContain(RULES_LABEL);
  });

  it('si la Prompt API falla, todavía se intenta el motor WebGPU ya cargado', async () => {
    stubLanguageModel(async () => {
      throw new Error('boom');
    });
    const { engine, create } = fakeEngine([{ choices: [{ delta: { content: 'respuesta webgpu' } }] }]);
    const res = await localChat(ask, {
      tier: 'prompt-api',
      engine,
      modelId: DEFAULT_LOCAL_MODEL,
      excerpts,
    });
    expect(res.via).toBe('webgpu');
    expect(res.text).toBe('respuesta webgpu');
    expect(create).toHaveBeenCalledWith({ messages: ask, stream: true });
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

describe('localChat · WebLLM', () => {
  it('usa el motor YA cargado y autorizado y reutiliza el modelo aceptado', async () => {
    const { engine, create } = fakeEngine();
    await loadWebllmEngine({ modelId: LOW_MEMORY_LOCAL_MODEL, createEngine: async () => engine });
    saveConsent(LOW_MEMORY_LOCAL_MODEL);

    const res = await localChat(ask, { tier: 'webgpu' });
    expect(res.via).toBe('webgpu');
    expect(res.model).toBe(LOW_MEMORY_LOCAL_MODEL);
    // Nunca se pasa `signal` a la petición: no existe en el contrato del paquete.
    expect(create).toHaveBeenCalledWith({ messages: ask, stream: true });
  });

  it('sin motor cargado no descarga nada: responden las reglas', async () => {
    saveConsent(DEFAULT_LOCAL_MODEL);
    const res = await localChat(ask, { tier: 'webgpu', excerpts });
    expect(res.via).toBe('rules');
    expect(res.text).toContain(RULES_LABEL);
    expect(mlc.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
  });

  it('nunca usa un motor cargado para OTRO modelo (no cambia el modelo a mitad de consulta)', async () => {
    const { engine, create } = fakeEngine();
    await loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, createEngine: async () => engine });
    // El usuario autorizó después el modelo pequeño, pero el cargado es el grande.
    saveConsent(LOW_MEMORY_LOCAL_MODEL);
    const res = await localChat(ask, { tier: 'webgpu', excerpts });
    expect(res.via).toBe('rules');
    expect(create).not.toHaveBeenCalled();
  });

  it('una respuesta vacía del motor cae a las reglas', async () => {
    const { engine } = fakeEngine([{ choices: [{ delta: {} }] }]);
    const res = await localChat(ask, {
      tier: 'webgpu',
      engine,
      modelId: DEFAULT_LOCAL_MODEL,
      excerpts,
    });
    expect(res.via).toBe('rules');
    expect(res.text).toContain(RULES_LABEL);
  });

  it('al abortar corta la generación con interruptGenerate y no añade reglas', async () => {
    const controller = new AbortController();
    const create = vi.fn(async () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'parcial' } }] };
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield { choices: [{ delta: { content: 'tarde' } }] };
      })(),
    );
    const interruptGenerate = vi.fn();
    const engine: WebllmEngine = { chat: { completions: { create } }, interruptGenerate };
    const parts: string[] = [];
    const res = await localChat(ask, {
      tier: 'webgpu',
      engine,
      modelId: DEFAULT_LOCAL_MODEL,
      signal: controller.signal,
      excerpts,
      onToken: (t) => parts.push(t),
    });
    expect(interruptGenerate).toHaveBeenCalled();
    expect(res.text).toBe('parcial');
    expect(res.text).not.toContain(RULES_LABEL);
    expect(parts).toEqual(['parcial']);
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

  it('usa el motor WebGPU cargado sin descargar nada', async () => {
    const { engine, create } = fakeEngine([
      { choices: [{ delta: { content: '{"version":1,"components":[]}' } }] },
    ]);
    const res = await localInfer('panel', { tier: 'webgpu', engine, modelId: DEFAULT_LOCAL_MODEL });
    expect(res.via).toBe('webgpu');
    expect(res.spec).toMatchObject({ version: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('sin descargas silenciosas', () => {
  it('detectar y montar la tarjeta no cargan el motor de WebGPU', async () => {
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
    const tier = await detectLocalAi();
    expect(tier).toBe('webgpu');

    const app = mount(LocalAiConsent, { target: document.body, props: {} });
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    expect(mlc.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
    unmount(app);
  });

  it('la consulta con WebGPU disponible pero sin consentimiento no descarga', async () => {
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
    const res = await localChat(ask, { excerpts });
    expect(res.via).toBe('rules');
    expect(mlc.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
  });
});

describe('localChat · consentimiento de la descarga de Gemini Nano', () => {
  it('downloadable sin consentimiento: reglas y create() nunca se llama', async () => {
    const create = vi.fn(async () => ({ promptStreaming: () => fromArray(['x']) }));
    stubLanguageModel(create, 'downloadable');
    const resets: number[] = [];
    const res = await localChat(ask, {
      tier: 'prompt-api',
      excerpts,
      onReset: () => resets.push(1),
    });
    expect(create).not.toHaveBeenCalled();
    expect(res.via).toBe('rules');
    expect(res.text).toContain(RULES_LABEL);
    expect(resets).toHaveLength(0);
  });

  it('downloadable sin consentimiento tampoco se usa con el nivel detectado', async () => {
    const create = vi.fn(async () => ({ promptStreaming: () => fromArray(['x']) }));
    stubLanguageModel(create, 'downloading');
    expect(await detectLocalAi()).toBe('rules');
    const res = await localChat(ask, { excerpts });
    expect(create).not.toHaveBeenCalled();
    expect(res.via).toBe('rules');
  });

  it('downloadable CON consentimiento: la Prompt API responde', async () => {
    saveConsent(PROMPT_API_CONSENT_MODEL_ID);
    const create = vi.fn(async () => ({ promptStreaming: () => fromArray(['Usa ', '10W-40']) }));
    stubLanguageModel(create, 'downloadable');
    expect(await detectLocalAi()).toBe('prompt-api');
    const res = await localChat(ask, { excerpts });
    expect(create).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ via: 'prompt-api', model: 'gemini-nano', text: 'Usa 10W-40' });
  });

  it('localInfer downloadable sin consentimiento: reglas y create() nunca se llama', async () => {
    const create = vi.fn(async () => ({ promptStreaming: () => fromArray(['{"version":1}']) }));
    stubLanguageModel(create, 'downloadable');
    const res = await localInfer('panel', { tier: 'prompt-api' });
    expect(create).not.toHaveBeenCalled();
    expect(res.via).toBe('rules');
    expect(res.error).toBe(RULES_NEEDS_LOCAL_AI);
  });
});

describe('LocalAiConsent · opción de Gemini Nano', () => {
  async function mountConsent(props: Record<string, unknown> = {}) {
    const app = mount(LocalAiConsent, { target: document.body, props });
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    return app;
  }

  const nanoOption = () => document.body.querySelector('[data-testid="local-ai-prompt-api-option"]');

  it('sin Prompt API descargable no ofrece Nano', async () => {
    const app = await mountConsent();
    expect(nanoOption()).toBeNull();
    unmount(app);
  });

  it('con Prompt API downloadable ofrece autorizar Nano y lo persiste', async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'downloadable',
      create: vi.fn(),
    };
    const accepted: string[] = [];
    const app = await mountConsent({ onAccept: (id: string) => accepted.push(id) });
    const option = nanoOption();
    expect(option).not.toBeNull();
    const button = option?.querySelector('button');
    expect(button?.textContent).toContain('Gemini Nano');
    button?.click();
    flushSync();
    expect(accepted).toEqual([PROMPT_API_CONSENT_MODEL_ID]);
    expect(hasPromptApiConsent()).toBe(true);
    unmount(app);
  });
});

describe('localChat · fallo a mitad del stream', () => {
  it('la Prompt API que falla tras el parcial: onReset, parcial descartado y reglas', async () => {
    const parts: string[] = [];
    const resets: number[] = [];
    stubLanguageModel(async () => ({
      async *promptStreaming() {
        yield 'parcial de nano';
        throw new Error('corte a mitad');
      },
    }));
    const res = await localChat(ask, {
      tier: 'prompt-api',
      excerpts,
      onToken: (t) => parts.push(t),
      onReset: () => resets.push(1),
    });
    expect(resets).toHaveLength(1);
    expect(res.via).toBe('rules');
    expect(res.text).not.toContain('parcial de nano');
    expect(res.text).toContain(RULES_LABEL);
    expect(res.cancelled).not.toBe(true);
  });

  it('tras el fallo de la Prompt API se sigue con el WebGPU ya cargado', async () => {
    stubLanguageModel(async () => ({
      async *promptStreaming() {
        yield 'parcial de nano';
        throw new Error('corte a mitad');
      },
    }));
    const { engine } = fakeEngine([{ choices: [{ delta: { content: 'respuesta webgpu' } }] }]);
    const resets: number[] = [];
    const res = await localChat(ask, {
      tier: 'prompt-api',
      engine,
      modelId: DEFAULT_LOCAL_MODEL,
      excerpts,
      onReset: () => resets.push(1),
    });
    expect(resets).toHaveLength(1);
    expect(res.via).toBe('webgpu');
    expect(res.text).toBe('respuesta webgpu');
  });

  it('WebLLM que falla a mitad: onReset y reglas sin el parcial', async () => {
    const create = vi.fn(async () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'parcial web' } }] };
        throw new Error('corte del motor');
      })(),
    );
    const engine: WebllmEngine = { chat: { completions: { create } } };
    const resets: number[] = [];
    const res = await localChat(ask, {
      tier: 'webgpu',
      engine,
      modelId: DEFAULT_LOCAL_MODEL,
      excerpts,
      onReset: () => resets.push(1),
    });
    expect(resets).toHaveLength(1);
    expect(res.via).toBe('rules');
    expect(res.text).not.toContain('parcial web');
    expect(res.text).toContain(RULES_LABEL);
  });

  it('la cancelación del usuario conserva el parcial, marca cancelled y detiene la cadena', async () => {
    const controller = new AbortController();
    stubLanguageModel(async () => ({
      async *promptStreaming() {
        yield 'parcial';
        controller.abort();
        throw new Error('abortado');
      },
    }));
    const { engine, create } = fakeEngine([{ choices: [{ delta: { content: 'webgpu' } }] }]);
    const resets: number[] = [];
    const res = await localChat(ask, {
      tier: 'prompt-api',
      engine,
      modelId: DEFAULT_LOCAL_MODEL,
      signal: controller.signal,
      excerpts,
      onReset: () => resets.push(1),
    });
    expect(res.text).toBe('parcial');
    expect(res.cancelled).toBe(true);
    expect(res.text).not.toContain(RULES_LABEL);
    // La cadena se detiene: el motor siguiente ni se intenta y no hay reset.
    expect(create).not.toHaveBeenCalled();
    expect(resets).toHaveLength(0);
  });
});
