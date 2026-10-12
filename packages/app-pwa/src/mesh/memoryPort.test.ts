import { MemoryTransport, TIPO_MENSAJE, createEnvelope } from './edgeMesh';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeshMessage } from './contracts';
import { MESH_ROOM_PREFIX } from './contracts';
import { namespaceFor, nodeIdFromPublicKey } from './engine';
import { createMemoryMeshPort, memoryRoomId } from './memoryPort';
import { sha256, toHex } from './sha256';

const flush = () => new Promise((r) => setTimeout(r, 25));
const ports: ReturnType<typeof createMemoryMeshPort>[] = [];
const mk = (o: Parameters<typeof createMemoryMeshPort>[0] = {}) => {
  const p = createMemoryMeshPort({ networkId: 't', ...o });
  ports.push(p);
  return p;
};
function collect(p: ReturnType<typeof mk>, net: 'v2v' | 'datos', topic: string) {
  const got: MeshMessage[] = [];
  p.subscribe(net, topic, (m) => got.push(m));
  return got;
}

afterEach(async () => {
  await Promise.all(ports.splice(0).map((p) => p.close()));
  MemoryTransport.resetAll();
});

describe('sha256', () => {
  it('coincide con los vectores conocidos', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(toHex(sha256(enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(enc('a'.repeat(1000))))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('createMemoryMeshPort', () => {
  it('dos y tres nodos se intercambian mensajes y se cuentan como pares', async () => {
    const [a, b, c] = [mk(), mk(), mk()];
    for (const p of [a, b, c]) await p.join('datos', 'bogota');
    const gb = collect(b, 'datos', 'oferta');
    const gc = collect(c, 'datos', 'oferta');
    const ga = collect(a, 'datos', 'oferta');
    expect(a.peerCount('datos', 'bogota')).toBe(2);

    await a.publish('datos', 'bogota', 'oferta', { sku: 'aceite', precio: 50 });
    await flush();
    expect(gb).toHaveLength(1);
    expect(gc).toHaveLength(1);
    expect(ga).toHaveLength(0); // no se oye a si mismo
    expect(gb[0]).toMatchObject({ network: 'datos', room: 'bogota', topic: 'oferta', from: a.nodeId, verified: false });
    expect(gb[0].payload).toEqual({ sku: 'aceite', precio: 50 });

    await c.publish('datos', 'bogota', 'oferta', { sku: 'filtro' });
    await flush();
    expect(gb).toHaveLength(2);
    expect(ga).toHaveLength(1);
  });

  it('el topic filtra y el desuscribir funciona', async () => {
    const [a, b] = [mk(), mk()];
    await a.join('v2v', 'r');
    await b.join('v2v', 'r');
    const got: unknown[] = [];
    const off = b.subscribe('v2v', 'x', (m) => got.push(m.payload));
    await a.publish('v2v', 'r', 'otro', 1);
    await a.publish('v2v', 'r', 'x', 2);
    await flush();
    off();
    await a.publish('v2v', 'r', 'x', 3);
    await flush();
    expect(got).toEqual([2]);
  });

  it('las redes, las salas y los universos estan aislados', async () => {
    const [a, b, c, d, e] = [mk(), mk(), mk(), mk(), mk({ networkId: 'otro' })];
    await a.join('v2v', 'sala');
    await b.join('datos', 'sala'); // misma sala, otra red
    await c.join('v2v', 'otra'); // otra sala
    await d.join('v2v', 'sala'); // el unico que debe oir
    await e.join('v2v', 'sala'); // otro universo
    const gb = collect(b, 'datos', 't');
    const gc = collect(c, 'v2v', 't');
    const gd = collect(d, 'v2v', 't');
    const ge = collect(e, 'v2v', 't');
    await a.publish('v2v', 'sala', 't', 'hola');
    await flush();
    expect(gd).toHaveLength(1);
    expect([gb.length, gc.length, ge.length]).toEqual([0, 0, 0]);
    expect(a.peerCount('v2v', 'sala')).toBe(1);
    expect(a.peerCount('datos', 'sala')).toBe(0);
  });

  it('publicar sin unirse falla; salir deja de recibir', async () => {
    const [a, b] = [mk(), mk()];
    await expect(a.publish('v2v', 'r', 't', 1)).rejects.toThrow(/no unido/);
    await a.join('v2v', 'r');
    await b.join('v2v', 'r');
    const got = collect(b, 'v2v', 't');
    await b.leave('v2v', 'r');
    await a.publish('v2v', 'r', 't', 1);
    await flush();
    expect(got).toHaveLength(0);
    expect(a.peerCount('v2v', 'r')).toBe(0);
  });

  it('un mensaje firmado llega con verified true y el id del emisor es el hash de su clave', async () => {
    const [a, b] = [mk(), mk()];
    await a.join('datos', 'r');
    await b.join('datos', 'r');
    const got = collect(b, 'datos', 'oferta');
    await a.publish('datos', 'r', 'oferta', { precio: 10 }, { sign: true });
    await a.publish('datos', 'r', 'oferta', { precio: 11 });
    await flush();
    expect(got.map((m) => [m.payload, m.verified])).toEqual([
      [{ precio: 10 }, true],
      [{ precio: 11 }, false],
    ]);
    expect(a.nodeId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('la identidad se puede fijar con el keypair serializado', () => {
    const a = mk();
    const a2 = mk({ keypair: a.exportKeypair() });
    expect(a2.nodeId).toBe(a.nodeId);
    expect(mk().nodeId).not.toBe(a.nodeId);
  });

  describe('trafico crudo (atacante en la sala)', () => {
    async function setup() {
      const [a, b] = [mk(), mk()];
      await a.join('datos', 'r');
      await b.join('datos', 'r');
      const room = memoryRoomId('t', namespaceFor('datos', 'r'));
      const spy = new MemoryTransport('espia', { roomId: room });
      const evil = new MemoryTransport('malo', { roomId: room });
      await spy.conectar();
      await evil.conectar();
      const captured: any[] = [];
      spy.on('mensaje', (ev) => captured.push(ev.detail.envolvente));
      return { a, b, spy, evil, captured, got: collect(b, 'datos', 'oferta') };
    }

    it('un mensaje firmado cabe en el canal JSON de PeerJS (< 16300 bytes)', async () => {
      const { a, captured } = await setup();
      await a.publish('datos', 'r', 'oferta', { precio: 10 }, { sign: true });
      await flush();
      expect(new TextEncoder().encode(JSON.stringify(captured[0])).length).toBeLessThan(16300);
    });

    it('un payload firmado y alterado se descarta', async () => {
      const { a, evil, captured, got } = await setup();
      await a.publish('datos', 'r', 'oferta', { precio: 10 }, { sign: true });
      await flush();
      expect(got).toHaveLength(1);
      const original = captured[0];
      const tampered = {
        ...original,
        id: `${original.id}-x`, // otro id para no caer en el dedup del transporte
        payload: { ...original.payload, p: { precio: 1 } },
      };
      await evil.transmitir(tampered);
      await flush();
      expect(got).toHaveLength(1); // la alterada no se entrego ni como no verificada
    });

    it('suplantar el id de otro nodo con una firma propia se descarta', async () => {
      const { a, b, evil, captured, got } = await setup();
      await a.publish('datos', 'r', 'oferta', { precio: 10 }, { sign: true });
      await flush();
      const original = captured[0];
      await evil.transmitir({ ...original, id: 'reenvio-1', origen: b.nodeId });
      await flush();
      expect(got).toHaveLength(1);
    });

    it('un mensaje con firma basura se descarta; sin firma llega como no verificado', async () => {
      const { evil, got } = await setup();
      const wire = { n: 'datos', r: 'r', t: 'oferta', p: 1, ts: Date.now() };
      await evil.transmitir({ ...createEnvelope(TIPO_MENSAJE.GOSSIP, 'malo', '*', wire), firma: new Uint8Array(3309) });
      await evil.transmitir(createEnvelope(TIPO_MENSAJE.GOSSIP, 'malo', '*', { ...wire, p: 2 }));
      await flush();
      expect(got.map((m) => [m.payload, m.verified])).toEqual([[2, false]]);
    });

    it('un mensaje que declara otra sala o red que la del transporte se descarta', async () => {
      const { evil, got } = await setup();
      const base = { t: 'oferta', p: 1, ts: Date.now() };
      await evil.transmitir(createEnvelope(TIPO_MENSAJE.GOSSIP, 'malo', '*', { ...base, n: 'datos', r: 'otra' }));
      await evil.transmitir(createEnvelope(TIPO_MENSAJE.GOSSIP, 'malo', '*', { ...base, n: 'v2v', r: 'r' }));
      await flush();
      expect(got).toHaveLength(0);
    });

    it('un mensaje duplicado (mismo id) se entrega una sola vez, tambien por otra via', async () => {
      const { a, b, evil, captured, got } = await setup();
      await a.publish('datos', 'r', 'oferta', { precio: 10 }, { sign: true });
      await flush();
      expect(got).toHaveLength(1);
      await evil.transmitir(captured[0]); // reenvio por otro transporte
      await b.receive('datos', 'r', captured[0]); // y directo al motor (sin dedup de transporte)
      await b.receive('datos', 'r', captured[0]);
      await flush();
      expect(got).toHaveLength(1);
    });

    it('la deduplicacion expira con la ventana', async () => {
      let t = 1_000_000;
      const a = mk({ now: () => t });
      const b = mk({ now: () => t, dedupWindowMs: 1000 });
      await a.join('datos', 'r');
      await b.join('datos', 'r');
      const got = collect(b, 'datos', 'x');
      await a.publish('datos', 'r', 'x', 1);
      await flush();
      const room = memoryRoomId('t', namespaceFor('datos', 'r'));
      const spy = new MemoryTransport('espia', { roomId: room });
      await spy.conectar();
      let env: any;
      spy.on('mensaje', (ev) => (env = ev.detail.envolvente));
      await a.publish('datos', 'r', 'x', 2);
      await flush();
      expect(got).toHaveLength(2);
      await b.receive('datos', 'r', env);
      expect(got).toHaveLength(2); // dentro de la ventana
      t += 2000;
      await b.receive('datos', 'r', env);
      expect(got).toHaveLength(3); // fuera de la ventana
    });
  });

  it('el TTL se aplica en la recepcion', async () => {
    const t0 = 5_000_000;
    let tb = t0;
    const a = mk({ now: () => t0 });
    const b = mk({ now: () => tb });
    await a.join('v2v', 'r');
    await b.join('v2v', 'r');
    const got = collect(b, 'v2v', 'peligro');
    tb = t0 + 500;
    await a.publish('v2v', 'r', 'peligro', 'vivo', { ttlMs: 1000 });
    tb = t0 + 5000;
    await a.publish('v2v', 'r', 'peligro', 'viejo', { ttlMs: 1000 });
    await a.publish('v2v', 'r', 'peligro', 'sin-ttl');
    await flush();
    expect(got.map((m) => m.payload)).toEqual(['vivo', 'sin-ttl']);
    tb = t0 + 600;
    await a.publish('v2v', 'r', 'peligro', 'fresco', { ttlMs: 1000 });
    await flush();
    expect(got.map((m) => m.payload)).toEqual(['vivo', 'sin-ttl', 'fresco']);
  });

  it('descarta un mensaje con ts del futuro (no venceria nunca)', async () => {
    const t0 = 5_000_000;
    let ta = t0;
    const a = mk({ now: () => ta });
    const b = mk({ now: () => t0 });
    await a.join('v2v', 'r');
    await b.join('v2v', 'r');
    const got = collect(b, 'v2v', 'peligro');
    ta = t0 + 10_000; // reloj adelantado 10 s: tolerado
    await a.publish('v2v', 'r', 'peligro', 'desfase', { ttlMs: 60_000 });
    ta = t0 + 3_600_000; // una hora en el futuro
    await a.publish('v2v', 'r', 'peligro', 'futuro', { ttlMs: 60_000 });
    await flush();
    expect(got.map((m) => m.payload)).toEqual(['desfase']);
  });

  it('los prefijos de sala son los del contrato', () => {
    expect(namespaceFor('v2v', 'x')).toBe(`${MESH_ROOM_PREFIX.v2v}x`);
    expect(namespaceFor('datos', 'x')).toBe(`${MESH_ROOM_PREFIX.datos}x`);
    expect(nodeIdFromPublicKey(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{32}$/);
  });
});
