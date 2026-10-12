import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLatestTelemetryByVin,
  createLivePoller,
  type RawTelemetry,
  type RawVehicle,
} from './livePoll.js';

describe('livePoll helper unit tests', () => {
  const mockTelemetry: RawTelemetry[] = [
    {
      id: 't1',
      vin: 'VIN100',
      speed: 60,
      rpm: 2000,
      coolantTemp: 85,
      fuelLevel: 70,
      latitude: 4.6097,
      longitude: -74.0817,
      timestamp: 1000,
    },
    {
      id: 't2',
      vin: 'VIN100',
      speed: 80,
      rpm: 2500,
      coolantTemp: 90,
      fuelLevel: 68,
      latitude: 4.6150,
      longitude: -74.0850,
      timestamp: 2000, // Newer record for VIN100
    },
    {
      id: 't3',
      vin: 'VIN200',
      speed: 40,
      rpm: 1500,
      coolantTemp: 80,
      fuelLevel: 90,
      latitude: 4.7000,
      longitude: -74.0000,
      timestamp: 1500,
    },
  ];

  const mockVehicles: RawVehicle[] = [
    { vin: 'VIN100', plate: 'ABC-123' },
    { vin: 'VIN200', plate: 'XYZ-789' },
  ];

  it('aggregates latest telemetry per VIN with vehicle plate mapping', () => {
    const rows = getLatestTelemetryByVin(mockTelemetry, mockVehicles);
    expect(rows.length).toBe(2);

    const vin100 = rows.find((r) => r.vin === 'VIN100');
    expect(vin100).toBeDefined();
    expect(vin100?.speed).toBe(80);
    expect(vin100?.plate).toBe('ABC-123');
    expect(vin100?.formattedSpeed).toBe('80 km/h');
    expect(vin100?.formattedLat).toBe('4.6150');

    const vin200 = rows.find((r) => r.vin === 'VIN200');
    expect(vin200).toBeDefined();
    expect(vin200?.speed).toBe(40);
    expect(vin200?.plate).toBe('XYZ-789');
  });

  it('filters by VIN if specified', () => {
    const rows = getLatestTelemetryByVin(mockTelemetry, mockVehicles, 'vin100');
    expect(rows.length).toBe(1);
    expect(rows[0].vin).toBe('VIN100');
    expect(rows[0].speed).toBe(80);
  });

  describe('createLivePoller lifecycle', () => {
    /**
     * Limpieza compartida. `unstubAllGlobals` es la parte que arregla la fuga: el test de
     * "document hidden" deja `document.hidden = true` en un objeto colgado del global y, sin
     * restaurarlo, el siguiente test (de este fichero o de otro del mismo worker) arrancaba con
     * el documento "oculto", asi que `start()` no sondeaba nunca. El fallo dependia del orden:
     * solo aparecia con `--sequence.shuffle`.
     */
    const cleanup = () => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(cleanup);

    it('polls immediately on start and periodically at intervalMs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ vin: 'VIN100', speed: 88 }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const onUpdate = vi.fn();
      const poller = createLivePoller({
        fetchUrl: '/api/fleet/telemetry?recent=1',
        intervalMs: 5000,
        onUpdate,
      });

      poller.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith([{ vin: 'VIN100', speed: 88 }]);

      // Advance timer by 5 seconds
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      poller.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockFetch).toHaveBeenCalledTimes(2); // No new calls after stop
    });

    it('pauses polling when document is hidden', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      // Mock global document if node environment
      const doc = typeof document !== 'undefined' ? document : { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
      vi.stubGlobal('document', doc);

      const poller = createLivePoller({
        fetchUrl: '/api/fleet/telemetry?recent=1',
        intervalMs: 5000,
        onUpdate: () => {},
      });

      // Set document.hidden = true
      Object.defineProperty(doc, 'hidden', {
        configurable: true,
        get: () => true,
      });

      poller.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(poller.isPaused()).toBe(true);

      poller.stop();
    });

    it('la limpieza de afterEach deshace el stub de document: no se filtra al siguiente test', () => {
      // Sea cual sea el entorno (node, sin `document`; jsdom, con el suyo), la limpieza tiene
      // que devolver al global exactamente lo que habia antes del stub.
      const originalDoc = globalThis.document;
      vi.stubGlobal('document', { hidden: true, addEventListener: () => {}, removeEventListener: () => {} });
      expect(globalThis.document).not.toBe(originalDoc);
      cleanup();
      expect(globalThis.document).toBe(originalDoc);
    });
  });
});
