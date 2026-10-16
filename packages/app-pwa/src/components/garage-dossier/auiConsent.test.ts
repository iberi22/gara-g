// @vitest-environment jsdom
/**
 * auiConsent.test.ts — La AUI ofrece activar la IA local con la misma tarjeta que el
 * asistente cuando hay WebGPU (o Gemini Nano pendiente) sin motor autorizado; hasta
 * entonces dice que usa el motor de reglas.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AuiInterface from '../AuiInterface.svelte';
import { clearConsent, saveConsent } from '../../lib/localAi/consent';
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
});
