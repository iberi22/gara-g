/**
 * src/pages/api/mesh/_roomKey.ts — Derivacion de la sala y la clave de telemetria (HKDF-SHA256).
 *
 * Aparte de la ruta (el prefijo `_` evita que Astro la sirva) para que los tests la ejerciten
 * sin montar un request. Solo corre en el Worker; el cliente nunca deriva nada: recibe el
 * resultado de GET /api/mesh/room-key.
 *
 * Presupuesto de CPU (Workers Free, 10 ms): una importKey + tres deriveBits de HKDF son
 * microsegundos. No hay PBKDF2 ni nada iterado: el secreto ya es de alta entropia.
 */
import { isExplicitDev } from '../../../garage/devEnvironment';

const enc = new TextEncoder();

/** Duracion de una epoca de clave: una semana. */
export const EPOCH_MS = 7 * 24 * 60 * 60 * 1000;

/** Prefijos de `info`: atan la derivacion a su proposito y al tenant. */
export const INFO_ROOM_ID = 'gara-mesh-room-id/v1|';
export const INFO_ROOM_KEY = 'gara-mesh-room-key/v1|';

/**
 * Secreto SOLO de desarrollo. Esta publicado en el repositorio, asi que no protege nada: existe
 * para que `pnpm dev` y los tests funcionen sin configurar el secreto. En produccion nunca se
 * usa (ver resolveSecret en room-key.ts).
 */
export const DEV_MESH_ROOM_SECRET = 'DEV-ONLY-INSECURE-mesh-room-secret-do-not-use-in-production';

/** Longitud minima exigida a MESH_ROOM_SECRET en produccion (caracteres). */
export const MIN_SECRET_LENGTH = 32;

export function epochAt(now: number): number {
  return Math.floor(now / EPOCH_MS);
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function toB64Url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hkdf(base: CryptoKey, salt: string, info: string, bytes: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(info) },
    base,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export interface RoomKeys {
  /** 128 bits en hex. Estable entre epocas (no depende de la epoca): es el nombre de la sala. */
  roomId: string;
  epoch: number;
  /** AES-256 en base64url. */
  key: string;
  previous: { epoch: number; key: string };
  /** Instante (ms epoch) en que empieza la epoca siguiente: cuando el cliente debe volver a pedir. */
  rotatesAt: number;
}

/**
 * - roomId = HKDF(secret, salt='gara-mesh-room', info='gara-mesh-room-id/v1|<instanceId>').
 * - key(e) = HKDF(secret, salt='gara-mesh-epoch/<e>', info='gara-mesh-room-key/v1|<instanceId>').
 * Tenants distintos, o epocas distintas, dan claves independientes; la clave no revela el roomId
 * ni al reves (info y salt distintos).
 */
function isProduction(): boolean {
  return !isExplicitDev();
}

export async function deriveRoomKeys(secret: string, instanceId: string, now: number = Date.now()): Promise<RoomKeys> {
  // Fail closed: el secreto de dev esta publicado, jamas debe derivar claves en produccion.
  if (secret === DEV_MESH_ROOM_SECRET && isProduction()) {
    throw new Error('DEV mesh room secret refused in production: configure MESH_ROOM_SECRET');
  }
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveBits']);
  const epoch = epochAt(now);
  const [roomId, key, prev] = await Promise.all([
    hkdf(base, 'gara-mesh-room', INFO_ROOM_ID + instanceId, 16),
    hkdf(base, `gara-mesh-epoch/${epoch}`, INFO_ROOM_KEY + instanceId, 32),
    hkdf(base, `gara-mesh-epoch/${epoch - 1}`, INFO_ROOM_KEY + instanceId, 32),
  ]);
  return {
    roomId: toHex(roomId),
    epoch,
    key: toB64Url(key),
    previous: { epoch: epoch - 1, key: toB64Url(prev) },
    rotatesAt: (epoch + 1) * EPOCH_MS,
  };
}
