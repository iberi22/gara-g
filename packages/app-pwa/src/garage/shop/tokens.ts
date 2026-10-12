/**
 * tokens.ts — Token firmado de una impresion/anuncio (HMAC-SHA256 con Web Crypto).
 *
 * Por que un token y no mandar los datos sueltos: cuando el navegador reporta "vi este
 * anuncio", la ruta de impresion NO debe confiar en lo que le mandan. El token lleva
 * dentro la campana, el slot, el precio ya calculado y el hash del usuario, todo
 * firmado; si alguien altera el precio o cambia de campana, la firma no cuadra y no se
 es tambien la forma de hacer idempotente el clic (una sola vez por token)
  * y de aplicar el tope de frecuencia.
 *
 * Web Crypto (`crypto.subtle`) y no `node:crypto`: el mismo codigo corre en Workers y en
 * Node (tests), sin condicionantes ni imports condicionales.
 *
 * Secreto: `ADS_TOKEN_SECRET` del env de Cloudflare. En dev, si no hay, se usa una clave
 * fija CON aviso en consola: los tokens siguen siendo validos para poder probar el flujo,
 * pero nadie debe confiar en esa firma en produccion. En produccion sin secreto NO se
 * degrada: `tokenSecret()` lanza y las rutas devuelven 503 (ver callers).
 */
import { env } from 'cloudflare:workers';

/** Vida del token: 30 minutos. El anuncio se ve mientras esta fresco. */
export const TOKEN_TTL_MS = 30 * 60 * 1000;

/** Clave de desarrollo. Solo sirve para que el flujo funcione sin configurar nada. */
const DEV_FALLBACK_SECRET = 'gara-g-ads-dev-secret-no-usar-en-produccion';

export interface AdTokenPayload {
  campaignId: string;
  slot: string;
  /** HMAC del userId: sirve para el tope de frecuencia sin guardar el id en claro. */
  userHash: string;
  priceCOP: number;
  pricingModel: 'cpm' | 'cpc';
  /** Epoch ms de caducidad. */
  exp: number;
  /** Unico por emision: hace el clic idempotente (dos clics del mismo token, un cobro). */
  nonce: string;
}

export type TokenError = 'no_secret' | 'malformed' | 'bad_signature' | 'expired';

export type VerifyResult = { ok: true; payload: AdTokenPayload } | { ok: false; reason: TokenError };

/**
 * El entorno SOLO se considera de desarrollo si lo dice de forma EXPLICITA.
 *
 * Ronda 2 (M1): antes era "si no es production, usa la clave fija". Eso es un fallo ABIERTO:
 * si en produccion faltara la variable `ADS_TOKEN_SECRET` (o el entorno no llegara a
 * definirse, que es lo que pasa con un binding mal configurado), el sistema caia en la clave
 * fija PUBLICA del codigo y cualquiera podia firmar un token con el campaignId y el
 * priceCOP que quisiera, es decir, servirse anuncios y cobrarse a si mismo.
 *
 * Ahora la lista blanca es corta y explicita: `development`, `dev`, `test`, mas el
 * `import.meta.env.DEV` de Vite y `process.env.VITEST` (que es como corren los tests en Node).
 * Cualquier otra cosa —production, staging, preview, o un ENVIRONMENT desconocido o
 * ausente— se trata como PRODUCCION: sin secreto, no se firma.
 */
function isExplicitDev(): boolean {
  const declared = (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT?.toLowerCase();
  if (declared === 'development' || declared === 'dev' || declared === 'test') return true;

  // Un ENVIRONMENT DECLARADO que no es de desarrollo manda sobre todo lo de abajo: si el
  // despliegue dice "production", nada de lo que detecte el entorno de pruebas puede
  // rebajarlo a desarrollo. Sin esta precedencia, `process.env.VITEST` (que existe en
  // cualquier `vitest run`, tambien cuando el codigo se ejecuta en un staging) abriria la
  // clave fija en produccion, que es justo el fallo que M1 viene a cerrar.
  if (declared !== undefined && declared !== '') return false;

  // `import.meta.env.DEV` lo define Vite: true solo en el servidor de desarrollo.
  const viteDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  if (viteDev === true) return true;
  // vitest corre en Node, sin `import.meta.env`.
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (nodeEnv?.VITEST) return true;
  return false;
}

let warnedDevSecret = false;

/**
 * Secreto de firma. Lanza si no hay secreto fuera de un entorno de desarrollo explicito:
 * es preferible un 503 honesto (no se cobra nada, no se sirve nada) a firmar con una clave
 * que cualquiera puede replicar desde el codigo fuente.
 */
export function tokenSecret(): string {
  const secret = (env as unknown as { ADS_TOKEN_SECRET?: string }).ADS_TOKEN_SECRET;
  if (secret && secret.length >= 16) return secret;
  // Sin secreto y sin entorno de desarrollo EXPLICITO: no se firma. Ver isExplicitDev.
  if (!isExplicitDev()) {
    throw new Error('ADS_TOKEN_SECRET no configurado: no se pueden firmar anuncios fuera de desarrollo');
  }
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    console.warn('[ads] ADS_TOKEN_SECRET no configurado en desarrollo: se usa la clave fija de desarrollo.');
  }
  return DEV_FALLBACK_SECRET;
}

/** Hay secreto utilizable para firmar. Las rutas lo consultan para decidir 503 vs 200. */
export function hasUsableSecret(): boolean {
  try {
    tokenSecret();
    return true;
  } catch {
    return false;
  }
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/** Comparacion en tiempo constante: no filtra informacion por el tiempo que tarda. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Hash del usuario para el tope de frecuencia. HMAC del id con el mismo secreto: no
 * reversible sin el secreto y estable entre peticiones (mismo dia, mismo tope).
 */
export async function userHash(userId: string): Promise<string> {
  return hmac(tokenSecret(), `user:${userId}`);
}

function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/** Emite un token firmado para un anuncio con el precio ya calculado por la subasta. */
export async function signAdToken(input: {
  campaignId: string;
  slot: string;
  userHash: string;
  priceCOP: number;
  pricingModel: 'cpm' | 'cpc';
  now?: number;
  ttlMs?: number;
}): Promise<string> {
  const now = input.now ?? Date.now();
  const payload: AdTokenPayload = {
    campaignId: input.campaignId,
    slot: input.slot,
    userHash: input.userHash,
    priceCOP: Math.round(input.priceCOP),
    pricingModel: input.pricingModel,
    exp: now + (input.ttlMs ?? TOKEN_TTL_MS),
    nonce: randomNonce(),
  };
  const body = encodePayload(payload);
  const sig = await hmac(tokenSecret(), body);
  return `${body}.${sig}`;
}

function encodePayload(payload: AdTokenPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodePayload(body: string): AdTokenPayload | null {
  try {
    let bin = '';
    const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    for (const b of bytes) bin += String.fromCharCode(b);
    const parsed = JSON.parse(bin) as AdTokenPayload;
    if (
      typeof parsed.campaignId !== 'string' ||
      typeof parsed.slot !== 'string' ||
      typeof parsed.userHash !== 'string' ||
      typeof parsed.priceCOP !== 'number' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.nonce !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verifica firma y caducidad. NO cobra nada: solo dice si el token es de fiar.
 * El servidor que lo recibe decide si lo consume (idempotencia).
 */
export async function verifyAdToken(token: string | null | undefined, now = Date.now()): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const payload = decodePayload(body);
  if (!payload) return { ok: false, reason: 'malformed' };
  let expected: string;
  try {
    expected = await hmac(tokenSecret(), body);
  } catch {
    return { ok: false, reason: 'no_secret' };
  }
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: 'bad_signature' };
  if (now > payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}