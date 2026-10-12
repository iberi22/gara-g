// @vitest-environment jsdom
/**
 * tests/mercado-report-dialog.test.ts — "Reportar" de /fleet/mercado ya no usa window.prompt:
 * es un formulario en linea con radios, foco que entra y vuelve, Escape y objetivos de 44 px.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ReportDialog from '../src/components/mercado/ReportDialog.svelte';

let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

function abrir(extra: Record<string, unknown> = {}) {
  const trigger = document.createElement('button');
  trigger.textContent = 'Reportar';
  document.body.append(trigger);
  trigger.focus();
  const onsubmit = vi.fn();
  const oncancel = vi.fn();
  app = mount(ReportDialog as any, {
    target: document.body,
    props: { offerTitle: 'Aceite 20W50', returnFocusTo: trigger, onsubmit, oncancel, ...extra },
  });
  flushSync();
  return { trigger, onsubmit, oncancel };
}

describe('ReportDialog', () => {
  it('es un dialogo con nombre accesible, radios con grupo etiquetado y el foco entra al abrir', () => {
    abrir();
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-labelledby')).toBe('report-t');
    expect(document.getElementById('report-t')!.textContent).toContain('Aceite 20W50');
    expect(dlg.querySelector('fieldset > legend')!.textContent).toContain('¿Qué tiene mal');
    const radios = dlg.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.length).toBeGreaterThanOrEqual(4);
    radios.forEach((r) => expect(r.closest('label')).not.toBeNull());
    expect(dlg.querySelector('textarea')!.closest('label')!.textContent).toContain('opcional');
    expect(document.activeElement).toBe(radios[0]);
  });

  it('sin motivo no envia y anuncia el error', () => {
    const { onsubmit } = abrir();
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    flushSync();
    expect(onsubmit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Elige un motivo');
  });

  it('envia el motivo elegido mas el detalle opcional', () => {
    const { onsubmit } = abrir();
    const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1].click();
    flushSync();
    const ta = document.querySelector('textarea')!;
    ta.value = ' llegó dos veces ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(onsubmit).toHaveBeenCalledWith(`${radios[1].value}: llegó dos veces`);
  });

  it('Escape cancela', () => {
    const { oncancel } = abrir();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(oncancel).toHaveBeenCalledTimes(1);
  });

  it('al cerrar el foco vuelve al disparador', () => {
    const { trigger } = abrir();
    expect(document.activeElement).not.toBe(trigger);
    unmount(app!);
    app = undefined;
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Mercado sin window.prompt', () => {
  it('ningun componente de mercado llama a prompt()', () => {
    for (const f of ['MercadoApp', 'OfferCard', 'VenderApp', 'ConsentPanel']) {
      const src = readFileSync(join(__dirname, '..', 'src/components/mercado', `${f}.svelte`), 'utf8');
      expect(src, f).not.toMatch(/\bprompt\s*\(/);
    }
  });

  it('el CSS dimensiona botones y chips a 44 px', () => {
    const css = readFileSync(join(__dirname, '..', 'src/components/mercado/mercado.css'), 'utf8');
    expect(css).toMatch(/\.mk-btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.mk-chip \{[^}]*min-height: 44px/);
  });
});
