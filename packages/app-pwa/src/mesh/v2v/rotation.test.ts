import { describe, expect, it } from 'vitest';
import type { MeshMessage, MeshPort } from '../contracts';
import { LocalMeshHub } from '../localHub';
import { cellWithNeighbors, encodeGeohash, V2V_PRECISION } from '../geocell';
import { createMemoryMeshPort } from '../memoryPort';
import { createEphemeralIdSource, ID_ROTATE_MS } from './ephemeralId';
import { G } from './motion';
import { BEACON_TOPIC, Events, HAZARD_TOPIC, decodePacket, encodePacketB64, type V2VPacket } from './packet';
import { createV2VNode, type GeoFix, type GeoSource, type MotionSource } from './v2vNode';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Math.floor(1_800_000_000_000 / DAY) * DAY + 60_000; // 00:01 UTC
const O = { lat: 4.711, lon: -74.0721 };
const M = 111_320;
const flush = () => new Promise((r) => setTimeout(r, 0));

function geoFake() {
  let cb: ((f: GeoFix) => void) | null = null;
  const source: GeoSource = { watch: (on) => ((cb = on), () => {}) };
  return { source, fix: (n: number, kmh = 50, hd = 0) => cb?.({ lat: O.lat + n / M, lon: O.lon, accuracyM: 4, speedMps: kmh / 3.6, headingDeg: hd }) };
}
const motionFake = () => {
  let cb: ((a: number, b: number, c: number) => void) | null = null;
  const source: MotionSource = { async start(on) { cb = on; return { ok: true }; }, stop() {} };
  return { source, sample: (a: number, b: number, c: number) => cb?.(a, b, c) };
};

describe('rotacion del puerto con el id efimero', () => {
  async function setup() {
    let seeds = 0; // semilla distinta por dia, como la real
    const clock = { t: T0 };
    const hub = new LocalMeshHub(() => clock.t);
    const closed: string[] = [];
    const made: string[] = [];
    const portFactory = async (): Promise<MeshPort> => {
      const base = hub.createPort(`efimero-${made.length}`);
      made.push(base.nodeId);
      const close = base.close.bind(base);
      return Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
        close: async () => {
          closed.push(base.nodeId);
          await close();
        },
        // Los metodos de LocalPort usan `this` interno: se delega al original.
        join: base.join.bind(base), leave: base.leave.bind(base), publish: base.publish.bind(base),
        subscribe: base.subscribe.bind(base), peerCount: base.peerCount.bind(base), nodeId: base.nodeId,
      }) as MeshPort;
    };
    const geo = geoFake();
    const motion = motionFake();
    const node = createV2VNode({
      portFactory, now: () => clock.t, geo: geo.source, motion: motion.source,
      idSource: createEphemeralIdSource({ now: () => clock.t, randomBytes: (n) => new Uint8Array(n).fill(++seeds) }),
      schedule: () => () => {},
    });
    // Observador: ve `from` e id de cada baliza y peligro.
    const obs = hub.createPort('observador');
    const seen: { topic: string; from: string; id: number; verified: boolean }[] = [];
    for (const c of cellWithNeighbors(O.lat, O.lon, V2V_PRECISION)) await obs.join('v2v', c);
    for (const topic of [BEACON_TOPIC, HAZARD_TOPIC]) {
      obs.subscribe('v2v', topic, (m: MeshMessage) => {
        const r = decodePacket(m.payload, clock.t);
        if (r.ok) seen.push({ topic, from: m.from, id: r.packet.id, verified: m.verified });
      });
    }
    return { clock, hub, closed, made, node, geo, motion, seen };
  }

  async function beat(w: Awaited<ReturnType<typeof setup>>, advanceMs: number) {
    w.clock.t += advanceMs;
    w.geo.fix(0);
    await flush();
    await w.node.tick();
    await flush();
  }

  it('`from` y el id del paquete cambian juntos en cada ranura, y nunca se reutilizan', async () => {
    const w = await setup();
    await w.node.start();
    w.geo.fix(0);
    await flush();
    await w.node.tick();
    const slots = [] as { from: string; id: number }[];
    for (let i = 0; i < 4; i++) {
      await beat(w, ID_ROTATE_MS + 1_000);
      await beat(w, 1_000);
      const last = w.seen.filter((s) => s.topic === BEACON_TOPIC).at(-1)!;
      slots.push({ from: last.from, id: last.id });
    }
    expect(new Set(slots.map((s) => s.from)).size).toBe(4);
    expect(new Set(slots.map((s) => s.id)).size).toBe(4);
    // Cada `from` solo aparece con UN id (no hay ventana con el id viejo y el puerto nuevo, ni al reves).
    const pairs = new Map<string, Set<number>>();
    for (const s of w.seen) pairs.set(s.from, (pairs.get(s.from) ?? new Set()).add(s.id));
    for (const ids of pairs.values()) expect(ids.size).toBe(1);
    // Y ningun `from` es el identificador estable de nada: son los puertos desechables.
    for (const s of w.seen) expect(s.from).toMatch(/^efimero-\d+$/);
    expect(w.made.length).toBe(5);
  });

  it('en la rotacion se reunen las salas en el puerto nuevo y se cierra el viejo', async () => {
    const w = await setup();
    await w.node.start();
    w.geo.fix(0);
    await flush();
    const cells = cellWithNeighbors(O.lat, O.lon, V2V_PRECISION);
    for (const c of cells) expect([...w.hub.roomMembers('v2v', c)].some((p) => p.nodeId === 'efimero-0')).toBe(true);
    await beat(w, ID_ROTATE_MS + 1_000);
    expect(w.closed).toEqual(['efimero-0']);
    for (const c of cells) {
      const ids = [...w.hub.roomMembers('v2v', c)].map((p) => p.nodeId);
      expect(ids).toContain('efimero-1');
      expect(ids).not.toContain('efimero-0');
    }
    expect(w.node.getState().cell).toBe(encodeGeohash(O.lat, O.lon, V2V_PRECISION));
  });

  it('cruzar el limite del dia UTC tambien rota', async () => {
    const w = await setup();
    await w.node.start();
    await beat(w, 0);
    const before = w.seen.at(-1)!;
    await beat(w, DAY); // un dia despues
    await beat(w, 1_000);
    const after = w.seen.at(-1)!;
    expect(after.from).not.toBe(before.from);
    expect(after.id).not.toBe(before.id);
  });

  it('la tabla de vecinos sobrevive a nuestra rotacion; el vecino que rota aparece como otro y el viejo caduca', async () => {
    const w = await setup();
    const room = encodeGeohash(O.lat, O.lon, V2V_PRECISION);
    const nb = w.hub.createPort('vecino-a');
    await nb.join('v2v', room);
    const send = (id: number) => {
      const p: V2VPacket = { kind: 'beacon', id, ts: w.clock.t, latE6: Math.round((O.lat + 80 / M) * 1e6), lonE6: Math.round(O.lon * 1e6), speedCms: 1000, heading: 0, accuracyM: 4, vehicleClass: 'carro', events: 0 };
      return nb.publish('v2v', room, BEACON_TOPIC, encodePacketB64(p, w.clock.t));
    };
    await w.node.start();
    w.geo.fix(0);
    await flush();
    await send(0x111);
    expect(w.node.getState().nearby).toBe(1);
    // Rotamos nosotros: el vecino sigue ahi (si no caduco: mismo instante + 1 s).
    w.clock.t += ID_ROTATE_MS - 2_000 - (w.clock.t - T0);
    await send(0x111);
    await beat(w, 3_000); // cruza la ranura
    expect(w.closed).toContain('efimero-0');
    expect(w.node.getState().nearby).toBe(1);
    // El vecino rota: nuevo id => nuevo vecino; el viejo caduca a los 3,5 s.
    await send(0x222);
    expect(w.node.getState().nearby).toBe(2);
    await beat(w, 4_000);
    expect(w.node.getState().nearby).toBe(0);
  });

  it('un peligro despues de rotar sale firmado (verified) y con el `from` nuevo', async () => {
    const w = await setup();
    await w.node.start();
    w.geo.fix(0, 72);
    await flush();
    await beat(w, ID_ROTATE_MS + 1_000);
    for (let ms = 0; ms < 1000; ms += 20) {
      w.clock.t += 20;
      w.motion.sample(0, 0, G);
    }
    for (let ms = 0; ms < 1000; ms += 20) {
      w.clock.t += 20;
      w.motion.sample(0.6 * G, 0, G);
      if (ms === 900) w.geo.fix(15, 36);
    }
    await flush();
    const hz = w.seen.filter((s) => s.topic === HAZARD_TOPIC);
    expect(hz).toHaveLength(1);
    expect(hz[0].verified).toBe(true);
    expect(hz[0].from).toBe('efimero-1');
  });

  it('si la rotacion falla se reintenta, y pasada la gracia se deja de emitir en vez de seguir con el `from` viejo', async () => {
    const w = await setup();
    let fail = false;
    const geo = geoFake();
    const hub = new LocalMeshHub(() => w.clock.t);
    let n = 0;
    const node = createV2VNode({
      portFactory: async () => {
        if (fail) throw new Error('sin senalizacion');
        return hub.createPort(`e-${n++}`);
      },
      now: () => w.clock.t, geo: geo.source, motion: motionFake().source,
      idSource: createEphemeralIdSource({ now: () => w.clock.t, randomBytes: (k) => new Uint8Array(k).fill(3) }),
      schedule: () => () => {},
    });
    const obs = hub.createPort('obs');
    for (const c of cellWithNeighbors(O.lat, O.lon, V2V_PRECISION)) await obs.join('v2v', c);
    const froms: string[] = [];
    obs.subscribe('v2v', BEACON_TOPIC, (m) => froms.push(m.from));
    await node.start();
    geo.fix(0);
    await flush();
    await node.tick();
    expect(froms).toEqual(['e-0']);
    fail = true;
    w.clock.t += ID_ROTATE_MS + 1_000;
    geo.fix(0);
    await node.tick(); // primer intento: dentro de la gracia, aun emite con el viejo
    w.clock.t += 40_000;
    geo.fix(0);
    await node.tick();
    expect(froms.length).toBe(2);
    fail = false;
    await node.tick();
    expect(froms.at(-1)).toBe('e-1');
  });
});

describe('V2V sobre el motor real (createMemoryMeshPort)', () => {
  it('baliza y peligro firmado en base64 llegan, decodifican y el peligro es verified', async () => {
    const net = `v2v-${Math.random()}`;
    const mk = () => {
      const geo = geoFake();
      const node = createV2VNode({
        portFactory: async () => createMemoryMeshPort({ networkId: net }),
        geo: geo.source, motion: motionFake().source, schedule: () => () => {},
      });
      return { geo, node };
    };
    const a = mk();
    const b = mk();
    await a.node.start();
    await b.node.start();
    // Pasan por join/gossip reales: el fix de A se asienta antes de que B emita.
    a.geo.fix(0, 50, 0);
    b.geo.fix(60, 50, 0);
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(cond()).toBe(true);
    };
    await until(() => a.node.getState().cell !== null && b.node.getState().cell !== null);
    await b.node.tick();
    await until(() => a.node.getState().nearby === 1);
    expect(a.node.getState().neighbors[0].n).toBeGreaterThan(50);
    expect(a.node.getState().dropped.invalid).toBe(0);

    // Peligro firmado emitido por un tercero con el mismo motor.
    const room = encodeGeohash(O.lat, O.lon, V2V_PRECISION);
    const third = createMemoryMeshPort({ networkId: net });
    await third.join('v2v', room);
    const hz: V2VPacket = { kind: 'hazard', id: 0xabc, ts: Date.now(), latE6: Math.round((O.lat + 100 / M) * 1e6), lonE6: Math.round(O.lon * 1e6), speedCms: 0, heading: 0, accuracyM: 4, vehicleClass: 'carro', events: Events.CRASH };
    a.geo.fix(0, 72, 0);
    await third.publish('v2v', room, HAZARD_TOPIC, encodePacketB64(hz, Date.now()), { sign: true, ttlMs: 60_000 });
    await until(() => a.node.getState().hazards.length === 1);
    expect(a.node.getState().dropped.unverified).toBe(0);
    expect(a.node.getState().headline?.message).toBe('Choque adelante');
    await third.close();
    await a.node.stop();
    await b.node.stop();
  });
});
