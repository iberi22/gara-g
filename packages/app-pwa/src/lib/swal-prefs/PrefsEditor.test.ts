// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PrefsEditor from './PrefsEditor.svelte';
import { resolvePrefs } from './resolve';
import type { Preferences, PrefsSchema } from './schema';

const schema: PrefsSchema = {
  version: 1,
  modules: [
    { id: 'home', label: 'Inicio', group: 'A', default: true, required: true },
    { id: 'fuel', label: 'Combustible', group: 'A', default: true, help: 'Cargas' },
  ],
  panels: [
    {
      id: 'callouts',
      label: 'Llamadas',
      scope: 'Garage',
      default: true,
      options: [
        { id: 'max', label: 'Maximo', type: 'number', default: 6, min: 1, max: 12, step: 1 },
        { id: 'view', label: 'Vista', type: 'select', default: 'a', choices: [{ value: 'a', label: 'Uno' }, { value: 'b', label: 'Dos' }] },
        { id: 'on', label: 'Mostrar', type: 'toggle', default: true },
      ],
    },
    { id: 'off', label: 'Apagado', scope: 'Garage', default: false, options: [{ id: 'x', label: 'Opcion X', type: 'toggle', default: false }] },
  ],
};

let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

function setup(value: Preferences = resolvePrefs(schema, undefined)) {
  const onchange = vi.fn();
  const frozen = JSON.stringify(value);
  app = mount(PrefsEditor as any, { target: document.body, props: { schema, value, onchange } });
  flushSync();
  return { onchange, value, frozen };
}
const sw = (label: string) => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent?.includes(label))!;
  return document.getElementById(l.getAttribute('for')!) as HTMLInputElement;
};

describe('PrefsEditor', () => {
  it('toggling a module emits new prefs without mutating value', () => {
    const { onchange, value, frozen } = setup();
    const el = sw('Combustible');
    expect(el.getAttribute('role')).toBe('switch');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const out = onchange.mock.calls[0][0] as Preferences;
    expect(out.modules.fuel).toBe(false);
    expect(out).not.toBe(value);
    expect(JSON.stringify(value)).toBe(frozen);
  });

  it('required modules are locked and say so', () => {
    setup();
    expect(sw('Inicio').disabled).toBe(true);
    expect(sw('Inicio').checked).toBe(true);
    expect(document.body.textContent).toContain('Siempre visible');
  });

  it('select, number and toggle options emit', () => {
    const { onchange } = setup();
    const btn = [...document.querySelectorAll<HTMLButtonElement>('.segbtn')].find((b) => b.textContent === 'Dos')!;
    btn.click();
    expect((onchange.mock.calls[0][0] as Preferences).panels.callouts.options.view).toBe('b');

    const num = sw('Maximo');
    num.value = '99';
    num.dispatchEvent(new Event('change', { bubbles: true }));
    expect((onchange.mock.calls[1][0] as Preferences).panels.callouts.options.max).toBe(12);

    const tg = sw('Mostrar');
    tg.checked = false;
    tg.dispatchEvent(new Event('change', { bubbles: true }));
    expect((onchange.mock.calls[2][0] as Preferences).panels.callouts.options.on).toBe(false);
  });

  it('options of a disabled panel are disabled', () => {
    setup();
    expect(sw('Opcion X').disabled).toBe(true);
  });
});
