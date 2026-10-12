import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isBluetoothSupported,
  parseELM327Response,
  ELM327Adapter,
  OBD2Simulator,
} from './obd2.js';
import { TelemetryIngestManager } from './telemetry.js';

describe('OBD2 Web Bluetooth & Simulator Unit Tests', () => {
  let ingestManager: TelemetryIngestManager;

  beforeEach(() => {
    ingestManager = new TelemetryIngestManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isBluetoothSupported', () => {
    /**
     * Sustituye `globalThis.navigator` sin asumir que se puede asignar.
     *
     * En Node >= 21 `navigator` es un accesor con SOLO getter: `globalThis.navigator = x`
     * lanza "Cannot set property navigator ... which has only a getter". Los tests lo hacian
     * con `delete` + asignacion, asi que el segundo test del grupo pasaba porque el primero
     * ya habia borrado el accesor y dejado una propiedad plana writable: el resultado dependia
     * del orden de ejecucion (y de la version de Node). `defineProperty` no depende de nada
     * de eso y restaura el descriptor original.
     */
    const withNavigator = <T>(value: unknown, fn: () => T): T => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      if (value === undefined) {
        Reflect.deleteProperty(globalThis, 'navigator');
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          value,
          configurable: true,
          writable: true,
          enumerable: true,
        });
      }
      try {
        return fn();
      } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else Reflect.deleteProperty(globalThis, 'navigator');
      }
    };

    it('1. returns false when window/navigator or bluetooth is undefined', () => {
      withNavigator(undefined, () => {
        expect(isBluetoothSupported()).toBe(false);
      });
    });

    it('2. returns true when navigator.bluetooth exists', () => {
      withNavigator({ bluetooth: {} }, () => {
        expect(isBluetoothSupported()).toBe(true);
      });
    });

    it('2b. sustituye navigator aunque el global sea un accesor de solo getter (Node >= 21)', () => {
      // Lo que Node >= 21 trae de fabrica: `navigator` con getter y sin setter, donde
      // `globalThis.navigator = x` lanza. Se ejercita esa ruta del helper y se deja el global
      // exactamente como estaba (el helper tambien tiene que restaurar el accesor, no un valor).
      const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      try {
        Object.defineProperty(globalThis, 'navigator', { get: () => ({ bluetooth: {} }), configurable: true });
        expect(() => withNavigator({ bluetooth: {} }, () => {})).not.toThrow();
        withNavigator({ bluetooth: {} }, () => expect(isBluetoothSupported()).toBe(true));
        withNavigator(undefined, () => expect(isBluetoothSupported()).toBe(false));
        const restored = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        expect(typeof restored?.get).toBe('function');
        expect(restored?.set).toBeUndefined();
      } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else Reflect.deleteProperty(globalThis, 'navigator');
      }
    });
  });

  describe('parseELM327Response', () => {
    it('3. parses PID 0D Speed correctly', () => {
      // 41 0D 50 -> Hex 50 = 80 km/h
      const parsed = parseELM327Response('41 0D 50');
      expect(parsed.speed).toBe(80);
    });

    it('4. parses PID 0C Engine RPM correctly', () => {
      // 41 0C 1F A0 -> (31*256 + 160)/4 = 2024 RPM
      const parsed = parseELM327Response('41 0C 1F A0');
      expect(parsed.rpm).toBe(2024);
    });

    it('5. parses PID 05 Coolant Temp correctly', () => {
      // 41 05 82 -> 130 - 40 = 90 °C
      const parsed = parseELM327Response('41 05 82');
      expect(parsed.coolantTemp).toBe(90);
    });

    it('6. parses PID 2F Fuel Level correctly', () => {
      // 41 2F FF -> (255 * 100)/255 = 100%
      const parsed = parseELM327Response('41 2F FF');
      expect(parsed.fuelLevel).toBe(100);
    });

    it('7. handles malformed or error responses gracefully', () => {
      expect(parseELM327Response('NO DATA').speed).toBeUndefined();
      expect(parseELM327Response('UNABLE TO CONNECT').rpm).toBeUndefined();
      expect(parseELM327Response('ERROR').coolantTemp).toBeUndefined();
      expect(parseELM327Response('')).toEqual({ rawResponse: '' });
    });
  });

  describe('ELM327Adapter', () => {
    it('8. falls back safely when bluetooth is unsupported without throwing', async () => {
      const adapter = new ELM327Adapter('VIN-TEST-1', ingestManager);
      expect(adapter.getStatus()).toBe('unsupported');
      const result = await adapter.connect();
      expect(result).toBe(false);
      expect(adapter.isConnected()).toBe(false);
    });

    it('9. processes raw ELM data and triggers listeners & ingestion', () => {
      const adapter = new ELM327Adapter('VIN-TEST-1', ingestManager);
      let listenerCalled = false;
      adapter.onRecord((rec) => {
        listenerCalled = true;
        expect(rec.vin).toBe('VIN-TEST-1');
        expect(rec.speed).toBe(80);
      });

      const record = adapter.processRawData('41 0D 50');
      expect(listenerCalled).toBe(true);
      expect(record.speed).toBe(80);
      expect(ingestManager.getRecordCount()).toBe(1);
    });
  });

  describe('OBD2Simulator', () => {
    it('10. generates synthetic records and ingests them into TelemetryIngestManager', () => {
      const simulator = new OBD2Simulator({
        vin: 'SIM-TEST-99',
        ingestManager,
      });

      const record = simulator.generateRecord();
      expect(record.vin).toBe('SIM-TEST-99');
      expect(record.speed).toBeGreaterThanOrEqual(0);
      expect(record.rpm).toBeGreaterThanOrEqual(800);
      expect(ingestManager.getRecordCount()).toBe(1);
    });

    it('11. manages interval lifecycle properly on start and stop', () => {
      vi.useFakeTimers();
      let recordCount = 0;
      const simulator = new OBD2Simulator({
        vin: 'SIM-TEST-99',
        intervalMs: 1000,
        ingestManager,
        onRecord: () => {
          recordCount++;
        },
      });

      expect(simulator.isRunning()).toBe(false);
      simulator.start();
      expect(simulator.isRunning()).toBe(true);
      expect(recordCount).toBe(1); // Immediate initial record

      vi.advanceTimersByTime(2500);
      expect(recordCount).toBe(3); // Initial + 2 intervals

      simulator.stop();
      expect(simulator.isRunning()).toBe(false);

      vi.advanceTimersByTime(2000);
      expect(recordCount).toBe(3); // Stopped, no new records
      vi.useRealTimers();
    });
  });
});
