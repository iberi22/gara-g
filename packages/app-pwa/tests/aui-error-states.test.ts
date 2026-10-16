// @vitest-environment jsdom
/**
 * tests/aui-error-states.test.ts — un fallo de la inferencia NO se pinta como resultado.
 *
 * Con G3 la AUI genera con la IA local del navegador: sin Prompt API ni WebGPU solo hay
 * reglas deterministas, que no pueden componer una interfaz. La página debe decir en
 * español que hace falta la IA local y vaciar el lienzo, nunca dejar los datos de ejemplo
 * como si fueran la respuesta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AuiInterface from '../src/components/AuiInterface.svelte';
import { RULES_NEEDS_LOCAL_AI } from '../src/lib/localAi/rules';

let app: ReturnType<typeof mount> | undefined;

const tick = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

async function montar() {
  app = mount(AuiInterface, { target: document.body, props: {} });
  await tick();
  return {
    input: () => document.querySelector<HTMLInputElement>('#aui-prompt-input')!,
    canvas: () => document.querySelector('[data-testid="aui-rendered-content"]')!,
    alert: () => document.querySelector('[data-testid="aui-error"]'),
    sample: () => document.querySelector('[data-testid="aui-sample-note"]'),
    localAiNote: () => document.querySelector('[data-testid="aui-local-ai-note"]'),
    async escribir(texto: string) {
      const i = this.input();
      i.value = texto;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
    },
    async enviar(texto: string) {
      await this.escribir(texto);
      document.querySelector<HTMLButtonElement>('[data-testid="aui-submit-btn"]')!.click();
      await tick();
    },
    enter() {
      this.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  vi.restoreAllMocks();
});

describe('AuiInterface: IA local y fallos', () => {
  it('con solo reglas avisa de que hace falta IA local y no pinta datos de demo', async () => {
    const ui = await montar();
    await ui.enviar('flota en taller');
    expect(ui.alert()?.textContent).toContain(RULES_NEEDS_LOCAL_AI);
    expect(ui.canvas().textContent).not.toContain('FL-01');
    expect(ui.sample()).toBeNull();
    expect(ui.localAiNote()).not.toBeNull();
  });

  it('el ejemplo inicial va marcado como no real', async () => {
    const ui = await montar();
    expect(ui.canvas().textContent).toContain('FL-01');
    expect(ui.sample()?.textContent).toContain('datos no reales');
    expect(ui.sample()?.getAttribute('role')).toBe('status');
  });

  it('un fallo vacia el lienzo: el ejemplo inicial no reaparece solo', async () => {
    const ui = await montar();
    expect(ui.canvas().textContent).toContain('FL-01');
    await ui.enviar('x');
    await tick();
    expect(ui.canvas().textContent).not.toContain('FL-01');
    expect(ui.alert()).not.toBeNull();
  });

  it('sin pedido no genera ni falla', async () => {
    const ui = await montar();
    await ui.enviar('   ');
    expect(ui.alert()).toBeNull();
    expect(ui.canvas().textContent).toContain('FL-01');
  });

  it('Enter con una peticion en curso no lanza otra', async () => {
    let createCalls = 0;
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => {
        createCalls++;
        return {
          promptStreaming: () => (async function* () {
            await new Promise<void>(() => {});
          })(),
        };
      },
    };
    const ui = await montar();
    await ui.escribir('hola');
    ui.enter();
    ui.enter();
    await tick();
    expect(createCalls).toBe(1);
  });
});
