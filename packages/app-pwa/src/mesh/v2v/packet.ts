/**
 * packet.ts — El paquete V2V (baliza y peligro) y su codificacion binaria compacta.
 *
 * Referencia: docs/PROTOCOL_MESH_V1.md (SafetyPacket). Aqui va la version de la PWA, mas
 * corta que la de Rust porque no lleva firma dentro: la firma, cuando toca, la pone el
 * MeshPort (`sign: true`), no el paquete.
 *
 * Dos tipos sobre dos topics distintos:
 * - baliza (`beacon`): ~1 Hz, SIN firmar, ttl 3 s. Una firma ML-DSA-65 pesa ~3,3 KB y saldria
 *   cada segundo; ademas una baliza caduca antes de que valga la pena falsificarla.
 * - peligro (`hazard`): puntual, FIRMADO, ttl ~60 s. Un peligro falso desvia o frena a
 *   otros conductores, asi que aqui si compensa pagar la firma.
 *
 * Nada del paquete identifica a una persona, cuenta, flota ni VIN: solo un id efimero.
 *
 * Layout (big-endian, 29 bytes):
 *   0  magic 'G' (0x47)         1  version (1)           2  tipo (1 baliza, 2 peligro)
 *   3  id efimero u32           7  ts u48 (ms epoch)    13  lat i32 (microgrados)
 *  17  lon i32 (microgrados)   21  velocidad u16 (cm/s) 23  rumbo u16 (grados 0-359)
 *  25  precision u8 (m)        26  clase u8             27  eventos u16 (mascara)
 */

export const PACKET_MAGIC = 0x47;
export const PACKET_VERSION = 1;
export const PACKET_BYTES = 29;

export const BEACON_TOPIC = 'beacon';
export const HAZARD_TOPIC = 'hazard';
export const BEACON_TTL_MS = 3_000;
export const HAZARD_TTL_MS = 60_000;

/** Un ts mas alla de esto en el futuro es un reloj roto o un paquete falso. */
export const MAX_FUTURE_MS = 5_000;
/** Mas rapido que esto (cm/s) no es un vehiculo de carretera: 432 km/h. */
export const MAX_SPEED_CMS = 12_000;

export const VehicleClass = { moto: 0, carro: 1, camion: 2, maquinaria: 3 } as const;
export type VehicleClassName = keyof typeof VehicleClass;
const CLASS_NAMES = Object.keys(VehicleClass) as VehicleClassName[];

export const Events = {
  HARD_BRAKE: 1 << 0,
  CRASH: 1 << 1,
  POTHOLE: 1 << 2,
  STOPPED_VEHICLE: 1 << 3,
  HAZARD_LIGHTS: 1 << 4,
  WRONG_WAY: 1 << 5,
} as const;
export const EVENTS_ALL = Object.values(Events).reduce((a, b) => a | b, 0);

export type PacketKind = 'beacon' | 'hazard';
const KIND_BYTE: Record<PacketKind, number> = { beacon: 1, hazard: 2 };

export interface V2VPacket {
  kind: PacketKind;
  /** Id efimero u32 (ver ephemeralId.ts). */
  id: number;
  /** ms epoch del emisor. */
  ts: number;
  latE6: number;
  lonE6: number;
  speedCms: number;
  /** Grados 0-359, 0 = norte, horario. */
  heading: number;
  /** Precision horizontal del GPS en metros (saturada a 255). */
  accuracyM: number;
  vehicleClass: VehicleClassName;
  /** Mascara de Events. */
  events: number;
}

export type DecodeResult = { ok: true; packet: V2VPacket } | { ok: false; reason: string };

/** Primer motivo por el que un paquete no es valido, o null. Sirve a encode y a decode. */
export function validatePacket(p: V2VPacket, now: number): string | null {
  const int = Number.isInteger;
  if (p.kind !== 'beacon' && p.kind !== 'hazard') return 'tipo desconocido';
  if (!int(p.id) || p.id < 0 || p.id > 0xffffffff) return 'id fuera de rango';
  if (!int(p.ts) || p.ts < 0 || p.ts > 0xffffffffffff) return 'ts fuera de rango';
  if (p.ts > now + MAX_FUTURE_MS) return 'ts en el futuro';
  if (!int(p.latE6) || Math.abs(p.latE6) > 90_000_000) return 'latitud fuera de rango';
  if (!int(p.lonE6) || Math.abs(p.lonE6) > 180_000_000) return 'longitud fuera de rango';
  if (!int(p.speedCms) || p.speedCms < 0 || p.speedCms > MAX_SPEED_CMS) return 'velocidad fuera de rango';
  if (!int(p.heading) || p.heading < 0 || p.heading > 359) return 'rumbo fuera de rango';
  if (!int(p.accuracyM) || p.accuracyM < 0 || p.accuracyM > 255) return 'precision fuera de rango';
  if (!(p.vehicleClass in VehicleClass)) return 'clase de vehiculo desconocida';
  if (!int(p.events) || p.events < 0 || (p.events & ~EVENTS_ALL) !== 0) return 'eventos desconocidos';
  if (p.kind === 'hazard' && p.events === 0) return 'peligro sin evento';
  return null;
}

export function encodePacket(p: V2VPacket, now: number): Uint8Array {
  const bad = validatePacket(p, now);
  if (bad) throw new RangeError(`paquete V2V invalido: ${bad}`);
  const buf = new Uint8Array(PACKET_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PACKET_MAGIC);
  v.setUint8(1, PACKET_VERSION);
  v.setUint8(2, KIND_BYTE[p.kind]);
  v.setUint32(3, p.id);
  // u48 a mano: DataView no lo tiene y un ts en ms no cabe en 32 bits.
  v.setUint16(7, Math.floor(p.ts / 2 ** 32));
  v.setUint32(9, p.ts % 2 ** 32);
  v.setInt32(13, p.latE6);
  v.setInt32(17, p.lonE6);
  v.setUint16(21, p.speedCms);
  v.setUint16(23, p.heading);
  v.setUint8(25, p.accuracyM);
  v.setUint8(26, VehicleClass[p.vehicleClass]);
  v.setUint16(27, p.events);
  return buf;
}

/** Acepta bytes o base64 (el payload viaja en base64 para sobrevivir a cualquier serializador). */
export function decodePacket(raw: unknown, now: number): DecodeResult {
  let bytes: Uint8Array;
  try {
    if (typeof raw === 'string') bytes = fromBase64(raw);
    else if (raw instanceof Uint8Array) bytes = raw;
    else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
    else return { ok: false, reason: 'payload no es binario' };
  } catch {
    return { ok: false, reason: 'base64 invalido' };
  }
  if (bytes.length !== PACKET_BYTES) return { ok: false, reason: 'longitud incorrecta' };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== PACKET_MAGIC) return { ok: false, reason: 'magic incorrecto' };
  if (v.getUint8(1) !== PACKET_VERSION) return { ok: false, reason: 'version no soportada' };
  const kindByte = v.getUint8(2);
  const kind = kindByte === 1 ? 'beacon' : kindByte === 2 ? 'hazard' : null;
  if (!kind) return { ok: false, reason: 'tipo desconocido' };
  const cls = CLASS_NAMES[v.getUint8(26)];
  if (!cls) return { ok: false, reason: 'clase de vehiculo desconocida' };
  const packet: V2VPacket = {
    kind,
    id: v.getUint32(3),
    ts: v.getUint16(7) * 2 ** 32 + v.getUint32(9),
    latE6: v.getInt32(13),
    lonE6: v.getInt32(17),
    speedCms: v.getUint16(21),
    heading: v.getUint16(23),
    accuracyM: v.getUint8(25),
    vehicleClass: cls,
    events: v.getUint16(27),
  };
  const bad = validatePacket(packet, now);
  return bad ? { ok: false, reason: bad } : { ok: true, packet };
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodePacketB64(p: V2VPacket, now: number): string {
  return toBase64(encodePacket(p, now));
}
