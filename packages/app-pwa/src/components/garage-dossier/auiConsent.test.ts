// @vitest-environment jsdom
/**
 * auiConsent.test.ts — La AUI ofrece activar la IA local con la misma tarjeta que el
 * asistente cuando hay WebGPU (o Gemini Nano pendiente) sin motor autorizado; hasta
 * entonces dice que usa el motor de reglas.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AuiInterface from '../AuiInterface.svelte';
import { clearConsent, PROMPT_API_CONSENT_MODEL_ID, saveConsent, saveWebllmConsent } from '../../lib/localAi/consent';
import { DEFAULT_LOCAL_MODEL } from '../../lib/localAi/config';
import {
  disposeWebllmEngine,
  loadWebllmEngine,
  type WebllmEngine,
} from '../../lib/localAi/webllmEngine';

function stubGpu(): void {
  Object.defineProperty(globalThis.navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => null },
  });
}

async function mountAui() {
  const app = mount(AuiInterface, { target: document.body, props: {} });
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  return app;
}

afterEach(async () => {
  await disposeWebllmEngine();
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  Reflect.deleteProperty(globalThis.navigator, 'gpu');
  clearConsent();
  document.body.innerHTML = '';
});

describe('AuiInterface · consentimiento de IA local', () => {
  it('con WebGPU sin motor autorizado muestra la tarjeta y el aviso de reglas', async () => {
    stubGpu();
    const app = await mountAui();
    expect(document.body.querySelector('[data-testid="local-ai-consent"]')).not.toBeNull();
    const note = document.body.querySelector('[data-testid="aui-consent-note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('motor de reglas');
    unmount(app);
  });

  it('con motor autorizado y cargado no muestra la tarjeta', async () => {
    stubGpu();
    const engine: WebllmEngine = { chat: { completions: { create: async () => (async function* () {})() } } };
    await loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, createEngine: async () => engine });
    saveConsent(DEFAULT_LOCAL_MODEL);
    const app = await mountAui();
    expect(document.body.querySelector('[data-testid="local-ai-consent"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="aui-consent-note"]')).toBeNull();
    unmount(app);
  });

  it('Nano consentida + Prompt API no disponible + WebGPU usable → ofrece WebLLM', async () => {
    stubGpu();
    saveConsent(PROMPT_API_CONSENT_MODEL_ID);
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'unavailable',
    };
    const app = await mountAui();
    // La tarjeta SÍ se muestra (antes el consentimiento de Nano la ocultaba).
    expect(document.body.querySelector('[data-testid="local-ai-consent"]')).not.toBeNull();
    // Nano ya está autorizada: no se vuelve a ofrecer; WebLLM sí.
    expect(document.body.querySelector('[data-testid="local-ai-prompt-api-option"]')).toBeNull();
    expect(document.body.querySelector('fieldset.models')).not.toBeNull();
    unmount(app);
  });

  it('con WebLLM cargado y Nano descargable sin consentir → la tarjeta ofrece solo Nano', async () => {
    stubGpu();
    const engine: WebllmEngine = { chat: { completions: { create: async () => (async function* () {})() } } };
    await loadWebllmEngine({ modelId: DEFAULT_LOCAL_MODEL, createEngine: async () => engine });
    saveWebllmConsent(DEFAULT_LOCAL_MODEL);
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'downloadable',
    };
    const app = await mountAui();
    // La tarjeta SÍ se muestra (WebLLM ya está, pero Nano sigue sin autorizar).
    expect(document.body.querySelector('[data-testid="local-ai-consent"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="aui-consent-note"]')).not.toBeNull();
    // Solo la oferta de Nano: nada de WebLLM.
    expect(document.body.querySelector('[data-testid="local-ai-prompt-api-option"]')).not.toBeNull();
    expect(document.body.querySelector('fieldset.models')).toBeNull();
    unmount(app);
  });

  it('sin WebGPU + Prompt API downloadable → ofrece Nano sin WebLLM', async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'downloadable',
    };
    const app = await mountAui();
    // La tarjeta SÍ se muestra aunque no haya WebGPU (antes pedía tier webgpu).
    expect(document.body.querySelector('[data-testid="local-ai-consent"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="local-ai-prompt-api-option"]')).not.toBeNull();
    expect(document.body.querySelector('fieldset.models')).toBeNull();
    unmount(app);
  });
});
