/**
 * tests/mesh-ice-client.test.ts — el cliente pide /api/mesh/ice una vez por sesion y pasa los
 * iceServers al transporte PeerJS (`config`); sin relay o con fallo no toca la config de PeerJS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getIceConfig, resetIceCache } from '../src/mesh/iceServers';
import { openPeerRoom, type PeerCtor } from '../src/mesh/node';

const TURN = [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }];
const okFetch = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => {
  resetIceCache();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('getIceConfig', () => {
  it('una sola peticion por sesion, cacheada hasta ~80% del ttl; despues refetch', async () => {
    const f = okFetch({ ok: true, iceServers: TURN, ttl: 3600, relay: true });
    expect(await getIceConfig(f)).toEqual({ iceServers: TURN });
    expect(await getIceConfig(f)).toEqual({ iceServers: TURN });
    await Promise.all([getIceConfig(f), getIceConfig(f)]);
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 3600 * 1000 * 0.79);
    await getIceConfig(f);
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 3600 * 1000 * 0.81);
    await getIceConfig(f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('peticiones concurrentes comparten un solo fetch', async () => {
    const f = okFetch({ iceServers: TURN, ttl: 3600, relay: true });
    await Promise.all([getIceConfig(f), getIceConfig(f), getIceConfig(f)]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('relay:false, error HTTP o red caida -> undefined (comportamiento actual)', async () => {
    expect(await getIceConfig(okFetch({ iceServers: [{ urls: 'stun:x' }], ttl: 3600, relay: false }))).toBeUndefined();
    resetIceCache();
    expect(await getIceConfig(okFetch({}, 500))).toBeUndefined();
    resetIceCache();
    expect(await getIceConfig(vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBeUndefined();
  });
});

describe('openPeerRoom (transporte PeerJS)', () => {
  function fakePeer() {
    const created: Array<Record<string, unknown>> = [];
    class P {
      constructor(_id: string, opts: Record<string, unknown>) {
        created.push(opts);
        queueMicrotask(() => this.h.conectado?.({ detail: { nodoId: _id } }));
      }
      h: Record<string, (ev: any) => void> = {};
      on(n: string, cb: (ev: any) => void) { this.h[n] = cb; }
      estaConectado() { return false; }
      obtenerConexiones() { return []; }
      conectarRemoto = async () => {};
      cerrar = async () => {};
    }
    return { P: P as unknown as PeerCtor, created };
  }

  it('pasa config.iceServers al transporte cuando hay relay', async () => {
    const { P, created } = fakePeer();
    const t = await openPeerRoom(P, 'https://0.peerjs.com/', 'ns', 'node1', { iceServers: TURN });
    expect(created[0].config).toEqual({ iceServers: TURN });
    await t.cerrar();
  });

  it('sin relay no pasa config (PeerJS conserva su STUN por defecto)', async () => {
    const { P, created } = fakePeer();
    const t = await openPeerRoom(P, 'https://0.peerjs.com/', 'ns', 'node1');
    expect('config' in created[0]).toBe(false);
    await t.cerrar();
  });
});
