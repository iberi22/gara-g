/**
 * api.test.ts — Pruebas unitarias para el cliente de API del Garage y degradación elegante.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SNAPSHOT } from '../../garage/mock';
import { GarageApiClient, SNAPSHOT_CACHE_KEY } from './api';

class LocalStorageMock {
  private store: Record<string, string> = {};

  clear() {
    this.store = {};
  }

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }
}

describe('GarageApiClient', () => {
  let client: GarageApiClient;
  const storageMock = new LocalStorageMock();

  beforeEach(() => {
    vi.stubGlobal('localStorage', storageMock);
    storageMock.clear();
    client = new GarageApiClient();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('llama a fetch siempre con credentials: same-origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_SNAPSHOT,
    });
    vi.stubGlobal('fetch', fetchMock);

    await client.getVehicles();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/garage/vehicles',
      expect.objectContaining({
        credentials: 'same-origin',
      }),
    );
  });

  it('redirige a /login?redirect=/fleet/garage cuando recibe 401 en la carga del snapshot', async () => {
    const locationMock = { href: '' };
    vi.stubGlobal('window', { location: locationMock });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }),
    );

    const result = await client.getVehicles();

    expect(locationMock.href).toBe('/login?redirect=/fleet/garage');
    expect(result.snapshot.vehicles).toEqual([]);
    expect(result.isOffline).toBe(false);
  });

  it('guarda en localStorage y marca isOffline=false cuando el backend responde 200 OK', async () => {
    const apiData = {
      vehicles: [
        {
          ...MOCK_SNAPSHOT.vehicles[0],
          id: 'veh-from-server',
          name: 'Servidor Live',
        },
      ],
      generatedAt: '2026-10-01T15:00:00Z',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => apiData,
      }),
    );

    const result = await client.getVehicles();
    expect(result.isOffline).toBe(false);
    expect(result.snapshot.vehicles[0].id).toBe('veh-from-server');

    const saved = storageMock.getItem(SNAPSHOT_CACHE_KEY);
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).vehicles[0].id).toBe('veh-from-server');
  });

  it('usa la caché de localStorage si la red falla (error de red o 5xx) y existía snapshot previo', async () => {
    const cachedSnapshot = {
      vehicles: [
        {
          ...MOCK_SNAPSHOT.vehicles[0],
          id: 'veh-from-cache',
          name: 'Moto en Caché',
        },
      ],
      generatedAt: '2026-09-01T00:00:00Z',
    };
    storageMock.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(cachedSnapshot));

    // Error 500 del servidor
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await client.getVehicles();
    expect(result.isOffline).toBe(true);
    expect(result.snapshot.vehicles[0].id).toBe('veh-from-cache');
    expect(result.snapshot.vehicles[0].name).toBe('Moto en Caché');
  });

  it('degrada a MOCK_SNAPSHOT únicamente cuando no hay caché ni red (demo/offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await client.getVehicles();
    expect(result.isOffline).toBe(true);
    expect(result.snapshot.vehicles.length).toBe(MOCK_SNAPSHOT.vehicles.length);
    expect(result.snapshot.vehicles[0].id).toBe(MOCK_SNAPSHOT.vehicles[0].id);
  });

  it('desenvuelve el sobre {ok, page|thread|post} de la wiki y el foro', async () => {
    const page = { versionKey: 'v1', version: { key: 'v1', make: 'Yamaha', model: 'FZ', label: 'Yamaha FZ' }, sections: [], revision: 3, updatedAt: '2026-10-02' };
    const reply = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal('fetch', reply({ ok: true, page }));
    expect((await client.getWiki('v1')).version.label).toBe('Yamaha FZ');
    expect((await client.updateWikiSection('v1', 's1', 'texto', 3)).revision).toBe(3);
    vi.stubGlobal('fetch', reply({ ok: true, thread: { id: 't1', title: 'Hilo' } }));
    expect((await client.createForumThread('v1', 'Hilo', 'cuerpo')).id).toBe('t1');
    vi.stubGlobal('fetch', reply({ ok: true, post: { id: 'p1', body: 'hola' } }));
    expect((await client.createForumPost('t1', 'hola')).id).toBe('p1');
    // Sin sobre tambien sirve (compatibilidad).
    vi.stubGlobal('fetch', reply(page));
    expect((await client.getWiki('v1')).revision).toBe(3);
  });

  it('devuelve estado vacío de paneles en respuesta 404 (no mock)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    // Wiki en 404 → secciones vacías
    const wiki = await client.getWiki('yamaha-fz16-2018-2024');
    expect(wiki.sections).toEqual([]);
    expect(wiki.revision).toBe(0);

    // Foro en 404 → sin hilos
    const threads = await client.getForumThreads('yamaha-fz16-2018-2024');
    expect(threads).toEqual([]);

    // Detalle de hilo en 404 → sin respuestas
    const threadDetail = await client.getForumThreadDetail('thread-non-existent');
    expect(threadDetail.posts).toEqual([]);

    // Shop en 404 → sin patrocinados ni posts
    const shop = await client.getShop();
    expect(shop.sponsored).toEqual([]);
    expect(shop.posts).toEqual([]);

    // Ads en 404 → array vacío
    const ads = await client.serveAd({ slot: 'shop_feed' });
    expect(ads).toEqual([]);

    // Detalle de vehículo en 404 → historial vacío
    const detail = await client.getVehicleDetail('veh-moto-1');
    expect(detail.history).toEqual([]);
  });

  it('telemetría: devuelve estado sin muestras en 404 (sin señal, sin valores ficticios)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const telemetry = await client.getTelemetry('VIN123');
    expect(telemetry.connected).toBe(false);
    expect(telemetry.latest).toBeUndefined();
    expect(telemetry.series).toEqual([]);
  });

  it('telemetría: muestra datos de ejemplo únicamente en modo offline/mock', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));

    // En estado online inicial, si falla por red sin estar marcado offline, no inventa
    client.isOffline = false;

    // Marcado explícito de offline tras fallo de getVehicles()
    await client.getVehicles();
    expect(client.isOffline).toBe(true);

    const telemetry = await client.getTelemetry('VIN123');
    expect(telemetry.latest).toBeDefined();
    expect(telemetry.latest?.speedKmh).toBe(42);
    expect(telemetry.latest?.rpm).toBe(3400);
  });

  it('permite registrar impresiones y genera url de clic con token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await client.recordImpression('test_tok_123');
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/garage/ads/impression',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'test_tok_123' }),
      }),
    );

    const clickUrl = client.getAdClickUrl('test_tok_123');
    expect(clickUrl).toBe('/api/garage/ads/click?t=test_tok_123');
  });
});
