// @vitest-environment jsdom
/**
 * DriverTable — nombres accesibles de los botones de glifo (P0-9 / issue 08), error visible
 * y confirmaciones (issue 11), semantica de tabla (issue 09).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const dom = vi.hoisted(() => ({
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  updateEntity: vi.fn(),
  deleteEntity: vi.fn(),
}));
vi.mock('../src/lib/domain.js', () => dom);

import DriverTable from '../src/components/driver/DriverTable.svelte';

let app: ReturnType<typeof mount> | undefined;
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    flushSync();
    await tick();
    await Promise.resolve();
  }
};
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const ANA = { id: 'd1', name: 'Ana Ruiz', cedula: '123', licenseCategory: 'C1', licenseExpiry: '2099-01-01', phone: '', status: 'active', fleetId: 'f', vehicleId: 'v1' };

async function setup() {
  app = mount(DriverTable as any, { target: document.body, props: { instanceId: 't' } });
  await settle();
}

beforeEach(() => {
  dom.listEntities.mockReset().mockResolvedValue([ANA]);
  dom.createEntity.mockReset().mockResolvedValue({});
  dom.updateEntity.mockReset().mockResolvedValue({});
  dom.deleteEntity.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('DriverTable', () => {
  it('los tres botones de glifo tienen aria-label con el nombre del conductor y el glifo va oculto', async () => {
    await setup();
    const assign = q<HTMLButtonElement>('[data-testid="assign-vehicle-btn"]')!;
    expect(assign.getAttribute('aria-label')).toBe('Asignar vehículo a Ana Ruiz');
    expect(assign.querySelector('[aria-hidden="true"]')).not.toBeNull();
    assign.click();
    await settle();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].map((b) => b.getAttribute('aria-label'));
    expect(buttons).toContain('Guardar vehículo de Ana Ruiz');
    expect(buttons).toContain('Cancelar asignación de Ana Ruiz');
    // Ningun boton se queda sin nombre accesible
    for (const b of document.querySelectorAll('button')) {
      expect((b.getAttribute('aria-label') || b.textContent || '').replace(/[✓✕✏️\s]/g, '')).not.toBe('');
    }
  });

  it('enviar el formulario sin nombre muestra un error visible, no un return mudo', async () => {
    await setup();
    q<HTMLButtonElement>('[data-testid="add-driver-btn"]')!.click();
    await settle();
    q<HTMLFormElement>('[data-testid="driver-form"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const err = q('[data-testid="driver-form-error"]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('nombre');
    expect(dom.createEntity).not.toHaveBeenCalled();
  });

  it('doble envio: un segundo submit en vuelo no crea otro conductor', async () => {
    let release!: () => void;
    dom.createEntity.mockImplementation(() => new Promise<void>((r) => (release = r)));
    await setup();
    q<HTMLButtonElement>('[data-testid="add-driver-btn"]')!.click();
    await settle();
    for (const [tid, v] of [['input-name', 'Luis'], ['input-cedula', '55']] as const) {
      const el = q<HTMLInputElement>(`[data-testid="${tid}"]`)!;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const form = q<HTMLFormElement>('[data-testid="driver-form"] form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(dom.createEntity).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  it('Eliminar y Suspender piden confirmacion: cancelar no toca nada, aceptar si', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await setup();
    q<HTMLButtonElement>('[data-testid="delete-driver-btn"]')!.click();
    q<HTMLButtonElement>('[data-testid="suspend-driver-btn"]')!.click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(dom.deleteEntity).not.toHaveBeenCalled();
    expect(dom.updateEntity).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    q<HTMLButtonElement>('[data-testid="delete-driver-btn"]')!.click();
    q<HTMLButtonElement>('[data-testid="suspend-driver-btn"]')!.click();
    await settle();
    expect(dom.deleteEntity).toHaveBeenCalledWith('driver', 'd1', 't');
    expect(dom.updateEntity).toHaveBeenCalledWith('driver', 'd1', { status: 'suspended' }, 't');
  });

  it('cabeceras con scope="col" y caption', async () => {
    await setup();
    for (const th of document.querySelectorAll('th')) expect(th.getAttribute('scope')).toBe('col');
    expect(q('table caption')).not.toBeNull();
  });
});
