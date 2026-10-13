// @vitest-environment jsdom
/**
 * tests/aui-error-states.test.ts — un fallo de la inferencia AI no se pinta como resultado.
 *
 * Antes, el `catch` de handleGenerate() llamaba a loadDefaultSpec() con cualquier error:
 * un 500 del Worker enseñaba la tabla de flota inventada (FL-01 Toyota Hilux, Carlos Mendez)
 * igual que una respuesta real, con solo un toast como rastro. Y Enter no miraba `loading`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AuiInterface from '../src/components/AuiInterface.svelte';
import { TIER_LABEL } from '../src/lib/domain.config';

let app: ReturnType<typeof mount> | undefined;

const tick = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

function setOnline(v: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
}

async function montar() {
  localStorage.setItem('gara_demo_socio', 'true');
  app = mount(AuiInterface as any, { target: document.body, props: {} });
  await tick();
  return {
    input: () => document.querySelector<HTMLInputElement>('#aui-prompt-input')!,
    canvas: () => document.querySelector('[data-testid="aui-rendered-content"]')!,
    alert: () => document.querySelector('[role="alert"]'),
    sample: () => document.querySelector('[data-testid="aui-sample-note"]'),
    async enviar(texto: string) {
      const i = this.input();
      i.value = texto;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
      document.querySelector<HTMLButtonElement>('[data-testid="aui-submit-btn"]')!.click();
      await tick();
    },
  };
}

beforeEach(() => {
  setOnline(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuiInterface: fallos de inferencia', () => {
  it('un 500 anuncia un error y NO pinta los datos de demo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const ui = await montar();
    await ui.enviar('flota en taller');
    expect(ui.alert()?.textContent).toContain('No se pudo generar la interfaz');
    expect(ui.canvas().textContent).not.toContain('FL-01');
    expect(ui.canvas().textContent).not.toContain('Carlos Méndez');
    expect(ui.sample()).toBeNull();
  });

  it('un 402 muestra el mensaje de cuota y tampoco hay datos de demo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 402 })));
    const ui = await montar();
    await ui.enviar('flota en taller');
    // El nombre del tier sale de domain.config.ts: ya no se nombra el tier heredado "Socio".
    expect(ui.alert()?.textContent).toContain(TIER_LABEL);
    expect(ui.alert()?.textContent).not.toContain('Socio');
    expect(document.body.textContent).not.toContain('FL-01');
  });

  it('una respuesta 200 sin spec es un fallo, no un lienzo mudo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const ui = await montar();
    await ui.enviar('flota en taller');
    expect(ui.alert()).not.toBeNull();
    expect(ui.canvas().textContent).not.toContain('FL-01');
  });

  it('sin red SI muestra el ejemplo local, pero marcado como no real', async () => {
    setOnline(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const ui = await montar();
    await ui.enviar('flota en taller');
    expect(ui.canvas().textContent).toContain('FL-01');
    expect(ui.sample()?.textContent).toContain('datos no reales');
    expect(ui.sample()?.getAttribute('role')).toBe('status');
    expect(ui.alert()).toBeNull();
  });

  it('el ejemplo inicial del socio tambien va marcado', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const ui = await montar();
    expect(ui.canvas().textContent).toContain('FL-01');
    expect(ui.sample()).not.toBeNull();
  });

  it('un fallo vacia el lienzo: el ejemplo inicial no reaparece solo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const ui = await montar();
    expect(ui.canvas().textContent).toContain('FL-01');
    await ui.enviar('x');
    await tick();
    expect(ui.canvas().textContent).not.toContain('FL-01');
  });

  it('Enter con una peticion en curso no lanza otra', async () => {
    let llamadas = 0;
    let soltar!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => {
      llamadas++;
      return new Promise<Response>((res) => { soltar = () => res(new Response('boom', { status: 500 })); });
    }));
    const ui = await montar();
    const i = ui.input();
    i.value = 'hola';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const enter = () => i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    enter();
    enter();
    await tick();
    expect(llamadas).toBe(1);
    soltar();
    await tick();
  });
});
