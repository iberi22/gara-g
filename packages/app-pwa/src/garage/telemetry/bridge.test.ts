/**
 * telemetry/bridge.test.ts — El contrato JS <-> Flutter: `window.GaraBridge`.
 *
 * Se prueba con un `window` real porque el puente ES un contrato con el WebView: si el
 * evento no sale con el nombre exacto (`gara:telemetry`) o el `detail` no trae la muestra
 * normalizada, la tira de monitoreo del HUD nunca se entera de lo que manda la APK.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_VERSION,
  NATIVE_CHANNEL,
  TELEMETRY_EVENT,
  installGarageBridge,
  isEmbedded,
  postToNative,
} from './bridge';
import { normalizeSample } from './ingest';

const VIN = '1HGCM82633A004352';

/** Stub minimo de la API de WebView que el bridge toca. */
function stubWindow({ ua = 'Mozilla/5.0', search = '' } = {}) {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  const win = {
    navigator: { userAgent: ua },
    location: { search },
    addEventListener: (type: string, cb: (e: Event) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    removeEventListener: (type: string, cb: (e: Event) => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== cb),
      );
    },
    dispatchEvent: (e: Event) => {
      for (const cb of listeners.get(e.type) ?? []) cb(e);
      return true;
    },
    CustomEvent: undefined as unknown,
    _listeners: listeners,
  };
  // CustomEvent con la forma que usa el bridge (type + detail).
  (win as unknown as { CustomEvent: unknown }).CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  vi.stubGlobal('window', win);
  return win;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installGarageBridge', () => {
  it('instala window.GaraBridge con version, pushTelemetry e isEmbedded', () => {
    const win = stubWindow();
    const bridge = installGarageBridge();
    expect(bridge.version).toBe(BRIDGE_VERSION);
    expect(typeof bridge.pushTelemetry).toBe('function');
    expect(typeof bridge.isEmbedded).toBe('function');
    expect((win as unknown as { GaraBridge?: unknown }).GaraBridge).toBeDefined();
  });

  it('es idempotente: instalarlo dos veces no duplica nada raro', () => {
    stubWindow();
    const a = installGarageBridge();
    const b = installGarageBridge();
    expect(b).toBeDefined();
    expect(a.version).toBe(b.version);
  });
});

describe('pushTelemetry: valida y emite gara:telemetry', () => {
  it('una muestra valida emite el evento con la muestra normalizada en detail', () => {
    const win = stubWindow();
    installGarageBridge();
    const received: unknown[] = [];
    (
      win as unknown as { addEventListener: (t: string, cb: (e: Event) => void) => void }
    ).addEventListener(TELEMETRY_EVENT, (e) => received.push((e as CustomEvent).detail));

    const res = (
      win as unknown as { GaraBridge: { pushTelemetry: (s: unknown) => { ok: boolean } } }
    ).GaraBridge.pushTelemetry({
      vin: VIN.toLowerCase(),
      ts: new Date().toISOString(),
      speedKmh: 42,
      rpm: 2300,
      dtc: ['p0420'],
      source: 'apk',
    });

    expect(res.ok).toBe(true);
    expect(received).toHaveLength(1);
    const detail = received[0] as { vin: string; rpm: number; dtc: string[] };
    expect(detail.vin).toBe(VIN);
    expect(detail.rpm).toBe(2300);
    expect(detail.dtc).toEqual(['P0420']);
  });

  it('una muestra invalida NO emite nada y devuelve el motivo', () => {
    const win = stubWindow();
    installGarageBridge();
    let count = 0;
    (win as unknown as { addEventListener: (t: string, cb: () => void) => void }).addEventListener(
      TELEMETRY_EVENT,
      () => {
        count += 1;
      },
    );

    const bridge = (
      win as unknown as {
        GaraBridge: { pushTelemetry: (s: unknown) => { ok: boolean; reason?: string } };
      }
    ).GaraBridge;

    expect(bridge.pushTelemetry({ vin: 'X' }).ok).toBe(false);
    expect(bridge.pushTelemetry({ vin: 'X' }).reason).toBe('vin_invalido');
    expect(bridge.pushTelemetry('basura').ok).toBe(false);
    expect(
      bridge.pushTelemetry({ vin: VIN, ts: new Date().toISOString(), speedKmh: 5000 }).ok,
    ).toBe(false);
    expect(count).toBe(0);
  });

  it('sella el ts que la APK no manda (en vivo vale el instante de recepcion)', () => {
    const win = stubWindow();
    installGarageBridge();
    const res = (
      win as unknown as {
        GaraBridge: { pushTelemetry: (s: unknown) => { ok: boolean; sample?: { ts?: string } } };
      }
    ).GaraBridge.pushTelemetry({ vin: VIN, speedKmh: 10 });

    expect(res.ok).toBe(true);
    expect(res.sample?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('no lanza nunca, incluso con basura', () => {
    stubWindow();
    installGarageBridge();
    const bridge = (window as unknown as { GaraBridge: { pushTelemetry: (s: unknown) => unknown } })
      .GaraBridge;
    for (const junk of [undefined, null, 42, [], {}, { vin: 123 }, { vin: VIN, ts: {} }]) {
      expect(() => bridge.pushTelemetry(junk)).not.toThrow();
    }
  });

  it('usa las MISMAS reglas que el servidor: una muestra que el POST rechazaria, aqui tambien', () => {
    stubWindow();
    installGarageBridge();
    const bridge = (
      window as unknown as { GaraBridge: { pushTelemetry: (s: unknown) => { ok: boolean } } }
    ).GaraBridge;
    const futuro = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(bridge.pushTelemetry({ vin: VIN, ts: futuro }).ok).toBe(false);
    expect(normalizeSample({ vin: VIN, ts: futuro }, Date.now()).ok).toBe(false);
  });
});

describe('isEmbedded', () => {
  it('true con el User-Agent de la APK', () => {
    stubWindow({ ua: 'Mozilla/5.0 GaraGApp/1.0' });
    expect(isEmbedded()).toBe(true);
  });
  it('true con ?embed=app', () => {
    stubWindow({ search: '?embed=app' });
    expect(isEmbedded()).toBe(true);
  });
  it('false en un navegador normal', () => {
    stubWindow({ ua: 'Mozilla/5.0', search: '?x=1' });
    expect(isEmbedded()).toBe(false);
  });
});

describe('postToNative: el canal JS de Flutter', () => {
  it('serializa a JSON por window.GaraNative.postMessage', () => {
    const win = stubWindow();
    const postMessage = vi.fn();
    (win as unknown as { GaraNative: unknown }).GaraNative = { postMessage };

    const ok = postToNative('part:focused', { slotId: 'brake_fl' });
    expect(ok).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = JSON.parse(postMessage.mock.calls[0][0] as string);
    expect(msg.type).toBe('part:focused');
    expect(msg.payload).toEqual({ slotId: 'brake_fl' });
    expect(msg.version).toBe(BRIDGE_VERSION);
  });

  it('sin canal (navegador normal) devuelve false y no rompe', () => {
    stubWindow();
    expect(postToNative('garage:ready')).toBe(false);
  });

  it('un canal roto devuelve false en vez de propagar la excepcion', () => {
    const win = stubWindow();
    (win as unknown as { GaraNative: unknown }).GaraNative = {
      postMessage: () => {
        throw new Error('canal destruido');
      },
    };
    expect(postToNative('garage:ready')).toBe(false);
  });

  it('instalar el puente avisa a la APK con garage:ready', () => {
    const win = stubWindow();
    const postMessage = vi.fn();
    (win as unknown as { GaraNative: unknown }).GaraNative = { postMessage };
    installGarageBridge();
    expect(JSON.parse(postMessage.mock.calls[0][0] as string).type).toBe('garage:ready');
  });
});

describe('nombres del contrato', () => {
  it('son los que documenta el docstring y usa el HUD', () => {
    expect(TELEMETRY_EVENT).toBe('gara:telemetry');
    expect(NATIVE_CHANNEL).toBe('GaraNative');
  });
});
