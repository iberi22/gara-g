/**
 * src/lib/password.ts — PBKDF2 password hashing via Web Crypto API.
 *
 * Compatible con Cloudflare Workers (Web Crypto disponible en runtime).
 * Formato serializado: base64(salt):base64(hash)
 *   - SALT_BYTES = 16 bytes aleatorios
 *   - KEY_BYTES  = 32 bytes (256 bits) derivados
 *   - Iteraciones: 100,000 (NIST SP 800-132 mínimo para SHA-256)
 *   - PRF: SHA-256
 *
 * NO se usa bcryptjs ni dependencias npm — solo crypto.subtle.
 */

const PBKDF2_ITERATIONS = 100000;
const HASH_ALGO = 'SHA-256';
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Deriva un PBKDF2-SHA256 key desde password + salt, devuelve raw bits. */
async function deriveBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  // crypto.subtle.importKey requiere BufferSource cuyo .buffer sea ArrayBuffer (no SharedArrayBuffer).
  // Hacemos una copia explícita a un Uint8Array fresh para garantizar el tipo ArrayBuffer.
  const passwordBytes = new Uint8Array(enc.encode(password));
  const saltCopy = new Uint8Array(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltCopy, iterations: PBKDF2_ITERATIONS, hash: HASH_ALGO },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Codifica Uint8Array a base64 estándar (no URL-safe). */
function toBase64(bytes: Uint8Array): string {
  // atob/btoa están disponibles en Cloudflare Workers runtime.
  // Para buffers grandes (>~8KB), usaríamos chunked; 32 bytes es trivial.
  return btoa(String.fromCharCode(...bytes));
}

/** Decodifica base64 a Uint8Array. */
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Hashea un password. Devuelve una cadena "salt:hash" base64.
 * Cada llamada genera una salt aleatoria nueva → mismo password produce hashes distintos.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(password, salt);
  return `${toBase64(salt)}:${toBase64(hash)}`;
}

/**
 * Verifica un password contra un hash serializado "salt:hash".
 * Compara en tiempo constante (timingSafeEqual) para evitar timing attacks.
 * Devuelve false si el formato es inválido, si el password no coincide, o si crypto.subtle falla.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(':');
    if (parts.length !== 2) return false;
    const [saltB64, hashB64] = parts;
    if (!saltB64 || !hashB64) return false;

    const salt = fromBase64(saltB64);
    const storedHash = fromBase64(hashB64);

    if (storedHash.length !== KEY_BYTES) return false;

    const candidate = await deriveBits(password, salt);

    // Comparación en tiempo constante. Cloudflare Workers expone
    // `crypto.timingSafeEqual(a, b)` en el global (extension runtime),
    // pero las types oficiales (@cloudflare/workers-types) lo declaran
    // vía ambient overload. Cast al tipo conocido para evitar el error TS
    // en builds donde la lib no lo expone directamente.
    const a = new Uint8Array(candidate);
    const b = new Uint8Array(storedHash);
    const c = crypto as unknown as {
      timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
    };
    if (typeof c.timingSafeEqual === 'function') {
      return c.timingSafeEqual(a, b);
    }
    // Fallback: comparación manual en tiempo constante (XOR acumulado).
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}
