// @vitest-environment jsdom
/**
 * tests/geofence-map-keyboard.test.ts — wave-32/15: las geocercas se editan y se borran sin raton.
 *
 * Monta GeofenceMap de verdad (jsdom) y opera SOLO la lista de texto: botones "Editar <nombre>"
 * y "Eliminar <nombre>", con el fetch y el confirm() sustituidos. Antes de este cambio no habia
 * lista ni botones, y handleDeleteGeofence no tenia ningun llamador ni llegaba al servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import GeofenceMap from '../src/components/geofence/GeofenceMap.svelte';
import {
  createGeofenceRemote,
  deleteGeofenceRemote,
  geofenceToBody,
  updateGeofenceRemote,
} from '../src/components/geofence/geofenceApi.js';
import type { Geofence } from '../src/lib/geofence.js';

const gf = (id: string, name: string): Geofence => ({
  id,
  fleetId: 'fleet-001',
  name,
  type: 'depot',
  alertOnEnter: true,
  alertOnExit: false,
  vertices: [
    [4.7, -74.1],
    [4.6, -74.1],
    [4.6, -74],
  ],
  createdAt: 1,
  updatedAt: 1,
});

let app: ReturnType<typeof mount> | undefined;
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};
function setup(list: Geofence[], onGeofenceChange = vi.fn()) {
  app = mount(GeofenceMap as any, {
    target: document.body,
    props: { instanceId: 'tenant-x', fleetId: 'fleet-001', geofences: list, onGeofenceChange },
  });
  flushSync();
  return { onGeofenceChange };
}
const btn = (label: string) => document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const items = () => [...document.querySelectorAll('[data-testid="geofence-item"]')];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('GeofenceMap: lista operable con teclado', () => {
  it('cada geocerca es un <li> con botones Editar/Eliminar de nombre accesible contextual', () => {
    setup([gf('g1', 'Zona Norte'), gf('g2', 'Puerto Sur')]);
    expect(items()).toHaveLength(2);
    expect(btn('Editar Zona Norte')).not.toBeNull();
    expect(btn('Eliminar Puerto Sur')).not.toBeNull();
    // un <button> nativo: Enter/Espacio funcionan sin JS extra
    expect(btn('Editar Zona Norte')!.tagName).toBe('BUTTON');
  });

  it('Editar rellena el formulario con esa geocerca y anuncia el modo edicion', async () => {
    setup([gf('g1', 'Zona Norte'), gf('g2', 'Puerto Sur')]);
    btn('Editar Puerto Sur')!.click();
    await settle();
    expect((document.getElementById('geo-name') as HTMLInputElement).value).toBe('Puerto Sur');
    expect((document.getElementById('geo-type') as HTMLSelectElement).value).toBe('depot');
    expect((document.getElementById('geo-polygon') as HTMLTextAreaElement).value).toBe('4.7,-74.1 4.6,-74.1 4.6,-74');
    expect(document.querySelector('[data-testid="geofence-status"]')!.textContent).toContain('Puerto Sur');
    expect(document.activeElement?.id).toBe('geo-name');
  });

  it('Eliminar pide confirmacion: si se cancela no llama al servidor ni quita nada', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const { onGeofenceChange } = setup([gf('g1', 'Zona Norte')]);
    btn('Eliminar Zona Norte')!.click();
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Zona Norte'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(items()).toHaveLength(1);
    expect(onGeofenceChange).not.toHaveBeenCalled();
  });

  it('Eliminar confirmado hace DELETE /api/fleet/geofence?id=…&instanceId=… y solo entonces quita la fila', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const { onGeofenceChange } = setup([gf('g1', 'Zona Norte'), gf('g2', 'Puerto Sur')]);
    btn('Eliminar Zona Norte')!.click();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/fleet/geofence?id=g1&instanceId=tenant-x');
    expect(init.method).toBe('DELETE');
    expect(items().map((li) => li.textContent)).toEqual([expect.stringContaining('Puerto Sur')]);
    expect(onGeofenceChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="geofence-status"]')!.textContent).toContain('eliminada');
  });

  it('si el servidor rechaza el borrado la geocerca sigue en la lista y se avisa', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'x' }), { status: 403 }));
    setup([gf('g1', 'Zona Norte')]);
    btn('Eliminar Zona Norte')!.click();
    await settle();
    expect(items()).toHaveLength(1);
    expect(document.querySelector('[data-testid="geofence-status"]')!.textContent).toContain('permiso');
  });

  it('guardar una edicion hace PATCH con el id y el polygon como texto', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: 'g1', name: 'Zona Norte 2', type: 'depot', polygon: '4.7,-74.1 4.6,-74.1 4.6,-74' } }), { status: 200 }),
    );
    setup([gf('g1', 'Zona Norte')]);
    btn('Editar Zona Norte')!.click();
    await settle();
    const name = document.getElementById('geo-name') as HTMLInputElement;
    name.value = 'Zona Norte 2';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/fleet/geofence?id=g1&instanceId=tenant-x');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toMatchObject({ name: 'Zona Norte 2', polygon: '4.7,-74.1 4.6,-74.1 4.6,-74' });
    expect(items()[0].textContent).toContain('Zona Norte 2');
  });

  it('un fallo al guardar muestra un role=alert y no toca la lista', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    setup([gf('g1', 'Zona Norte')]);
    btn('Editar Zona Norte')!.click();
    await settle();
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const err = document.querySelector('[data-testid="geofence-form-error"]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('boom');
  });
});

describe('geofenceApi', () => {
  it('el cuerpo usa los campos de la entidad geofence (polygon como texto)', () => {
    expect(geofenceToBody({ ...gf('g', 'N'), vertices: [[1, 2], [3, 4], [5, 6]] })).toEqual({
      name: 'N',
      fleetId: 'fleet-001',
      type: 'depot',
      polygon: '1,2 3,4 5,6',
      alertOnEnter: true,
      alertOnExit: false,
    });
  });

  it('create/update/delete propagan el motivo del servidor (401, 403, 500)', async () => {
    const f = (status: number) => vi.fn(async () => new Response(JSON.stringify({ error: 'detalle' }), { status })) as any;
    await expect(deleteGeofenceRemote('g1', 't', f(401))).rejects.toThrow(/sesion/);
    await expect(deleteGeofenceRemote('g1', 't', f(403))).rejects.toThrow(/rol/);
    await expect(createGeofenceRemote(gf('g', 'N'), 't', f(500))).rejects.toThrow(/detalle/);
    await expect(updateGeofenceRemote('g', gf('g', 'N'), 't', f(500))).rejects.toThrow(/No se pudo guardar/);
  });
});
