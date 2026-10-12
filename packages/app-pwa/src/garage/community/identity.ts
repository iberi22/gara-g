/**
 * identity.ts — Identidad anonima del autor dentro de la instancia compartida.
 *
 * El foro y la wiki de una version son de todos los duenos de esa version, sin
 * importar el tenant: las filas viven en `gara-g-community` (COMMUNITY_INSTANCE_ID)
 * y las lee cualquiera con sesion. Por eso aqui no se puede guardar el `userId`
 * ni el correo: con ahi, un moderador (o cualquiera con acceso al D1) podria
 * mapear cada mensaje a una persona real y seguirla entre versiones.
 *
 * En su lugar se guarda un pseudonimo derivado del id de usuario:
 *   - `authorId`   = HMAC-SHA256(COMMUNITY_SECRET, userId) en base64url: sirve para
 *                   contar "mis mensajes" y aplicar el limite de ritmo, y no se
 *                   puede revertir sin conocer el secreto.
 *   - `authorName` = "Piloto-<6 chars>" derivado del mismo hash: es estable (el
 *                   mismo usuario conserva su alias entre hilos y versiones) pero
 *                   no reversible a la fuerza bruta, porque el HMAC esconde el
 *                   userId detras del secreto.
 *
 * `COMMUNITY_SECRET` sale del binding de Cloudflare (`cloudflare:workers`). Sin
 * el (dev local, tests) se usa una clave FIJA y se avisa por consola: preferimos un
 * pseudonimo debil en desarrollo a devolver 500 y bloquear el foro entero. En
 * produccion el secreto es obligatorio (ver `assertSecretInProduction`).
 */
import { env } from 'cloudflare:workers';
import { isExplicitDev } from '../devEnvironment';

/** Longitud del sufijo del alias. 6 caracteres base32 ≈ 30 bits: suficiente para
 * ser legible y bastante para separar autores dentro de una version. */
const ALIAS_CHARS = 6;
/**
 * Alfabeto del alias, sin 0/O ni 1/I/l (que se confunden leyendo en voz alta en un
 * taller). `String.raw` con escapes \u deja los caracteres como texto en el fuente:
 * escribir el caracter literal lo convertiria en un byte invisible al copiar/pegar.
 */
const ALIAS_ALPHABET = String.raw`23456789bcdfghjkmnpqrstvwxz`;

/** Clave fija de desarrollo. NUNCA usar con datos reales: es publica en el repo. */
const DEV_SECRET = 'gara-g-comunidad-dev-secret-no-usar-en-produccion';

/** Clave que se usa si el binding no trae `COMMUNITY_SECRET`. */
let cachedKey: string | null = null;


/**
 * Resuelve el secreto del binding. Cachea porque `importKey` es asincrono y en
 * cada mensaje se firma con la misma clave.
 */
async function secretKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const configured = (env as unknown as { COMMUNITY_SECRET?: string }).COMMUNITY_SECRET;
  if (typeof configured === 'string' && configured.length > 0) {
    cachedKey = configured;
    return cachedKey;
  }
  assertSecretInProduction();
  console.warn(
    '[comunidad] COMMUNITY_SECRET no esta definido: se usa la clave fija de desarrollo. ' +
      'Los alias NO son privados. Configuralo en el binding de Cloudflare antes de produccion.',
  );
  cachedKey = DEV_SECRET;
  return cachedKey;
}

/**
 * Si estamos en produccion sin secreto, fallar aqui es mejor que seguir: publicaria
 * un pseudonimo que cualquiera puede invertir probando userIds conocidos.
 */
function assertSecretInProduction(): void {
  // Falla cerrado: solo un entorno EXPLICITO de desarrollo/tests usa la clave fija
  // (ver devEnvironment.ts); ENVIRONMENT ausente o desconocido cuenta como produccion.
  if (!isExplicitDev()) {
    throw new Error(
      'COMMUNITY_SECRET es obligatorio en produccion: sin el, el pseudonimo del autor seria reversible.',
    );
  }
}

/** Solo para tests: olvida la clave cacheada tras cambiar el binding. */
export function resetCommunitySecretCache(): void {
  cachedKey = null;
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Pseudonimo estable del autor: HMAC del userId con el secreto de la comunidad.
 *
 * No es reversible sin `COMMUNITY_SECRET`, pero es determinista: el mismo usuario
 * obtiene siempre el mismo `authorId`, que es lo que permite reconocer "mi
 * mensaje" y limitar el ritmo sin guardar el id real.
 */
export async function authorHash(userId: string): Promise<string> {
  const key = await secretKey();
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // Copia a un Uint8Array fresco: crypto.subtle exige ArrayBuffer, no SharedArrayBuffer.
  const msg = new Uint8Array(enc.encode(userId));
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg as BufferSource);
  return base64Url(new Uint8Array(sig));
}

/**
 * Alias legible derivado del MISMO hash que `authorId` (no del userId directo):
 * asi no hace falta volver a firmar y sigue siendo estable entre versiones.
 * Formato: "Piloto-7fk2q9".
 */
export function aliasFromHash(authorId: string): string {
  // base64url -> bytes -> alphabet propio, para no exponer el HMAC crudo en pantalla.
  let out = '';
  for (let i = 0; i < ALIAS_CHARS; i++) {
    const ch = authorId.charCodeAt(i) + i * 7;
    out += ALIAS_ALPHABET[ch % ALIAS_ALPHABET.length];
  }
  return `Piloto-${out}`;
}

/** Par completo para guardar en una fila del foro o de la wiki. */
export interface AuthorPseudonym {
  authorId: string;
  authorName: string;
}

export async function pseudonymFor(userId: string): Promise<AuthorPseudonym> {
  const authorId = await authorHash(userId);
  return { authorId, authorName: aliasFromHash(authorId) };
}
