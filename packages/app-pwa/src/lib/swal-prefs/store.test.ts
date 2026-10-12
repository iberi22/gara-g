// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrefsStore, PREFS_EVENT } from './store';
import type { PrefsSchema } from './schema';

const schema: PrefsSchema = {
  version: 1,
  modules: [{ id: 'maps', label: 'Mapas', group: 'A', default: true }],
  panels: [{ id: 'chart', label: 'Grafico', scope: 'D', default: true }],
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('createPrefsStore', () => {
  beforeEach(() => localStorage.clear());

  it('arranca desde localStorage y load() trae la version del servidor', async () => {
    localStorage.setItem('k', JSON.stringify({ version: 1, modules: { maps: false } }));
    const fetcher = vi.fn(async () => ok({ prefs: { version: 1, onboarded: true, modules: { maps: true } } }));
    const store = createPrefsStore({ schema, endpoint: '/api/prefs', storageKey: 'k', fetcher });
    expect(store.get().modules.maps).toBe(false);
    const seen: boolean[] = [];
    document.addEventListener(PREFS_EVENT, (e) => seen.push((e as CustomEvent).detail.modules.maps), { once: true });
    await store.load();
    expect(store.get().modules.maps).toBe(true);
    expect(store.get().onboarded).toBe(true);
    expect(seen).toEqual([true]);
    expect(JSON.parse(localStorage.getItem('k') as string).modules.maps).toBe(true);
  });

  it('save() envia PUT con las preferencias resueltas', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => ok({ prefs: JSON.parse(String(init?.body)).prefs }));
    const store = createPrefsStore({ schema, endpoint: '/api/prefs', storageKey: 'k', fetcher });
    const res = await store.save({ ...store.get(), onboarded: true, modules: { maps: false } });
    expect(res.ok).toBe(true);
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body)).prefs.modules).toEqual({ maps: false });
    expect(store.get().onboarded).toBe(true);
  });

  it('sin red guarda localmente y lo informa', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const store = createPrefsStore({ schema, endpoint: '/api/prefs', storageKey: 'k', fetcher });
    const res = await store.save({ ...store.get(), modules: { maps: false } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/este equipo/);
    expect(JSON.parse(localStorage.getItem('k') as string).modules.maps).toBe(false);
    await store.load();
    expect(store.get().modules.maps).toBe(false);
  });

  it('subscribe recibe cambios y se puede cancelar', async () => {
    const fetcher = vi.fn(async () => ok({ prefs: { version: 1, modules: { maps: false } } }));
    const store = createPrefsStore({ schema, endpoint: '/x', storageKey: 'k', fetcher });
    const fn = vi.fn();
    const off = store.subscribe(fn);
    await store.load();
    off();
    await store.load();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
