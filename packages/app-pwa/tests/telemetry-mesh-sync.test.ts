/**
 * tests/telemetry-mesh-sync.test.ts — la replica de telemetria (LiveChart) viaja por el puerto
 * edge-mesh, no por y-webrtc (cuyos servidores de senalizacion publicos estan caidos).
 *
 * Se prueba con puertos en memoria: el mismo motor (firma, aislamiento de sala, dedup) que corre
 * en produccion, sin WebRTC.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryTransport } from '../src/mesh/edgeMesh';
import { createMemoryMeshPort } from '../src/mesh/memoryPort';
import {
  MAX_BATCH_BYTES,
  TOPIC_SYNC,
  TOPIC_UPDATE,
  attachDocToMesh,
  telemetryRoom,
  type RoomKeyFetcher,
  type RoomKeyMaterial,
} from '../src/components/telemetry/meshYjsSync';
import { TelemetryIngestManager, type OBD2TelemetryRecord } from '../src/lib/telemetry';

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera por CONDICION, no por reloj.
 *
 * Sustituye a los `await wait(400)` que precedian a cada afirmacion: el transporte en memoria
 * entrega sincrono, pero sellar (AES-GCM) y aplicar (Yjs) son asincronos, asi que el tiempo que
 * tarda un par en tener el estado depende de la carga de la maquina. Con una espera fija el
 * resultado era "llego todo" o "llegaron 2 de 5" segun como estuviera el runner (y el fallo se
 * iba con `--sequence.shuffle`, no con el orden normal). Por eso el flake de siempre.
 *
 * Sondea cada `every` ms hasta `timeout` y, si no se cumple, falla con lo que hay en realidad.
 * En una maquina sana resuelve en pocos ms: el test ademas se hace mas rapido.
 */
const until = async (cond: () => boolean, opts: { timeout?: number; every?: number; what?: string } = {}) => {
  const timeout = opts.timeout ?? 4_000;
  const every = opts.every ?? 20;
  const started = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - started >= timeout) {
      throw new Error(`until: caduco ${timeout}ms esperando ${opts.what ?? 'la condicion'}`);
    }
    await wait(every);
  }
};
const ports: ReturnType<typeof createMemoryMeshPort>[] = [];
const syncs: Array<{ destroy(): Promise<void> }> = [];
const mkPort = () => {
  const p = createMemoryMeshPort({ networkId: 'tel' });
  ports.push(p);
  return p;
};

// --- Material de claves como lo entrega el servidor (aqui aleatorio: el test no deriva) ---
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const randKey = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
interface Tenant {
  roomId: string;
  keys: Map<number, string>;
  epoch: number;
}
const mkTenant = (epoch = 10): Tenant => ({
  roomId: hex(crypto.getRandomValues(new Uint8Array(16))),
  keys: new Map([
    [epoch - 1, randKey()],
    [epoch, randKey()],
    [epoch + 1, randKey()],
  ]),
  epoch,
});
const materialOf = (t: Tenant): RoomKeyMaterial => ({
  roomId: t.roomId,
  epoch: t.epoch,
  key: t.keys.get(t.epoch)!,
  previous: { epoch: t.epoch - 1, key: t.keys.get(t.epoch - 1)! },
});
const fetcherOf = (t: Tenant): RoomKeyFetcher => async () => materialOf(t);

async function node(t: Tenant) {
  const doc = new Y.Doc();
  const port = mkPort();
  const sync = await attachDocToMesh(doc, port, fetcherOf(t));
  syncs.push(sync);
  return { doc, port, sync, manager: new TelemetryIngestManager(doc) };
}
const rec = (vin: string, extra: Partial<OBD2TelemetryRecord> = {}): OBD2TelemetryRecord => ({
  vin,
  timestamp: Date.now(),
  speed: 60,
  rpm: 2500,
  coolantTemp: 90,
  fuelLevel: 70,
  latitude: 4.6,
  longitude: -74.08,
  troubleCodes: [],
  odometer: 1000,
  ...extra,
});
const vins = (m: TelemetryIngestManager) => m.getAllRecords().map((r) => r.vin);

afterEach(async () => {
  await Promise.all(syncs.splice(0).map((s) => s.destroy()));
  await Promise.all(ports.splice(0).map((p) => p.close()));
  MemoryTransport.resetAll();
});

describe('replica de telemetria sobre edge-mesh cifrado', () => {
  it('un registro ingestado en A aparece en B (y viceversa)', async () => {
    const t = mkTenant();
    const a = await node(t);
    const b = await node(t);
    a.manager.ingestOBD2Data(rec('VIN-V1', { troubleCodes: ['P0420'] }));
    await until(() => vins(b.manager).length === 1, { what: 'B recibe el registro de A' });
    expect(vins(b.manager)).toEqual(['VIN-V1']);
    expect(b.manager.getAllRecords()[0].troubleCodes).toEqual(['P0420']);
    b.manager.ingestOBD2Data(rec('VIN-V2'));
    await until(() => vins(a.manager).length === 2, { what: 'A recibe el registro de B' });
    expect(vins(a.manager).sort()).toEqual(['VIN-V1', 'VIN-V2']);
  });

  it('un nodo que llega tarde recibe el historial (sync-req) sin duplicados', async () => {
    const t = mkTenant();
    const a = await node(t);
    for (let i = 0; i < 5; i++) a.manager.ingestOBD2Data(rec(`VIN-${i}`));
    const late = await node(t);
    await until(() => vins(late.manager).length === 5, { what: 'el nodo tardio recibe las 5 VIN' });
    expect(vins(late.manager)).toEqual(['VIN-0', 'VIN-1', 'VIN-2', 'VIN-3', 'VIN-4']);
    // El historial se reenvia en lotes: sin duplicados, el contador se queda en 5.
    await wait(400);
    expect(late.manager.getRecordCount()).toBe(5);
  });

  it('un historial mayor que un mensaje se reparte en lotes que caben en el canal tras cifrar', async () => {
    const t = mkTenant();
    const a = await node(t);
    const sizes: number[] = [];
    const big = 'P' + 'x'.repeat(200);
    for (let i = 0; i < 60; i++) a.manager.ingestOBD2Data(rec(`VIN-${i}`, { troubleCodes: [big] }));
    const late = await node(t);
    late.port.subscribe<{ c: string; n: string }>('datos', TOPIC_UPDATE, (m) => sizes.push(m.payload.c.length + m.payload.n.length));
    await until(() => late.manager.getRecordCount() === 60, { what: 'los 60 registros replican en lotes' });
    expect(late.manager.getRecordCount()).toBe(60);
    expect(sizes.length).toBeGreaterThan(1);
    // La envolvente firmada gasta ~7 KB; el limite de PeerJS es ~16 KB.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(Math.ceil(((MAX_BATCH_BYTES + 16) * 4) / 3) + 20);
    expect(Math.max(...sizes) + 7_000).toBeLessThan(16_000);
  });

  it('otro tenant (otro roomId y otra clave) no recibe nada', async () => {
    const t1 = mkTenant();
    const t2 = mkTenant();
    const a = await node(t1);
    const other = await node(t2);
    expect(telemetryRoom(t1.roomId)).not.toBe(telemetryRoom(t2.roomId));
    a.manager.ingestOBD2Data(rec('VIN-SECRETO'));
    await wait();
    expect(other.manager.getRecordCount()).toBe(0);
  });

  it('el cable no lleva telemetria en claro ni el instanceId: un par SIN clave en la sala no lee nada', async () => {
    const t = mkTenant();
    const a = await node(t);
    const spy = mkPort();
    await spy.join('datos', telemetryRoom(t.roomId)); // conoce la sala, no la clave
    const seen: Array<{ topic: string; payload: unknown }> = [];
    spy.subscribe('datos', TOPIC_UPDATE, (m) => seen.push({ topic: m.topic, payload: m.payload }));
    spy.subscribe('datos', TOPIC_SYNC, (m) => seen.push({ topic: m.topic, payload: m.payload }));
    a.manager.ingestOBD2Data(rec('VIN-CONFIDENCIAL', { latitude: 4.123456, longitude: -74.654321, speed: 77, troubleCodes: ['P0420'], odometer: 424242 }));
    await until(() => seen.length > 0, { what: 'el par sin clave ve el trafico cifrado pasar' });
    expect(seen.length).toBeGreaterThan(0);
    const wire = JSON.stringify(seen);
    for (const secret of ['VIN-CONFIDENCIAL', '4.123456', '-74.654321', 'P0420', '424242', 'speed', 'latitude', 'telemetry_stream', 'coolantTemp', 'tenant-1', 'demo-obras']) {
      expect(wire).not.toContain(secret);
    }
    // Y lo mismo codificado en base64 dentro de los bytes cifrados: ni siquiera el VIN en b64.
    expect(wire).not.toContain(btoa('VIN-CONFIDENCIAL'));
    for (const m of seen) expect(Object.keys(m.payload as object).sort()).toEqual(['c', 'e', 'n']);
  });

  it('un intruso sin la clave (o con otra) no inyecta updates, ni firmados', async () => {
    const t = mkTenant();
    const a = await node(t);
    const intruder = mkPort();
    const room = telemetryRoom(t.roomId);
    await intruder.join('datos', room);
    const evil = new Y.Doc();
    evil.getArray('telemetry_stream').push([rec('VIN-FALSO')]);
    const u = Y.encodeStateAsUpdate(evil);
    const b64 = btoa(String.fromCharCode(...u));
    // 1) formato antiguo (update en claro), firmado.
    await intruder.publish('datos', room, TOPIC_UPDATE, { u: b64 }, { sign: true });
    // 2) envolvente valida pero cifrada con una clave que no es la de la sala.
    const wrong = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${t.roomId}|${t.epoch}`) }, wrong, u));
    const env = { e: t.epoch, n: btoa(String.fromCharCode(...iv)), c: btoa(String.fromCharCode(...ct)) };
    await intruder.publish('datos', room, TOPIC_UPDATE, env, { sign: true });
    await intruder.publish('datos', room, TOPIC_UPDATE, env); // sin firma
    await wait(400);
    expect(a.manager.getRecordCount()).toBe(0);
  });

  it('con la clave correcta pero AAD de otra sala/epoca el mensaje no descifra', async () => {
    const t = mkTenant();
    const a = await node(t);
    const peer = mkPort();
    const room = telemetryRoom(t.roomId);
    await peer.join('datos', room);
    const evil = new Y.Doc();
    evil.getArray('telemetry_stream').push([rec('VIN-AAD')]);
    const u = Y.encodeStateAsUpdate(evil);
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(t.keys.get(t.epoch)!.replaceAll('-', '+').replaceAll('_', '/') + '='), (c) => c.charCodeAt(0)),
      'AES-GCM',
      false,
      ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const seal = async (aad: string) =>
      new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, u));
    const pub = async (ct: Uint8Array) =>
      peer.publish('datos', room, TOPIC_UPDATE, { e: t.epoch, n: btoa(String.fromCharCode(...iv)), c: btoa(String.fromCharCode(...ct)) }, { sign: true });
    await pub(await seal(`${'0'.repeat(32)}|${t.epoch}`)); // otra sala
    await pub(await seal(`${t.roomId}|${t.epoch - 1}`)); // otra epoca
    await wait(400);
    expect(a.manager.getRecordCount()).toBe(0);
    await pub(await seal(`${t.roomId}|${t.epoch}`)); // el correcto si entra (control)
    await until(() => vins(a.manager).length === 1, { what: 'el mensaje con el AAD correcto entra' });
    expect(vins(a.manager)).toEqual(['VIN-AAD']);
  });

  it('un update bien cifrado pero SIN firma verificada no se aplica (firmado si)', async () => {
    const t = mkTenant();
    const a = await node(t);
    const peer = mkPort();
    const room = telemetryRoom(t.roomId);
    await peer.join('datos', room);
    const evil = new Y.Doc();
    evil.getArray('telemetry_stream').push([rec('VIN-SIN-FIRMA')]);
    const u = Y.encodeStateAsUpdate(evil);
    const raw = Uint8Array.from(atob(t.keys.get(t.epoch)!.replaceAll('-', '+').replaceAll('_', '/') + '='), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${t.roomId}|${t.epoch}`) }, key, u));
    const env = { e: t.epoch, n: btoa(String.fromCharCode(...iv)), c: btoa(String.fromCharCode(...ct)) };
    await peer.publish('datos', room, TOPIC_UPDATE, env); // sin firma
    await wait(400);
    expect(a.manager.getRecordCount()).toBe(0);
    await peer.publish('datos', room, TOPIC_UPDATE, env, { sign: true });
    await until(() => vins(a.manager).length === 1, { what: 'el mensaje firmado se aplica' });
    expect(vins(a.manager)).toEqual(['VIN-SIN-FIRMA']);
  });

  it('basura en el payload no rompe al receptor', async () => {
    const t = mkTenant();
    const a = await node(t);
    const peer = mkPort();
    const room = telemetryRoom(t.roomId);
    await peer.join('datos', room);
    for (const bad of [{ u: 'esto-no-es-base64!!' }, { u: 42 }, 7, null, { e: 'x', n: 1, c: 2 }, { e: t.epoch, n: 'AAAA', c: 'zzz' }, { e: t.epoch, n: 'A'.repeat(16), c: 'A'.repeat(100000) }]) {
      await peer.publish('datos', room, TOPIC_UPDATE, bad, { sign: true });
      await peer.publish('datos', room, TOPIC_SYNC, bad);
    }
    await wait(400);
    expect(a.manager.getRecordCount()).toBe(0);
  });

  it('sin clave no se abre ninguna sala: el endpoint falla -> attachDocToMesh lanza', async () => {
    const port = mkPort();
    const joined: string[] = [];
    const origJoin = port.join.bind(port);
    port.join = async (n, r) => {
      joined.push(r);
      return origJoin(n, r);
    };
    for (const failing of [
      async () => {
        throw new Error('room-key: HTTP 401');
      },
      async () => ({ roomId: 'demo-obras', epoch: 1, key: 'x' }) as RoomKeyMaterial, // roomId que no es hex
      async () => ({ roomId: '0'.repeat(32), epoch: 1, key: 'AAAA' }) as RoomKeyMaterial, // clave corta
    ]) {
      await expect(attachDocToMesh(new Y.Doc(), port, failing)).rejects.toThrow();
    }
    expect(joined).toEqual([]);
  });

  it('rollover: el par que renovo se entiende con el que aun tiene la epoca anterior, y el rezagado se pone al dia', async () => {
    const t = mkTenant(10);
    // A y B arrancan en la epoca 10. A renovara a la 11; B sigue pidiendo lo que el servidor diga.
    const aTenant = { ...t, epoch: 10 };
    const bTenant = { ...t, epoch: 10 };
    const a = await node(aTenant);
    const b = await node(bTenant);
    a.manager.ingestOBD2Data(rec('VIN-E10'));
    await until(() => vins(b.manager).length === 1, { what: 'B recibe VIN-E10' });
    expect(vins(b.manager)).toEqual(['VIN-E10']);

    // El servidor pasa a la epoca 11 y A pide la clave primero.
    aTenant.epoch = 11;
    bTenant.epoch = 11;
    await a.sync.refreshKeys();
    expect(a.sync.epoch()).toBe(11);
    expect(b.sync.epoch()).toBe(10);

    // A cifra con la 11. B (rezagado) no la tiene: descarta, pero entonces renueva solo.
    a.manager.ingestOBD2Data(rec('VIN-E11-A'));
    // B se entera por el mensaje de una epoca futura y renueva solo; con la clave nueva ya
    // descifra el update que habia descartado (y su sync-req reenvia el historial).
    await until(() => b.sync.epoch() === 11, { what: 'B renueva a la epoca 11' });
    expect(b.sync.epoch()).toBe(11);
    await until(() => vins(b.manager).length === 2, { what: 'B recibe VIN-E11-A' });
    expect(vins(b.manager).sort()).toEqual(['VIN-E10', 'VIN-E11-A']);

    // Y B, ya en la 11, tambien llega a A.
    b.manager.ingestOBD2Data(rec('VIN-E11-B'));
    await until(() => vins(a.manager).length === 3, { what: 'A recibe VIN-E11-B' });
    expect(vins(a.manager).sort()).toEqual(['VIN-E10', 'VIN-E11-A', 'VIN-E11-B']);
  }, 15_000);

  it('rollover: un par con la epoca anterior sigue siendo legible (previous) por el que ya renovo', async () => {
    const t = mkTenant(10);
    const old = await node({ ...t, epoch: 10 });
    const fresh = await node({ ...t, epoch: 11 }); // ya con 11 y previous = 10
    old.manager.ingestOBD2Data(rec('VIN-VIEJO'));
    await until(() => vins(fresh.manager).length === 1, { what: 'el par con la epoca anterior se lee' });
    expect(vins(fresh.manager)).toEqual(['VIN-VIEJO']);
  });

  it('una renovacion que falla conserva la clave actual y no abre sala sin cifrar', async () => {
    const t = mkTenant();
    let fail = false;
    const doc = new Y.Doc();
    const port = mkPort();
    const sync = await attachDocToMesh(doc, port, async () => {
      if (fail) throw new Error('room-key: HTTP 503');
      return materialOf(t);
    });
    syncs.push(sync);
    fail = true;
    await sync.refreshKeys();
    expect(sync.epoch()).toBe(t.epoch);
  });

  it('destroy deja la sala y deja de replicar', async () => {
    const t = mkTenant();
    const a = await node(t);
    const b = await node(t);
    await a.sync.destroy();
    b.manager.ingestOBD2Data(rec('VIN-TRAS-DESTROY'));
    await wait();
    expect(a.manager.getRecordCount()).toBe(0);
  });
});
