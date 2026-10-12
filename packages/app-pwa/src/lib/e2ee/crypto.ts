/**
 * src/lib/e2ee/crypto.ts — Codigo de respaldo, derivacion de claves y sobre cifrado.
 *
 * Solo WebCrypto (navegador, Workers y Node 20+). Sin dependencias.
 *
 * - Codigo de respaldo: 16 bytes al azar (128 bits) + 2 caracteres de control (los 10
 *   primeros bits del SHA-256 de los 16 bytes), en base32 Crockford, en grupos de 4.
 * - Derivacion: HKDF-SHA256, IKM = los 16 bytes, salt "gara-g/backup/v1", info "id" | "auth" | "enc".
 *   Sin PBKDF2: el codigo ya trae 128 bits de entropia.
 * - Sobre: AES-256-GCM, IV de 12 bytes nuevo en cada cifrado,
 *   AAD = "gara-g/backup/v1|" + syncId + "|" + (z ?? "raw"): ni el id ni la compresion se pueden
 *   cambiar en el servidor sin que el descifrado falle.
 *
 * El codigo y la clave nunca salen del dispositivo: al servidor solo van syncId, authToken
 * (y el servidor guarda su SHA-256) y el sobre.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 16;
const DATA_CHARS = 26; // ceil(128 / 5): 130 bits, los 2 ultimos a cero
const CHECK_CHARS = 2; // 10 bits de control
export const BACKUP_CODE_LENGTH = DATA_CHARS + CHECK_CHARS; // 28 = 7 grupos de 4

const HKDF_SALT = 'gara-g/backup/v1';
const AAD_PREFIX = 'gara-g/backup/v1|';

/** Datos autenticados: atan el sobre a su respaldo y a su modo de compresion. */
function aad(syncId: string, z: 'gzip' | undefined): Uint8Array<ArrayBuffer> {
  return enc.encode(`${AAD_PREFIX}${syncId}|${z ?? 'raw'}`);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class BackupCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupCodeError';
  }
}

export class DecryptError extends Error {
  constructor(message = 'No se pudo descifrar: el código no corresponde a este respaldo o el respaldo está alterado.') {
    super(message);
    this.name = 'DecryptError';
  }
}

// --- base64url ---------------------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('base64url invalido');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** SHA-256 en hex de un texto (el servidor lo usa para guardar el hash del authToken). */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

// --- prueba de trabajo de la creacion ------------------------------------------------------

/** Ceros hex iniciales exigidos: 3 = 12 bits, ~4 096 hashes de media (decenas de ms en un movil). */
export const POW_ZERO_HEX = 3;

const powInput = (syncId: string, nonce: string) => `gara-sync-create:${syncId}:${nonce}`;

/** El servidor comprueba con un solo SHA-256: sin KDF, cabe en los 10 ms de CPU de Workers Free. */
export async function verifyCreatePow(syncId: string, nonce: string): Promise<boolean> {
  if (!/^[0-9a-z]{1,16}$/.test(nonce)) return false;
  return (await sha256Hex(powInput(syncId, nonce))).startsWith('0'.repeat(POW_ZERO_HEX));
}

/** Busca el nonce para crear el respaldo `syncId`. Va ligado al id: no se puede reutilizar. */
export async function solveCreatePow(syncId: string): Promise<string> {
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (await verifyCreatePow(syncId, nonce)) return nonce;
  }
}

// --- codigo de respaldo ------------------------------------------------------------------

/** 5 bits por caracter, big-endian; rellena con ceros a la derecha. */
function base32Encode(bytes: Uint8Array, chars: number): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out.slice(0, chars);
}

async function checkChars(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
  return base32Encode(digest.slice(0, 2), CHECK_CHARS); // 16 bits -> 4 chars, nos quedamos con 2 (10 bits)
}

function groups(code: string): string {
  return code.match(/.{1,4}/g)!.join('-');
}

/** Codigo nuevo: 16 bytes al azar. Devuelve el codigo para mostrar y los bytes. */
export async function generateBackupCode(): Promise<string> {
  const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  return groups(base32Encode(secret, DATA_CHARS) + (await checkChars(secret)));
}

export interface ParsedBackupCode {
  /** Los 16 bytes secretos. */
  secret: Uint8Array<ArrayBuffer>;
  /** Forma canonica, en grupos de 4 con guiones. */
  code: string;
}

/**
 * Normaliza (mayusculas, sin espacios ni guiones, O->0, I y L->1), valida longitud, alfabeto y
 * control. Un error de tecleo lanza BackupCodeError; nunca devuelve una clave distinta.
 */
export async function parseBackupCode(input: string): Promise<ParsedBackupCode> {
  const norm = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (norm.length !== BACKUP_CODE_LENGTH) {
    throw new BackupCodeError(`El código tiene ${BACKUP_CODE_LENGTH} caracteres; este tiene ${norm.length}.`);
  }
  const values: number[] = [];
  for (const ch of norm) {
    const v = CROCKFORD.indexOf(ch);
    if (v === -1) throw new BackupCodeError(`El carácter "${ch}" no existe en un código de respaldo.`);
    values.push(v);
  }
  // Decodifica los 26 caracteres de datos a 130 bits; los 2 ultimos tienen que ser cero.
  const secret: Uint8Array<ArrayBuffer> = new Uint8Array(SECRET_BYTES);
  let acc = 0;
  let bits = 0;
  let idx = 0;
  for (let i = 0; i < DATA_CHARS; i++) {
    acc = (acc << 5) | values[i];
    bits += 5;
    if (bits >= 8) {
      secret[idx++] = (acc >>> (bits - 8)) & 255;
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  if (idx !== SECRET_BYTES || acc !== 0) throw new BackupCodeError('El código no es válido: revisa que lo copiaste completo.');
  if (norm.slice(DATA_CHARS) !== (await checkChars(secret))) {
    throw new BackupCodeError('El código tiene un error de tecleo: revisa los caracteres.');
  }
  return { secret, code: groups(norm) };
}

// --- derivacion --------------------------------------------------------------------------

export interface BackupKeys {
  /** 32 caracteres hex; identifica el respaldo en la URL. */
  syncId: string;
  /** base64url de 32 bytes; va en Authorization: Bearer. */
  authToken: string;
  /** Clave AES-GCM de 256 bits, no exportable. */
  encKey: CryptoKey;
}

async function hkdfBits(ikm: CryptoKey, info: string, bytes: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(info) },
    ikm,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export async function deriveKeys(secret: Uint8Array<ArrayBuffer>): Promise<BackupKeys> {
  if (secret.length !== SECRET_BYTES) throw new Error('El secreto debe tener 16 bytes.');
  const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const syncId = toHex(await hkdfBits(ikm, 'id', 16));
  const authToken = b64urlEncode(await hkdfBits(ikm, 'auth', 32));
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode('enc') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { syncId, authToken, encKey };
}

// --- sobre -------------------------------------------------------------------------------

export interface Envelope {
  v: 1;
  alg: 'A256GCM';
  iv: string;
  ct: string;
  z?: 'gzip';
}

async function pipe(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(await out);
}

export async function encryptEnvelope(encKey: CryptoKey, syncId: string, plaintext: string): Promise<Envelope> {
  let data: Uint8Array<ArrayBuffer> = enc.encode(plaintext);
  let z: 'gzip' | undefined;
  if (typeof CompressionStream !== 'undefined') {
    data = await pipe(data, new CompressionStream('gzip'));
    z = 'gzip';
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(syncId, z) }, encKey, data),
  );
  const env: Envelope = { v: 1, alg: 'A256GCM', iv: b64urlEncode(iv), ct: b64urlEncode(ct) };
  if (z) env.z = z;
  return env;
}

/** Forma del sobre; la usan el cliente y el servidor. */
export function isEnvelope(x: unknown): x is Envelope {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    e.v === 1 &&
    e.alg === 'A256GCM' &&
    typeof e.iv === 'string' &&
    /^[A-Za-z0-9_-]{16}$/.test(e.iv) && // 12 bytes
    typeof e.ct === 'string' &&
    /^[A-Za-z0-9_-]{22,}$/.test(e.ct) && // al menos 16 bytes (la etiqueta GCM)
    (e.z === undefined || e.z === 'gzip')
  );
}

export async function decryptEnvelope(encKey: CryptoKey, syncId: string, envelope: unknown): Promise<string> {
  if (!isEnvelope(envelope)) throw new DecryptError('El respaldo no tiene el formato esperado.');
  let plain: Uint8Array<ArrayBuffer>;
  try {
    const iv = b64urlDecode(envelope.iv);
    const ct = b64urlDecode(envelope.ct);
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(syncId, envelope.z) }, encKey, ct),
    );
    if (envelope.z === 'gzip') plain = await pipe(plain, new DecompressionStream('gzip'));
  } catch {
    throw new DecryptError();
  }
  return dec.decode(plain);
}
