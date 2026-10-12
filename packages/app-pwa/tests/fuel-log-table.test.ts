// @vitest-environment jsdom
/**
 * FuelLogTable — un fallo de carga no es un estado vacio (issue 10), el envio no se duplica
 * (issue 11), la tabla tiene semantica (issue 09).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const dom = vi.hoisted(() => ({
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  deleteEntity: vi.fn(),
}));
vi.mock('../src/lib/domain', () => dom);

import FuelLogTable from '../src/components/fuel/FuelLogTable.svelte';

let app: ReturnType<typeof mount> | undefined;
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    flushSync();
    await tick();
    await Promise.resolve();
  }
};
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);

async function setup() {
  app = mount(FuelLogTable as any, { target: document.body, props: { instanceId: 't' } });
  await settle();
}
function fillForm() {
  const set = (id: string, v: string) => {
    const el = document.getElementById(id) as HTMLInputElement;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('vehicleId', 'V-1');
  set('driverId', 'D-1');
  set('km', '1000');
  set('gallons', '10');
  set('cost', '50000');
}

beforeEach(() => {
  dom.listEntities.mockReset().mockResolvedValue([]);
  dom.createEntity.mockReset();
  dom.deleteEntity.mockReset();
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

describe('FuelLogTable', () => {
  it('sin datos dice "No hay registros", sin alert', async () => {
    await setup();
    expect(document.body.textContent).toContain('No hay registros de combustible');
    expect(q('[data-testid="fuel-load-error"]')).toBeNull();
  });

  it('si la carga falla muestra un alert distinto del vacio, y Reintentar recarga', async () => {
    dom.listEntities.mockRejectedValueOnce(new Error('boom'));
    await setup();
    const alert = q('[data-testid="fuel-load-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('No se pudieron cargar');
    expect(document.body.textContent).not.toContain('No hay registros de combustible');

    q<HTMLButtonElement>('[data-testid="btn-retry-fuel"]')!.click();
    await settle();
    expect(dom.listEntities).toHaveBeenCalledTimes(2);
    expect(q('[data-testid="fuel-load-error"]')).toBeNull();
    expect(document.body.textContent).toContain('No hay registros de combustible');
  });

  it('doble envio: dos submit seguidos crean UN registro y el boton queda deshabilitado', async () => {
    let release!: () => void;
    dom.createEntity.mockImplementation(() => new Promise<void>((r) => (release = r)));
    await setup();
    fillForm();
    flushSync();
    const form = q<HTMLFormElement>('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(dom.createEntity).toHaveBeenCalledTimes(1);
    expect(q<HTMLButtonElement>('[data-testid="btn-submit-fuel"]')!.disabled).toBe(true);
    release();
    await settle();
    expect(q<HTMLButtonElement>('[data-testid="btn-submit-fuel"]')!.disabled).toBe(false);
  });

  it('las cabeceras llevan scope="col", hay caption y un solo nivel de titulo propio (sin h1)', async () => {
    await setup();
    const ths = [...document.querySelectorAll('th')];
    expect(ths.length).toBe(9);
    for (const th of ths) expect(th.getAttribute('scope')).toBe('col');
    expect(q('table caption')).not.toBeNull();
    expect(document.querySelectorAll('h1').length).toBe(0);
  });
});
