import { describe, expect, it } from 'vitest';
import {
  Events, EVENTS_ALL, PACKET_BYTES, decodePacket, encodePacket, encodePacketB64, fromBase64, validatePacket,
  type V2VPacket,
} from './packet';

const NOW = 1_800_000_000_000;
const base: V2VPacket = {
  kind: 'beacon', id: 0xdeadbeef, ts: NOW, latE6: 4_711_000, lonE6: -74_072_100, speedCms: 1666, heading: 271,
  accuracyM: 5, vehicleClass: 'moto', events: Events.HARD_BRAKE | Events.POTHOLE,
};

describe('packet V2V', () => {
  it('codifica en 29 bytes y decodifica igual (ida y vuelta)', () => {
    const bytes = encodePacket(base, NOW);
    expect(bytes.length).toBe(PACKET_BYTES);
    const r = decodePacket(bytes, NOW);
    expect(r).toEqual({ ok: true, packet: base });
  });

  it('ida y vuelta por base64 y con coordenadas negativas / extremos', () => {
    const p: V2VPacket = { ...base, kind: 'hazard', latE6: -90_000_000, lonE6: -180_000_000, heading: 359, speedCms: 12_000, accuracyM: 255, events: EVENTS_ALL, vehicleClass: 'maquinaria' };
    const r = decodePacket(encodePacketB64(p, NOW), NOW);
    expect(r).toEqual({ ok: true, packet: p });
  });

  it('el ts de 48 bits sobrevive (no cabe en 32)', () => {
    const r = decodePacket(encodePacket({ ...base, ts: NOW - 123 }, NOW), NOW);
    expect(r.ok && r.packet.ts).toBe(NOW - 123);
  });

  it('el paquete no contiene nada mas que lo declarado (sin cuenta ni VIN)', () => {
    expect(Object.keys(base).sort()).toEqual(
      ['accuracyM', 'events', 'heading', 'id', 'kind', 'latE6', 'lonE6', 'speedCms', 'ts', 'vehicleClass'],
    );
  });

  it.each([
    ['latitud', { latE6: 90_000_001 }],
    ['longitud', { lonE6: 180_000_001 }],
    ['velocidad', { speedCms: 12_001 }],
    ['velocidad negativa', { speedCms: -1 }],
    ['rumbo', { heading: 360 }],
    ['id', { id: 2 ** 32 }],
    ['eventos desconocidos', { events: 1 << 9 }],
    ['ts en el futuro', { ts: NOW + 5_001 }],
    ['no entero', { latE6: 1.5 }],
    ['peligro sin evento', { kind: 'hazard' as const, events: 0 }],
  ])('rechaza %s', (_n, patch) => {
    const p = { ...base, ...patch } as V2VPacket;
    expect(validatePacket(p, NOW)).not.toBeNull();
    expect(() => encodePacket(p, NOW)).toThrow(RangeError);
  });

  it('acepta un ts hasta 5 s en el futuro y rechaza al decodificar uno mas alla', () => {
    const ok = encodePacket({ ...base, ts: NOW + 5_000 }, NOW);
    expect(decodePacket(ok, NOW).ok).toBe(true);
    // El receptor tiene su propio reloj: el mismo paquete visto "6 s antes" es futuro.
    expect(decodePacket(ok, NOW - 1_000)).toEqual({ ok: false, reason: 'ts en el futuro' });
  });

  it('rechaza binario mal formado', () => {
    const good = encodePacket(base, NOW);
    expect(decodePacket(good.slice(0, 28), NOW).ok).toBe(false);
    const badMagic = good.slice();
    badMagic[0] = 0x00;
    expect(decodePacket(badMagic, NOW)).toEqual({ ok: false, reason: 'magic incorrecto' });
    const badVer = good.slice();
    badVer[1] = 9;
    expect(decodePacket(badVer, NOW)).toEqual({ ok: false, reason: 'version no soportada' });
    const badKind = good.slice();
    badKind[2] = 7;
    expect(decodePacket(badKind, NOW).ok).toBe(false);
    const badClass = good.slice();
    badClass[26] = 9;
    expect(decodePacket(badClass, NOW).ok).toBe(false);
    expect(decodePacket('!!!no-base64!!!', NOW).ok).toBe(false);
    expect(decodePacket({ lat: 1 }, NOW).ok).toBe(false);
    expect(decodePacket(null, NOW).ok).toBe(false);
  });

  it('rechaza lat fuera de rango escrita a mano en los bytes', () => {
    const b = encodePacket(base, NOW);
    new DataView(b.buffer).setInt32(13, 100_000_000);
    expect(decodePacket(b, NOW)).toEqual({ ok: false, reason: 'latitud fuera de rango' });
  });

  it('base64 de ida y vuelta', () => {
    const b = encodePacket(base, NOW);
    expect([...fromBase64(encodePacketB64(base, NOW))]).toEqual([...b]);
  });
});
