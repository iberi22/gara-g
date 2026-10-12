import { describe, expect, it } from 'vitest';
import { LocalMeshHub } from '../localHub';
import { decodeGeohash, encodeGeohash, V2V_PRECISION } from '../geocell';
import { createRoomManager } from './rooms';

const LAT = 4.711;
const LON = -74.0721;

function setup() {
  const hub = new LocalMeshHub();
  const port = hub.createPort('yo');
  const other = hub.createPort('otro');
  return { hub, port, other, rooms: createRoomManager(port) };
}

describe('salas V2V', () => {
  it('une la celda central y sus 8 vecinas', async () => {
    const { rooms, port } = setup();
    const u = await rooms.update(LAT, LON);
    expect(u.changed).toBe(true);
    expect(u.cells).toHaveLength(9);
    expect(u.center).toBe(encodeGeohash(LAT, LON, V2V_PRECISION));
    for (const c of u.cells) expect(port.peerCount('v2v', c)).toBe(0);
  });

  it('no hace nada si la celda no cambia', async () => {
    const { rooms } = setup();
    await rooms.update(LAT, LON);
    const u = await rooms.update(LAT + 0.0001, LON);
    expect(u.changed).toBe(false);
    expect(u.joined).toEqual([]);
  });

  it('al cruzar bien adentro de otra celda se une a las nuevas y sale de las viejas', async () => {
    const { rooms, hub, other } = setup();
    const first = await rooms.update(LAT, LON);
    const box = decodeGeohash(first.center);
    // 3 celdas al este: la sala vieja ya no es vecina, hay que dejarla.
    const lon2 = box.lonHi + 2.5 * (box.lonHi - box.lonLo);
    const u = await rooms.update(LAT, lon2);
    expect(u.changed).toBe(true);
    expect(u.joined.length).toBeGreaterThan(0);
    expect(u.left.length).toBeGreaterThan(0);
    for (const c of u.left) expect(hub.roomMembers('v2v', c).size).toBe(0);
    for (const c of u.cells) expect(hub.roomMembers('v2v', c).size).toBe(1);
    void other;
  });

  it('histeresis: oscilar justo en el borde no cambia de celda ni hace join/leave', async () => {
    const { rooms } = setup();
    const first = await rooms.update(LAT, LON);
    const box = decodeGeohash(first.center);
    const edge = box.lonHi;
    let changes = 0;
    for (let i = 0; i < 20; i++) {
      // Salta 5 m a cada lado del borde.
      const u = await rooms.update(LAT, edge + (i % 2 ? 5 : -5) / (111_320 * Math.cos((LAT * Math.PI) / 180)));
      if (u.changed) changes++;
    }
    expect(changes).toBe(0);
    expect(rooms.center).toBe(first.center);
  });

  it('histeresis: cuando se mete lo bastante en la celda vecina, cambia', async () => {
    const { rooms } = setup();
    const first = await rooms.update(LAT, LON);
    const box = decodeGeohash(first.center);
    const m = (meters: number) => meters / (111_320 * Math.cos((LAT * Math.PI) / 180));
    expect((await rooms.update(LAT, box.lonHi + m(30))).changed).toBe(false);
    const u = await rooms.update(LAT, box.lonHi + m(120));
    expect(u.changed).toBe(true);
    expect(u.center).not.toBe(first.center);
  });

  it('leaveAll sale de todo', async () => {
    const { rooms, hub } = setup();
    const u = await rooms.update(LAT, LON);
    await rooms.leaveAll();
    for (const c of u.cells) expect(hub.roomMembers('v2v', c).size).toBe(0);
    expect(rooms.center).toBeNull();
  });
});
