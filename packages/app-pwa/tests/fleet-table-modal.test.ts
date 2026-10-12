// @vitest-environment jsdom
/**
 * FleetTable — modal accesible, estados de carga/error, confirmacion de borrado y semantica de tabla.
 *
 * P0-6 (triage UX) + issues wave-32 09, 10, 11, 21. Monta el componente real en jsdom con un
 * YjsFleetManager de mentira, para controlar si IndexedDB responde o falla.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const state = vi.hoisted(() => ({
  initImpl: (() => Promise.resolve()) as () => Promise<void>,
  fleets: [] as any[],
  vehicles: [] as any[],
  deleteFleet: vi.fn(),
  createFleet: vi.fn(),
}));

vi.mock('../src/lib/yjsFleet.js', () => ({
  YjsFleetManager: class {
    initIndexedDB() {
      return state.initImpl();
    }
    listFleets() {
      return state.fleets;
    }
    listVehicles() {
      return state.vehicles;
    }
    subscribe() {
      return () => {};
    }
    createFleet = state.createFleet;
    updateFleet = vi.fn();
    deleteFleet = state.deleteFleet;
  },
}));

import FleetTable from '../src/components/fleet/FleetTable.svelte';

let app: ReturnType<typeof mount> | undefined;

async function setup() {
  app = mount(FleetTable as any, { target: document.body, props: {} });
  flushSync();
  await tick();
  await Promise.resolve();
  await tick();
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const press = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

beforeEach(() => {
  state.initImpl = () => Promise.resolve();
  state.fleets = [];
  state.vehicles = [];
  state.deleteFleet.mockReset();
  state.createFleet.mockReset();
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FleetTable — modal (P0-6)', () => {
  it('el dialogo se nombra con aria-labelledby apuntando a su titulo', async () => {
    await setup();
    q<HTMLButtonElement>('[data-testid="new-fleet-btn"]')!.click();
    flushSync();
    await tick();
    const dialog = q('[role="dialog"]')!;
    const id = dialog.getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('Nueva flota');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('al abrir, el foco entra al dialogo', async () => {
    await setup();
    const trigger = q<HTMLButtonElement>('[data-testid="new-fleet-btn"]')!;
    trigger.focus();
    trigger.click();
    flushSync();
    await tick();
    const dialog = q('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).id).toBe('fleet-name');
  });

  it('Tab y Shift+Tab ciclan dentro del dialogo (trampa de foco)', async () => {
    await setup();
    q<HTMLButtonElement>('[data-testid="new-fleet-btn"]')!.click();
    flushSync();
    await tick();
    const dialog = q('[role="dialog"]')!;
    const items = [...dialog.querySelectorAll<HTMLElement>('input, button')];
    const last = items[items.length - 1];
    last.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);

    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    items[0].dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('Escape cierra el dialogo y el foco vuelve al disparador', async () => {
    await setup();
    const trigger = q<HTMLButtonElement>('[data-testid="new-fleet-btn"]')!;
    trigger.focus();
    trigger.click();
    flushSync();
    await tick();
    press(document.activeElement!, 'Escape');
    flushSync();
    await tick();
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('al editar y cerrar, el foco vuelve al boton Editar de esa fila', async () => {
    state.fleets = [{ id: 'f1', name: 'Norte', organizationId: 'o', region: 'r', tags: [] }];
    await setup();
    const edit = q<HTMLButtonElement>('tbody button.btn-outline')!;
    edit.focus();
    edit.click();
    flushSync();
    await tick();
    press(document.activeElement!, 'Escape');
    flushSync();
    await tick();
    expect(document.activeElement).toBe(edit);
  });
});

describe('FleetTable — carga (issue 10)', () => {
  it('mientras IndexedDB no responde NO pinta el mensaje de vacio', async () => {
    state.initImpl = () => new Promise(() => {});
    await setup();
    expect(document.body.textContent).not.toContain('No hay flotas');
    expect(q('[data-testid="fleet-loading"]')).not.toBeNull();
  });

  it('si IndexedDB falla muestra un alert con reintento, no el vacio', async () => {
    state.initImpl = () => Promise.reject(new Error('quota'));
    await setup();
    const alert = q('[role="alert"]')!;
    expect(alert.textContent).toContain('No se pudieron cargar las flotas');
    expect(alert.textContent).toContain('quota');
    expect(document.body.textContent).not.toContain('No hay flotas');
    // Reintentar con IndexedDB recuperado: desaparece el error
    state.initImpl = () => Promise.resolve();
    alert.querySelector<HTMLButtonElement>('button')!.click();
    flushSync();
    await tick();
    await Promise.resolve();
    await tick();
    expect(q('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain('No hay flotas');
  });
});

describe('FleetTable — borrado con confirmacion (issue 11)', () => {
  beforeEach(() => {
    state.fleets = [{ id: 'f1', name: 'Norte', organizationId: 'o', region: 'r', tags: [] }];
    state.vehicles = [
      { id: 'v1', fleetId: 'f1' },
      { id: 'v2', fleetId: 'f1' },
    ];
  });

  it('si el usuario cancela, no se borra; el texto dice cuantos vehiculos quedan sin flota', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await setup();
    q<HTMLButtonElement>('tbody .btn-danger')!.click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0][0]).toContain('2 vehículos');
    expect(state.deleteFleet).not.toHaveBeenCalled();
  });

  it('si acepta, se borra', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await setup();
    q<HTMLButtonElement>('tbody .btn-danger')!.click();
    expect(state.deleteFleet).toHaveBeenCalledWith('f1');
  });
});

describe('FleetTable — tabla y textos (issues 09 y 21)', () => {
  it('todas las cabeceras llevan scope="col" y la tabla tiene caption', async () => {
    await setup();
    const ths = [...document.querySelectorAll('th')];
    expect(ths.length).toBe(6);
    for (const th of ths) expect(th.getAttribute('scope')).toBe('col');
    expect(q('table caption')).not.toBeNull();
  });

  it('el flex de acciones no va en un <td>', async () => {
    state.fleets = [{ id: 'f1', name: 'Norte', organizationId: 'o', region: 'r', tags: [] }];
    await setup();
    const td = q('td.actions-cell')!;
    expect(td.querySelector('.actions-group')).not.toBeNull();
  });

  it('la interfaz esta en espanol', async () => {
    state.fleets = [{ id: 'f1', name: 'Norte', organizationId: 'o', region: 'r', tags: [] }];
    await setup();
    const text = document.body.textContent!;
    expect(text).toContain('Flotas');
    expect(text).toContain('1 flota registrada');
    expect(text).toContain('Acciones');
    expect(text).toContain('Editar');
    expect(text).toContain('Eliminar');
    expect(text).not.toMatch(/\b(Fleets|registered fleets|Actions|Delete|Edit)\b/);
  });
});
