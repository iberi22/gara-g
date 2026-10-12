import { describe, expect, it } from 'vitest';
import type { MeshPort } from '../contracts';
import { LocalMeshHub } from '../localHub';
import { cellWithNeighbors, encodeGeohash, V2V_PRECISION } from '../geocell';
import { createEphemeralIdSource } from './ephemeralId';
import { G } from './motion';
import { BEACON_TOPIC, BEACON_TTL_MS, Events, HAZARD_TOPIC, HAZARD_TTL_MS, decodePacket, encodePacketB64, type V2VPacket } from './packet';
import { createV2VNode, LIMITS, type GeoFix, type GeoSource, type MotionSource, type V2VNode } from './v2vNode';

const NOW0 = 1_800_000_000_000;
const O = { lat: 4.711, lon: -74.0721 };
const M_LAT = 111_320;

function world() {
  const clock = { t: NOW0 };
  const hub = new LocalMeshHub(() => clock.t);
  return { clock, hub };
}

function fakeGeo() {
  let cb: ((f: GeoFix) => void) | null = null;
  let err: ((m: string) => void) | null = null;
  let watching = false;
  const source: GeoSource = {
    watch(onFix, onError) {
      cb = onFix;
      err = onError;
      watching = true;
      return () => {
        watching = false;
      };
    },
  };
  return {
    source,
    fix: (n: number, speedKmh: number, heading: number, acc = 4, e = 0) =>
      cb?.({ lat: O.lat + n / M_LAT, lon: O.lon + e / (M_LAT * Math.cos((O.lat * Math.PI) / 180)), accuracyM: acc, speedMps: speedKmh / 3.6, headingDeg: heading }),
    fail: (m: string) => err?.(m),
    get watching() {
      return watching;
    },
  };
}

function fakeMotion(result: { ok: boolean; reason?: string } = { ok: true }) {
  let cb: ((ax: number, ay: number, az: number) => void) | null = null;
  const source: MotionSource = {
    async start(on) {
      cb = on;
      return result;
    },
    stop() {
      cb = null;
    },
  };
  return { source, sample: (ax: number, ay: number, az: number) => cb?.(ax, ay, az), get active() { return cb !== null; } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeNode(w: ReturnType<typeof world>, id: string, seedByte: number, extra: Partial<Parameters<typeof createV2VNode>[0]> = {}) {
  const geo = fakeGeo();
  const motion = fakeMotion();
  const port = w.hub.createPort(id);
  const node = createV2VNode({
    port,
    now: () => w.clock.t,
    geo: geo.source,
    motion: motion.source,
    idSource: createEphemeralIdSource({ now: () => w.clock.t, randomBytes: (n) => new Uint8Array(n).fill(seedByte) }),
    schedule: () => () => {},
    ...extra,
  });
  return { node, geo, motion, port };
}

async function startAt(n: ReturnType<typeof makeNode>, north: number, speedKmh: number, heading: number, acc = 4) {
  await n.node.start({ vehicleClass: 'carro' });
  n.geo.fix(north, speedKmh, heading, acc);
  await flush();
}

async function step(w: ReturnType<typeof world>, nodes: V2VNode[], ms = 1000) {
  w.clock.t += ms;
  for (const n of nodes) await n.tick();
}

describe('V2VNode — dos vehiculos', () => {
  it('se ven de frente: el radar muestra el vecino y da peligro', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    const b = makeNode(w, 'B', 2);
    await startAt(a, 0, 60, 0);
    await startAt(b, 100, 60, 180);
    // Cada uno publica su baliza; los fixes se refrescan cada tick como lo haria el GPS.
    for (let i = 0; i < 2; i++) {
      w.clock.t += 500;
      a.geo.fix(0, 60, 0);
      b.geo.fix(100, 60, 180);
      await flush();
      await a.node.tick();
      await b.node.tick();
    }
    const sa = a.node.getState();
    expect(sa.status).toBe('active');
    expect(sa.nearby).toBe(1);
    expect(sa.neighbors[0].n).toBeGreaterThan(90);
    expect(sa.neighbors[0].level).toBe('peligro');
    expect(sa.level).toBe('peligro');
    expect(sa.headline?.message).toMatch(/de frente/);
    expect(b.node.getState().level).toBe('peligro');
  });

  it('dos coches que siguen el mismo carril a distancia segura: sin alerta y se cuentan como cercanos', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    const b = makeNode(w, 'B', 2);
    await startAt(a, 0, 60, 0);
    await startAt(b, 60, 60, 0);
    await step(w, [a.node, b.node], 200);
    const s = a.node.getState();
    expect(s.nearby).toBe(1);
    expect(s.level).toBe('none');
  });

  it('el vecino desaparece cuando deja de emitir (caduca a los 3,5 s)', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    const b = makeNode(w, 'B', 2);
    await startAt(a, 0, 60, 0);
    await startAt(b, 100, 60, 0);
    await step(w, [b.node], 100);
    expect(a.node.getState().nearby).toBe(1);
    w.clock.t += LIMITS.neighborTtlMs + 100;
    a.geo.fix(0, 60, 0);
    await a.node.tick();
    expect(a.node.getState().nearby).toBe(0);
  });

  it('la baliza viaja sin firmar, con ttl 3 s y solo con datos de movimiento (modo invitado)', async () => {
    const w = world();
    const sent: { topic: string; payload: unknown; opts: unknown }[] = [];
    const base = w.hub.createPort('nodo-identidad-edge-mesh');
    const spy: MeshPort = { ...base, nodeId: 'nodo-identidad-edge-mesh', join: base.join.bind(base), leave: base.leave.bind(base), subscribe: base.subscribe.bind(base), peerCount: base.peerCount.bind(base), close: base.close.bind(base),
      publish: async (net, room, topic, payload, opts) => { sent.push({ topic, payload, opts }); return base.publish(net, room, topic, payload, opts); } };
    const a = makeNode(w, 'ignored', 1, { port: spy });
    await startAt(a, 0, 50, 90);
    await a.node.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].topic).toBe(BEACON_TOPIC);
    expect(sent[0].opts).toEqual({ ttlMs: BEACON_TTL_MS });
    const r = decodePacket(sent[0].payload, w.clock.t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.packet).sort()).toEqual(['accuracyM', 'events', 'heading', 'id', 'kind', 'latE6', 'lonE6', 'speedCms', 'ts', 'vehicleClass']);
      expect(r.packet.id).toBe(a.node.getState().selfId);
      expect(r.packet.kind).toBe('beacon');
    }
    // El nodeId del puerto (identidad edge-mesh) no esta en el payload.
    const bytes = atob(String(sent[0].payload));
    expect(bytes).not.toContain('nodo-identidad');
  });

  it('no emite con GPS peor de 50 m, ni sin fix reciente', async () => {
    const w = world();
    const sent: string[] = [];
    const base = w.hub.createPort('A');
    const spy = { ...base, join: base.join.bind(base), leave: base.leave.bind(base), subscribe: base.subscribe.bind(base), peerCount: base.peerCount.bind(base), close: base.close.bind(base), nodeId: 'A',
      publish: async (...args: Parameters<MeshPort['publish']>) => { sent.push(args[2]); } } as MeshPort;
    const a = makeNode(w, 'x', 1, { port: spy });
    await startAt(a, 0, 50, 0, 80);
    await a.node.tick();
    expect(sent).toHaveLength(0);
    a.geo.fix(0, 50, 0, 5);
    await a.node.tick();
    expect(sent).toHaveLength(1);
    w.clock.t += LIMITS.fixMaxAgeMs + 500;
    await a.node.tick();
    expect(sent).toHaveLength(1);
  });

  it('no se oye a si mismo y detiene todo al parar (sale de las salas)', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 50, 0);
    await a.node.tick();
    expect(a.node.getState().nearby).toBe(0);
    const cells = cellWithNeighbors(O.lat, O.lon, V2V_PRECISION);
    for (const c of cells) expect(w.hub.roomMembers('v2v', c).size).toBe(1);
    await a.node.stop();
    for (const c of cells) expect(w.hub.roomMembers('v2v', c).size).toBe(0);
    expect(a.node.getState().status).toBe('idle');
    expect(a.geo.watching).toBe(false);
    expect(a.motion.active).toBe(false);
  });

  it('error de permiso de GPS => estado error con el mensaje', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await a.node.start();
    a.geo.fail('Permiso de ubicación denegado');
    expect(a.node.getState().status).toBe('error');
    expect(a.node.getState().error).toMatch(/denegado/);
  });

  it('sin sensor de movimiento el radar arranca igual y lo avisa', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1, { motion: fakeMotion({ ok: false, reason: 'Sin sensor' }).source });
    await startAt(a, 0, 50, 0);
    expect(a.node.getState().status).toBe('active');
    expect(a.node.getState().motionNote).toBe('Sin sensor');
  });
});

describe('V2VNode — entrada hostil', () => {
  function rogue(w: ReturnType<typeof world>, name = 'rogue') {
    const port = w.hub.createPort(name);
    const room = encodeGeohash(O.lat, O.lon, V2V_PRECISION);
    return {
      port,
      ready: port.join('v2v', room),
      beacon(id: number, ts: number, n = 80, extra: Partial<V2VPacket> = {}) {
        const p: V2VPacket = { kind: 'beacon', id, ts, latE6: Math.round((O.lat + n / M_LAT) * 1e6), lonE6: Math.round(O.lon * 1e6), speedCms: 1000, heading: 0, accuracyM: 4, vehicleClass: 'carro', events: 0, ...extra };
        return port.publish('v2v', room, p.kind === 'beacon' ? BEACON_TOPIC : HAZARD_TOPIC, encodePacketB64(p, w.clock.t), p.kind === 'hazard' ? { sign: true, ttlMs: HAZARD_TTL_MS } : { ttlMs: BEACON_TTL_MS });
      },
      raw(topic: string, payload: unknown, sign = false) {
        return port.publish('v2v', room, topic, payload, { sign });
      },
    };
  }

  it('un emisor que inunda (> 5 msg/s) se descarta y queda castigado; los honestos siguen', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 50, 0);
    const bad = rogue(w, 'flood');
    const good = rogue(w, 'good');
    await bad.ready;
    await good.ready;
    for (let i = 0; i < 30; i++) await bad.beacon(0x1000 + i, w.clock.t + i);
    const s = a.node.getState();
    expect(s.dropped.flood).toBe(25);
    expect(s.nearby).toBeLessThanOrEqual(5);
    // Un segundo despues sigue castigado (5 s) aunque mande uno solo.
    w.clock.t += 1500;
    await bad.beacon(0x2000, w.clock.t);
    expect(a.node.getState().dropped.flood).toBe(26);
    // Un vecino honesto, a 1 msg/s, pasa.
    await good.beacon(0x3000, w.clock.t);
    expect(a.node.getState().neighbors.some((x) => x.id === 0x3000)).toBe(true);
    // Pasado el castigo, vuelve a entrar.
    w.clock.t += 6_000;
    await bad.beacon(0x2001, w.clock.t);
    expect(a.node.getState().dropped.flood).toBe(26);
  });

  it('ruido binario, payload no binario o topic cruzado se cuenta como invalido y no rompe nada', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 50, 0);
    const r = rogue(w);
    await r.ready;
    await r.raw(BEACON_TOPIC, 'AAAA');
    await r.raw(BEACON_TOPIC, { lat: 4.7, lon: -74 });
    await r.raw(BEACON_TOPIC, 12345);
    // Un peligro enviado por el topic de balizas no vale.
    await r.raw(BEACON_TOPIC, encodePacketB64({ kind: 'hazard', id: 7, ts: w.clock.t, latE6: 4711000, lonE6: -74072100, speedCms: 0, heading: 0, accuracyM: 4, vehicleClass: 'carro', events: Events.CRASH }, w.clock.t));
    expect(a.node.getState().dropped.invalid).toBe(4);
    expect(a.node.getState().nearby).toBe(0);
  });

  it('un ts en el futuro (> 5 s) se rechaza', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 50, 0);
    const r = rogue(w);
    await r.ready;
    const p: V2VPacket = { kind: 'beacon', id: 5, ts: w.clock.t + 1_000, latE6: 4711000, lonE6: -74072100, speedCms: 0, heading: 0, accuracyM: 4, vehicleClass: 'carro', events: 0 };
    const b64 = encodePacketB64(p, w.clock.t);
    w.clock.t -= 10_000; // el receptor ve el paquete 11 s en el futuro
    await r.raw(BEACON_TOPIC, b64);
    expect(a.node.getState().dropped.invalid).toBe(1);
  });

  it('el mismo mensaje dos veces y balizas viejas de un id ya visto se deduplican', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 50, 0);
    const r = rogue(w);
    await r.ready;
    await r.beacon(0x77, w.clock.t);
    await r.beacon(0x77, w.clock.t);
    await r.beacon(0x77, w.clock.t - 500); // fuera de orden
    expect(a.node.getState().dropped.duplicate).toBe(2);
    expect(a.node.getState().nearby).toBe(1);
  });

  it('la tabla de vecinos esta acotada', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 50, 0);
    const rogues = Array.from({ length: 60 }, (_, i) => rogue(w, `r${i}`));
    for (const r of rogues) await r.ready;
    // 60 emisores x 4 balizas = 240 ids distintos, sin pasar del limite por emisor.
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < rogues.length; i++) await rogues[i].beacon(0x5000 + k * 100 + i, w.clock.t, 50 + i);
    }
    expect(a.node.getState().nearby).toBeLessThanOrEqual(LIMITS.maxNeighbors);
  });

  it('un peligro sin firma verificada se descarta; con firma se acepta', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 72, 0);
    const r = rogue(w);
    await r.ready;
    const hz: V2VPacket = { kind: 'hazard', id: 0x99, ts: w.clock.t, latE6: Math.round((O.lat + 100 / M_LAT) * 1e6), lonE6: Math.round(O.lon * 1e6), speedCms: 0, heading: 0, accuracyM: 4, vehicleClass: 'carro', events: Events.CRASH };
    await r.raw(HAZARD_TOPIC, encodePacketB64(hz, w.clock.t), false);
    expect(a.node.getState().dropped.unverified).toBe(1);
    expect(a.node.getState().hazards).toHaveLength(0);
    await r.raw(HAZARD_TOPIC, encodePacketB64({ ...hz, ts: w.clock.t + 1 }, w.clock.t), true);
    const s = a.node.getState();
    expect(s.hazards).toHaveLength(1);
    expect(s.level).toBe('peligro');
    expect(s.headline?.message).toBe('Choque adelante');
  });

  it('un peligro detras de mi se registra pero no avisa', async () => {
    const w = world();
    const a = makeNode(w, 'A', 1);
    await startAt(a, 0, 72, 0);
    const r = rogue(w);
    await r.ready;
    await r.beacon(0x99, w.clock.t, -80, { kind: 'hazard', events: Events.CRASH, speedCms: 0 });
    expect(a.node.getState().level).toBe('none');
  });
});

describe('V2VNode — eventos propios', () => {
  it('una frenada brusca real se publica como peligro FIRMADO con ttl 60 s y marca la baliza', async () => {
    const w = world();
    const sent: { topic: string; opts: unknown }[] = [];
    const base = w.hub.createPort('A');
    const spy = { ...base, join: base.join.bind(base), leave: base.leave.bind(base), subscribe: base.subscribe.bind(base), peerCount: base.peerCount.bind(base), close: base.close.bind(base), nodeId: 'A',
      publish: async (...args: Parameters<MeshPort['publish']>) => { sent.push({ topic: args[2], opts: args[4] }); return base.publish(...args); } } as MeshPort;
    const a = makeNode(w, 'x', 1, { port: spy });
    const b = makeNode(w, 'B', 2);
    await startAt(a, 0, 72, 0);
    await startAt(b, -40, 72, 0); // B viene detras, mismo sentido
    // A frena: 1 s a 0,6 g con el GPS cayendo de 72 a 36 km/h.
    for (let ms = 0; ms < 1000; ms += 20) {
      w.clock.t += 20;
      a.motion.sample(0, 0, G);
    }
    for (let ms = 0; ms < 1000; ms += 20) {
      w.clock.t += 20;
      a.motion.sample(0.6 * G, 0, G);
      if (ms === 900) a.geo.fix(15, 36, 0);
    }
    await flush();
    const hazardSends = sent.filter((s) => s.topic === HAZARD_TOPIC);
    expect(hazardSends).toHaveLength(1);
    expect(hazardSends[0].opts).toEqual({ sign: true, ttlMs: HAZARD_TTL_MS });
    await a.node.tick();
    b.geo.fix(-40, 72, 0);
    await b.node.tick();
    const sb = b.node.getState();
    expect(sb.hazards.some((h) => h.events & Events.HARD_BRAKE)).toBe(true);
    expect(sent.some((s) => s.topic === BEACON_TOPIC)).toBe(true);
  });
});
