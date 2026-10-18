import { createVaultClient, type PasskeyPrfProvider, VaultError } from '@swal/vault/web';
import { LockedError, TransitionInProgressError } from './recordCrypto';
import { LOCAL_INSTANCE_ID } from '../appMode';
import { type RecoveryKitV1, generateRecoveryKitCode, sealRecoveryKit, openRecoveryKit } from '../vaultRecoveryKit';

export type LockState = 'off' | 'locked' | 'unlocked' | 'transition' | 'error';

export interface DeviceLockStore {
  pinEnvelope?: string;
  passkeyEnvelope?: string;
  recoveryKit?: RecoveryKitV1;
  state?: 'transition' | 'active';
  targetMethod?: 'pin' | 'passkey' | 'off';
  failedAttempts?: number;
  lockedUntil?: number; // timestamp
  startedAt?: number; // timestamp de creación del marcador de transición (lease N1)
  markerId?: string; // id único del intento de habilitación: valla CAS entre pestañas (L2)
}

/** Error reintentable: el sobre cambió entre la foto y la escritura. */
export class StaleTicketError extends Error {
  constructor(message = 'La protección cambió durante la operación.') {
    super(message);
    this.name = 'StaleTicketError';
  }
}

export function isLockRetryable(err: unknown): boolean {
  return err instanceof StaleTicketError || err instanceof TransitionInProgressError;
}

function toBase64Std(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const STORE_NAME = 'gara-lock';
const KEY_NAME = 'envelope';
const LOCK_CHANNEL = 'gara-lock';
const LOCK_PING_KEY = 'gara-lock-ping';

let activeDataKey: CryptoKey | null = null;
let currentMethod: 'pin' | 'passkey' | null = null;
// Generación del sobre del que salió activeDataKey (M3): ata la clave en
// memoria al sobre persistido para que una rotación (disable+enable en otra
// pestaña) no deje una clave obsoleta que cifra filas perdidas.
let activeDataKeyGen: string | null = null;
let vaultClientInstance: ReturnType<typeof createVaultClient> | null = null;
let overridePasskeyProvider: PasskeyPrfProvider | undefined = undefined;

// Serializa enable/disable/unlock/changePin en este proceso: sin esto, dos
// enableProtection() concurrentes corren el PBKDF2 lento a la vez y compiten
// por el kekSalt del vault (un éxito aparente con sobre indescifrable).
// Los intentos de unlock también pasan por aquí para que cada uno cuente en el
// contador de lockout.
let transitionMutex: Promise<void> = Promise.resolve();

async function withTransitionMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = transitionMutex;
  let release!: () => void;
  transitionMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

// La conexión al IndexedDB del candado se abre por operación y se cierra al
// terminar: nunca se deja una conexión colgando por operación.
function openLockDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(STORE_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('indexedDB bloqueada'));
    } catch (err) {
      reject(err);
    }
  });
}

async function withLockDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openLockDb();
  try {
    return await fn(db);
  } finally {
    try {
      db.close();
    } catch {
      /* cierre best-effort */
    }
  }
}

async function getEnvelope(): Promise<DeviceLockStore | null | 'unreadable'> {
  ensureLockListener();
  let env: DeviceLockStore | null | 'unreadable';
  try {
    if (typeof indexedDB === 'undefined') return null;
    env = await withLockDb(
      (db) =>
        new Promise<DeviceLockStore | null | 'unreadable'>((resolve) => {
          try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(KEY_NAME);
            req.onsuccess = () => resolve((req.result as DeviceLockStore) || null);
            req.onerror = () => resolve('unreadable');
          } catch {
            resolve('unreadable');
          }
        })
    );
  } catch {
    return 'unreadable';
  }
  // N1: un marcador de transición sin sobres y caducado es una habilitación
  // interrumpida (passkey cancelada, pestaña cerrada durante la derivación).
  // La migración solo empieza DESPUÉS de persistir los sobres, así que
  // borrarlo es seguro. El lease evita que una lectura concurrente borre el
  // marcador legítimo de una habilitación en curso (el PBKDF2 es lento); el
  // fallo inmediato ( prompt cancelado) lo limpia la vía de error de
  // enableProtection sin esperar al lease.
  if (env && env !== 'unreadable' && isAbandonedMarker(env)) {
    try {
      // L2: borrado condicional en UNA transacción (releer+comparar+borrar):
      // si otra pestaña reemplazó el marcador mientras tanto, no se toca.
      const deleted = await casDeleteOwnMarker(env, true);
      if (deleted) {
        broadcastLockChange();
        return null;
      }
    } catch {
      /* best-effort */
    }
    // Alguien lo reemplazó mientras tanto: releer sin limpiar.
    try {
      return await getEnvelopeRaw();
    } catch {
      return 'unreadable';
    }
  }
  return env;
}

/**
 * U1/U2 (r5): TODA escritura del sobre que sigue a una derivación lenta (KDF,
 * unwrap, prompt) pasa por casMutateEnvelope / casDeleteEnvelopeIf /
 * recordFailedAttempt en vez de restaurar la copia leída antes de derivar.
 * Otra pestaña puede haber rotado el sobre mientras tanto (disable+enable con
 * PIN nuevo, changePin); reescribir la copia vieja resucita K1 tras un
 * disable+enable (datos perdidos), revierte un changePin y pierde incrementos
 * del contador entre pestañas. La comparación es generación+estado+marcador
 * (los contadores NO forman parte: un intento paralelo no invalida el CAS).
 * No queda ninguna escritura ciega del sobre tras un await en este módulo;
 * las escrituras incondicionales en UNA transacción (casInsertTransitionMarker
 * y los put/delete internos de los helpers CAS) nunca restauran una copia.
 */
interface EnvelopeIdentity {
  gen: string;
  state: string | null;
  marker: string | null;
}

/** Mensaje canónico cuando el sobre rotó bajo nuestros pies (U1/U2, L2). */
const PROTECTION_CHANGED_MSG =
  'La protección cambió en otra pestaña durante la operación; operación cancelada sin modificar tus datos.';

function envelopeIdentity(env: DeviceLockStore): EnvelopeIdentity {
  return {
    gen: envelopeGeneration(env),
    state: env.state ?? null,
    marker: env.markerId ?? null,
  };
}

function sameEnvelopeIdentity(a: EnvelopeIdentity, b: EnvelopeIdentity): boolean {
  return a.gen === b.gen && a.state === b.state && a.marker === b.marker;
}

/**
 * Mutación condicional en UNA sola transacción (U1/U2): relee el sobre y le
 * aplica `mutate` + put SOLO si generación, estado y marcador siguen siendo
 * los de la foto `expected`. Devuelve true si escribió; false si el sobre
 * cambió o desapareció (abortar sin escribir y sin tocar la clave en memoria).
 */
async function casMutateEnvelope(
  expected: DeviceLockStore,
  mutate: (cur: DeviceLockStore) => void
): Promise<boolean> {
  const want = envelopeIdentity(expected);
  return withLockDb(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(KEY_NAME);
        get.onsuccess = () => {
          const cur = get.result as DeviceLockStore | undefined;
          if (!cur || !sameEnvelopeIdentity(envelopeIdentity(cur), want)) {
            try {
              tx.abort();
            } catch {
              /* ya terminó */
            }
            resolve(false);
            return;
          }
          mutate(cur);
          store.put(cur, KEY_NAME);
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      })
  );
}

/**
 * Borrado condicional por identidad (U1/U2): solo borra si el sobre almacenado
 * sigue siendo la misma generación/estado/marcador que la foto `expected`.
 * Si ya no hay sobre (otra pestaña terminó la MISMA transición), devuelve true:
 * no es un error. Si cambió a otra cosa, devuelve false (abortar con error).
 */
async function casDeleteEnvelopeIf(expected: DeviceLockStore): Promise<boolean> {
  const want = envelopeIdentity(expected);
  return withLockDb(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(KEY_NAME);
        get.onsuccess = () => {
          const cur = get.result as DeviceLockStore | undefined;
          // Sin escritura pendiente la transacción confirma sin cambios.
          if (!cur) {
            resolve(true);
            return;
          }
          if (!sameEnvelopeIdentity(envelopeIdentity(cur), want)) {
            try {
              tx.abort();
            } catch {
              /* ya terminó */
            }
            resolve(false);
            return;
          }
          store.delete(KEY_NAME);
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      })
  );
}

/**
 * Incremento atómico del contador sobre el sobre ACTUAL (U1/U2): UNA sola
 * transacción relee el sobre almacenado ahora e incrementa SU contador, sin
 * restaurar ninguna copia vieja. Así dos pestañas que fallan a la vez no
 * pierden incrementos y un fallo contra un sobre ya rotado no resucita K1.
 * Si ya no hay sobre (la protección se desactivó mientras tanto), lanza el
 * error de protección cambiada en vez de inventar un contador.
 */
async function recordFailedAttempt(): Promise<void> {
  const incremented = await withLockDb(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(KEY_NAME);
        let wrote = false;
        get.onsuccess = () => {
          const cur = get.result as DeviceLockStore | undefined;
          if (!cur) {
            try {
              tx.abort();
            } catch {
              /* ya terminó */
            }
            resolve(false);
            return;
          }
          cur.failedAttempts = (cur.failedAttempts || 0) + 1;
          cur.lockedUntil = Date.now() + calculateDelay(cur.failedAttempts);
          store.put(cur, KEY_NAME);
          wrote = true;
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => resolve(wrote);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      })
  );
  if (!incremented) {
    throw new StaleTicketError(PROTECTION_CHANGED_MSG);
  }
  broadcastLockChange();
}

/**
 * Relee el sobre y falla si ya no es la foto `expected` (U1/U2): la clave
 * recién derivada es de otra generación y publicarla corrompería datos.
 * No escribe nada y no toca la clave en memoria.
 */
async function assertEnvelopeUnchanged(expected: DeviceLockStore): Promise<void> {
  const cur = await getEnvelopeRaw();
  if (
    cur &&
    cur !== 'unreadable' &&
    sameEnvelopeIdentity(envelopeIdentity(cur), envelopeIdentity(expected))
  ) {
    return;
  }
  throw new StaleTicketError(PROTECTION_CHANGED_MSG);
}

/**
 * Inserción condicional en UNA sola transacción (lectura+escritura atómicas):
 * solo crea el marcador si no hay ningún sobre. Así dos pestañas que habilitan
 * a la vez no compiten: una gana y la otra rechaza sin tocar el vault.
 */
async function casInsertTransitionMarker(marker: DeviceLockStore): Promise<boolean> {
  return withLockDb(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(KEY_NAME);
        get.onsuccess = () => {
          if (get.result) {
            // Alguien se adelantó: abortar sin escribir nada.
            try {
              tx.abort();
            } catch {
              /* ya terminó */
            }
            resolve(false);
            return;
          }
          store.put(marker, KEY_NAME);
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
          // El abort() deliberado también cae aquí: resolver según lo leído.
          resolve(false);
        };
        tx.onabort = () => resolve(false);
      })
  );
}

function newMarkerId(): string {
  try {
    const rc = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    if (rc.crypto && typeof rc.crypto.randomUUID === 'function') return rc.crypto.randomUUID();
  } catch {
    /* fallback */
  }
  return `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
}

/** ¿Sigue almacenado el marcador `markerId` en transición (nuestro intento)? */
function isOurMarker(cur: unknown, markerId: string): cur is DeviceLockStore {
  if (!cur || typeof cur !== 'object') return false;
  const env = cur as DeviceLockStore;
  return env.state === 'transition' && env.markerId === markerId;
}

/**
 * Escritura condicional en UNA sola transacción (L2): solo guarda `next` si el
 * sobre almacenado sigue siendo nuestro marcador `markerId` en transición.
 * Devuelve true si escribió; false si otra pestaña lo reemplazó (abortar sin
 * tocar nada: ni sobre, ni migración).
 */
async function casWriteEnvelopeIfMarker(markerId: string, next: DeviceLockStore): Promise<boolean> {
  return withLockDb(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(KEY_NAME);
        get.onsuccess = () => {
          if (!isOurMarker(get.result, markerId)) {
            try {
              tx.abort();
            } catch {
              /* ya terminó */
            }
            resolve(false);
            return;
          }
          store.put(next, KEY_NAME);
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      })
  );
}

/**
 * Borrado condicional en UNA sola transacción (L2): solo borra si el sobre
 * almacenado sigue siendo el marcador esperado, sin sobres persistidos (la
 * migración solo empieza DESPUÉS de persistirlos) y —si `onlyIfAbandoned`—
 * con el lease vencido. Así la limpieza de un marcador huérfano nunca borra
 * el marcador fresco (o el sobre activo) de otra pestaña.
 */
async function casDeleteOwnMarker(
  expected: DeviceLockStore,
  onlyIfAbandoned: boolean
): Promise<boolean> {
  return withLockDb(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(KEY_NAME);
        get.onsuccess = () => {
          const cur = get.result as DeviceLockStore | undefined;
          const matches =
            !!cur &&
            cur.state === 'transition' &&
            (cur.markerId ?? null) === (expected.markerId ?? null) &&
            (cur.startedAt ?? null) === (expected.startedAt ?? null) &&
            !cur.pinEnvelope &&
            !cur.passkeyEnvelope &&
            (!onlyIfAbandoned || isAbandonedMarker(cur));
          if (!matches) {
            try {
              tx.abort();
            } catch {
              /* ya terminó */
            }
            resolve(false);
            return;
          }
          store.delete(KEY_NAME);
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      })
  );
}

/**
 * Renueva el lease del marcador (L2) solo si sigue siendo nuestro: extiende
 * `startedAt` al ahora para que un prompt lento (passkey) no lo caduque
 * innecesariamente. Devuelve false si otra pestaña tomó el relevo.
 */
async function touchTransitionMarker(marker: DeviceLockStore): Promise<boolean> {
  if (!marker.markerId) return true;
  marker.startedAt = Date.now();
  return casWriteEnvelopeIfMarker(marker.markerId, marker);
}



function getVaultClient() {
  if (!vaultClientInstance) {
    vaultClientInstance = createVaultClient({
      storage: 'idb',
      passkey: overridePasskeyProvider,
      pbkdf2Iterations: 600000,
    });
  }
  return vaultClientInstance;
}

export function setPasskeyProvider(provider?: PasskeyPrfProvider) {
  overridePasskeyProvider = provider;
  vaultClientInstance = null; // Recreate next time
}

// Invalidación entre pestañas: cada confirmación del sobre avisa; las demás
// pestañas sueltan la clave en memoria si ya no hay sobre activo. Best-effort:
// la relectura del sobre antes de cada escritura es la garantía real.
let lockListenerOn = false;

function handleLockInvalidation(): void {
  void getEnvelopeRaw().then((env) => {
    // Solo un sobre AUSENTE invalida la clave: en 'transition' la clave sigue
    // siendo necesaria (la propia desactivación/activación la usa para migrar,
    // y resumeTransition la fija temporalmente). Limpiarla aquí rompía la
    // migración en curso y dejaba el marcador atascado.
    if (env === 'unreadable') return;
    if (env === null) {
      clearStaleMemoryKey();
      return;
    }
    // Transición sin sobres: marcador huérfano o habilitación en curso; la
    // clave en memoria de esta pestaña ya es de otra generación (el CAS solo
    // inserta desde "sin sobre"). La pestaña que habilita aún no tiene
    // clave en memoria, así que limpiarla no rompe la migración.
    if (env.state === 'transition' && !env.pinEnvelope && !env.passkeyEnvelope) {
      clearStaleMemoryKey();
      return;
    }
    // M3: el sobre rotó bajo nuestros pies (otra pestaña deshabilitó y
    // rehabilitó sin que nos llegara el aviso, o con la pestaña congelada).
    if (env.state === 'active' && activeDataKey && !isMemoryKeyValidFor(env)) {
      clearStaleMemoryKey();
    }
  });
}

// Lectura sin re-enganchar el listener (para usar desde el propio listener).
async function getEnvelopeRaw(): Promise<DeviceLockStore | null | 'unreadable'> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    return await withLockDb(
      (db) =>
        new Promise<DeviceLockStore | null | 'unreadable'>((resolve) => {
          try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(KEY_NAME);
            req.onsuccess = () => resolve((req.result as DeviceLockStore) || null);
            req.onerror = () => resolve('unreadable');
          } catch {
            resolve('unreadable');
          }
        })
    );
  } catch {
    return 'unreadable';
  }
}

export function ensureLockListener(): void {
  if (lockListenerOn) return;
  lockListenerOn = true;
  try {
    const BC = (globalThis as unknown as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    if (typeof BC !== 'undefined') {
      const ch = new BC(LOCK_CHANNEL);
      ch.onmessage = () => handleLockInvalidation();
    }
  } catch {
    /* sin BroadcastChannel: la relectura sigue protegiendo */
  }
  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (ev) => {
        if (ev.key === LOCK_PING_KEY) handleLockInvalidation();
      });
    }
  } catch {
    /* sin eventos storage: la relectura sigue protegiendo */
  }
}

let lockChannel: BroadcastChannel | null = null;

function broadcastLockChange(): void {
  try {
    const BC = (globalThis as unknown as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    if (typeof BC !== 'undefined') {
      lockChannel ??= new BC(LOCK_CHANNEL);
      lockChannel.postMessage({ t: Date.now() });
    }
  } catch {
    /* best-effort */
  }
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      window.localStorage.setItem(LOCK_PING_KEY, String(Date.now()));
    }
  } catch {
    /* best-effort */
  }
}

function clearStaleMemoryKey(): void {
  activeDataKey = null;
  activeDataKeyGen = null;
  currentMethod = null;
  try {
    vaultClientInstance?.lock();
  } catch {
    /* best-effort */
  }
}

/** Lease del marcador de transición sin sobres (N1): pasado esto se considera huérfano. */
const TRANSITION_MARKER_LEASE_MS = 120_000;

function isAbandonedMarker(env: DeviceLockStore): boolean {
  if (env.state !== 'transition') return false;
  if (env.pinEnvelope || env.passkeyEnvelope) return false;
  // Sin startedAt es un marcador anterior a este lease: huérfano directo.
  if (typeof env.startedAt !== 'number') return true;
  return Date.now() - env.startedAt > TRANSITION_MARKER_LEASE_MS;
}

/** Generación del sobre activo: los sobres envueltos identifican el material de clave. */
function envelopeGeneration(env: DeviceLockStore): string {
  return `${env.pinEnvelope ?? ''}|${env.passkeyEnvelope ?? ''}`;
}

/** ¿Sigue siendo válida la clave en memoria para este sobre persistido? (M3) */
function isMemoryKeyValidFor(env: DeviceLockStore | null | 'unreadable'): boolean {
  if (!activeDataKey || !activeDataKeyGen) return false;
  if (!env || env === 'unreadable') return false;
  if (env.state !== 'active') return false;
  return envelopeGeneration(env) === activeDataKeyGen;
}

export async function getLockState(): Promise<LockState> {
  const env = await getEnvelope();
  if (env === 'unreadable') return 'error';

  if (env && env.state === 'transition') return 'transition';

  // El estado deriva del sobre persistido, no de la memoria: una pestaña cuya
  // protección se desactivó en otra parte deja de verse como 'unlocked'.
  // M3: además la clave en memoria debe ser de la generación del sobre.
  if (env && env.state === 'active') {
    if (activeDataKey && isMemoryKeyValidFor(env)) return 'unlocked';
    if (activeDataKey) clearStaleMemoryKey();
    return 'locked';
  }
  if (activeDataKey) clearStaleMemoryKey();
  return 'off';
}

export function getActiveKey(): CryptoKey | null {
  return activeDataKey;
}

export function getMethod(): 'pin' | 'passkey' | null {
  return currentMethod;
}

// TODO: recovery flow must go through the vault recovery kit of PR #35
// and the same phone's biometrics/pattern.

// Helper functions for retry delays
function calculateDelay(attempts: number): number {
  if (attempts <= 0) return 0;
  // Progressive delay: 1s, 2s, 4s, 8s... max 5 minutes (300000ms)
  const delaySec = Math.pow(2, attempts - 1);
  return Math.min(delaySec * 1000, 300000);
}

/** Un PIN válido son EXACTAMENTE seis dígitos (no cualquier cadena de 6 caracteres). */
const PIN_PATTERN = /^\d{6}$/;

/**
 * Foto del sobre para una escritura: congela (estado, clave) ANTES del cifrado
 * asíncrono. verifyTicket() la revalida justo antes de confirmar la escritura;
 * si el sobre cambió (otra pestaña, enable/disable concurrente), la operación
 * se reintenta con una foto nueva en vez de dejar ciphertext huérfano o
 * plaintext con protección activa.
 */
export interface WriteTicket {
  envJson: string;
  active: boolean;
  key: CryptoKey | null;
  /** Generación del sobre en el momento de la foto (M3). */
  gen: string;
}

export async function snapshotTicket(): Promise<WriteTicket> {
  const env = await getEnvelope();
  if (env === 'unreadable') {
    throw new LockedError('Estado de protección ilegible: operaciones bloqueadas.');
  }
  if (env && env.state === 'transition') {
    throw new TransitionInProgressError();
  }
  if (env && env.state === 'active') {
    const key = getActiveKey();
    // M3: la clave en memoria debe ser de la generación del sobre; si otra
    // pestaña rotó la protección, esta clave cifraría filas perdidas.
    if (!key || !isMemoryKeyValidFor(env)) {
      if (activeDataKey) clearStaleMemoryKey();
      throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
    }
    return { envJson: JSON.stringify(env), active: true, key, gen: activeDataKeyGen as string };
  }
  // Sin sobre no hay cifrado; si quedaba una clave en memoria, ya es obsoleta.
  if (activeDataKey) clearStaleMemoryKey();
  return { envJson: JSON.stringify(env), active: false, key: null, gen: '' };
}

/** Revalida la foto justo antes de escribir. Lanza StaleTicketError si cambió.
 *
 * NOTA (M3): el sobre vive en 'gara-lock' y los datos en 'gara-local' /
 * 'gara-mesh': no caben en una sola transacción IndexedDB, así que esto es
 * verificar-y-escribir con la comprobación del nonce (gen) inmediatamente
 * antes de confirmar. Queda una ventana residual (otro hilo podría rotar el
 * sobre entre la verificación y el commit); en la práctica es de microtareas,
 * la puerta opGate la cierra dentro del mismo hilo y el reintento con foto
 * nueva + el descifrado que falla la delatan. */
export async function verifyTicket(ticket: WriteTicket): Promise<void> {
  const env = await getEnvelope();
  if (env === 'unreadable') {
    throw new LockedError('Estado de protección ilegible: operaciones bloqueadas.');
  }
  if (JSON.stringify(env) !== ticket.envJson) {
    if (env && env.state === 'transition') throw new TransitionInProgressError();
    // La foto cambió: la clave en memoria solo es obsoleta si ya no es de la
    // generación del sobre nuevo (un changePin en esta pestaña actualiza
    // ambas y el reintento debe seguir funcionando).
    if (
      activeDataKey &&
      activeDataKeyGen &&
      (!env || env.state !== 'active' || envelopeGeneration(env) !== activeDataKeyGen)
    ) {
      clearStaleMemoryKey();
    }
    throw new StaleTicketError();
  }
  if (ticket.active) {
    const cur = env as DeviceLockStore | null;
    if (
      !cur ||
      cur.state !== 'active' ||
      envelopeGeneration(cur) !== ticket.gen ||
      getActiveKey() !== ticket.key ||
      activeDataKeyGen !== ticket.gen
    ) {
      if (getActiveKey()) clearStaleMemoryKey();
      throw new StaleTicketError();
    }
  }
}

/**
 * Foto del sobre con espera acotada a transiciones en curso. La espera NUNCA
 * es infinita: si el marcador queda atascado (fallo sin reanudar), la
 * operación falla en vez de colgar el hilo para siempre.
 */
export async function takeTicket(maxAttempts = 20): Promise<WriteTicket> {
  let last: unknown = new TransitionInProgressError();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await snapshotTicket();
    } catch (err) {
      if (!isLockRetryable(err)) throw err;
      last = err;
    }
    await waitForSettledState(250);
  }
  throw last;
}

/** Espera acotada a que termine una transición (para reintentos). */
export async function waitForSettledState(timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const env = await getEnvelope();
    if (env === 'unreadable' || !env || env.state !== 'transition') return;
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Reanuda una transición interrumpida (app cerrada o fallo) usando la clave ya
 * recuperada del sobre. "off" termina la desactivación; cualquier otro target
 * termina la activación. El sobre NO se borra hasta confirmar la migración, así
 * que la clave siempre sigue siendo recuperable si esto vuelve a fallar.
 */
async function resumeTransition(env: DeviceLockStore, key: CryptoKey): Promise<void> {
  const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
  const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');

  // U1/U2: la clave se derivó del sobre `env` ANTES de la KDF lenta; si el
  // sobre almacenado ya no es el mismo (otra pestaña rotó la protección),
  // abortar SIN migrar, SIN escribir y SIN tocar la clave en memoria.
  await assertEnvelopeUnchanged(env);

  if (env.targetMethod === 'off') {
    // Desactivación interrumpida: terminar de descifrar y quitar el sobre.
    activeDataKey = key; // necesaria para descifrar durante la migración a texto plano
    activeDataKeyGen = envelopeGeneration(env);
    try {
      await migrateLocalStoresEncryption(null);
      await migrateIdentityStoreEncryption(null);
    } finally {
      activeDataKey = null;
      activeDataKeyGen = null;
    }
    const cleared = await casDeleteEnvelopeIf(env);
    if (!cleared) {
      throw new StaleTicketError(PROTECTION_CHANGED_MSG);
    }
    broadcastLockChange();
    currentMethod = null;
    if (vaultClientInstance) vaultClientInstance.lock();
    return;
  }

  // Activación interrumpida: terminar de cifrar y marcar el sobre como activo.
  const method: 'pin' | 'passkey' = env.targetMethod === 'passkey' ? 'passkey' : 'pin';
  await migrateLocalStoresEncryption(key);
  await migrateIdentityStoreEncryption(key);
  const won = await casMutateEnvelope(env, (cur) => {
    cur.state = 'active';
    cur.targetMethod = undefined;
  });
  if (!won) {
    throw new StaleTicketError(PROTECTION_CHANGED_MSG);
  }
  broadcastLockChange();
  activeDataKey = key;
  activeDataKeyGen = envelopeGeneration(env);
  currentMethod = method;
}

// Devuelve código de recuperación de alta entropía (16 bytes en hex) al habilitar
export async function enableProtection(method: 'pin' | 'passkey', secret?: string): Promise<string> {
  return withTransitionMutex(async () => {
    const env0 = await getEnvelope();
    if (env0 === 'unreadable') {
      throw new Error('Estado de protección ilegible: no se puede habilitar.');
    }
    if (env0 && env0.state === 'transition') {
      throw new Error('Hay una transición pendiente. Desbloquea para reanudarla antes de volver a habilitar.');
    }
    if (env0 && env0.state === 'active') {
      throw new Error('La protección ya está habilitada');
    }

    // El PIN de respaldo (seis dígitos) es obligatorio también con passkey: si el PRF
    // deja de estar disponible no debe quedar sin alternativa.
    const pin = secret ?? '';
    if (!PIN_PATTERN.test(pin)) {
      if (method === 'passkey') throw new Error('Se requiere un PIN de 6 dígitos como respaldo de la passkey');
      if (method === 'pin') throw new Error('PIN debe tener exactamente 6 dígitos');
      throw new Error('Método desconocido');
    }

    // Marcador condicional ANTES del PBKDF2 lento: la perdedora de una carrera
    // (misma u otra pestaña) rechaza aquí sin tocar el vault ni el estado.
    const envelopeStore: DeviceLockStore = {
      state: 'transition',
      targetMethod: method,
      failedAttempts: 0,
      lockedUntil: 0,
      startedAt: Date.now(),
      markerId: newMarkerId(),
    };
    // La valla CAS exige markerId: sin él no se puede distinguir nuestro
    // intento del de otra pestaña.
    const markerId = envelopeStore.markerId as string;
    const won = await casInsertTransitionMarker(envelopeStore);
    if (!won) {
      throw new Error('La protección ya está habilitada');
    }
    broadcastLockChange();

    try {
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const newActiveDataKey = await crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );

      const vc = getVaultClient();
      let pinEnvelope: string | undefined;
      let passkeyEnvelope: string | undefined;

      if (method === 'passkey') {
        // L2: renovar el lease justo antes del prompt (lento) para que no
        // caduque innecesariamente; si otra pestaña tomó el relevo, abortar
        // ya sin tocar nada.
        if (!(await touchTransitionMarker(envelopeStore))) {
          throw new Error(
            'La protección cambió en otra pestaña durante la habilitación; operación cancelada sin modificar tus datos.'
          );
        }
        await vc.unlock({ passkey: true });
        passkeyEnvelope = await vc.wrapKey(rawKey);
        // Respaldo obligatorio por PIN.
        await vc.lock();
        await vc.unlock({ passphrase: pin });
        pinEnvelope = await vc.wrapKey(rawKey);
      } else {
        await vc.unlock({ passphrase: pin });
        pinEnvelope = await vc.wrapKey(rawKey);
      }

      // Persistir la clave envuelta junto al marcador: si algo falla después,
      // unlock() puede reanudar la transición con la credencial original.
      // L2: escritura vallada — si el marcador ya no es el nuestro (otra
      // pestaña limpió el lease y habilitó), abortar SIN migrar y SIN tocar
      // el sobre ajeno. Se renueva el lease para cubrir la migración.
      envelopeStore.pinEnvelope = pinEnvelope;
      envelopeStore.passkeyEnvelope = passkeyEnvelope;
      envelopeStore.startedAt = Date.now();
      if (!(await casWriteEnvelopeIfMarker(markerId, envelopeStore))) {
        throw new Error(
          'La protección cambió en otra pestaña durante la habilitación; operación cancelada sin modificar tus datos.'
        );
      }

      // 2. Migrar (coordinada con las escrituras en curso dentro del adaptador).
      // Si algo falla, el sobre NO se borra: es la única forma de recuperar la clave. La
      // transición queda pendiente y unlock() la reanuda o revierte con la credencial original.
      const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
      await migrateLocalStoresEncryption(newActiveDataKey);

      const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
      await migrateIdentityStoreEncryption(newActiveDataKey);

      // 3. Mark as active (vallado: el sobre sigue siendo nuestro).
      envelopeStore.state = 'active';
      envelopeStore.targetMethod = undefined;
      const code = await generateRecoveryKitCode();
      envelopeStore.recoveryKit = await sealRecoveryKit(
        'gara-g',
        LOCAL_INSTANCE_ID,
        [{ entity: 'device-lock', id: 'data-key', share: { index: 2, value: toBase64Std(rawKey) } }],
        code
      );
      if (!(await casWriteEnvelopeIfMarker(markerId, envelopeStore))) {
        throw new StaleTicketError(
          'La protección cambió en otra pestaña durante la habilitación; operación cancelada sin modificar tus datos.'
        );
      }
      broadcastLockChange();

      // 4. Publish state in memory
      activeDataKey = newActiveDataKey;
      activeDataKeyGen = envelopeGeneration(envelopeStore);
      currentMethod = method;

      return code;
    } catch (err) {
      // Sin clave a medio publicar: la transición queda pendiente y reanudable.
      activeDataKey = null;
      activeDataKeyGen = null;
      currentMethod = null;
      try {
        getVaultClient().lock();
      } catch {
        /* best-effort */
      }
      // N1: si el fallo fue ANTES de persistir los sobres (passkey cancelada,
      // KDF interrumpida), el marcador quedó huérfano: borrarlo solo si sigue
      // siendo nuestro y sin sobres (L2: borrado condicional en una
      // transacción). La migración solo empieza después de persistirlos, así
      // que borrarlo no pierde nada recuperable.
      try {
        const deleted = await casDeleteOwnMarker(envelopeStore, false);
        if (deleted) broadcastLockChange();
      } catch {
        /* best-effort */
      }
      throw err;
    }
  });
}

export async function unlock(method: 'pin' | 'passkey' | 'recovery', secret?: string): Promise<void> {
  // Pre-chequeo ANTES de encolar en el mutex: intentos genuinamente paralelos
  // ven el mismo contador y cada uno cuenta; el lockout solo frena a los que
  // llegan después de que ya haya espera programada.
  const pre = await getEnvelope();
  if (pre === 'unreadable') throw new Error('Estado de protección ilegible');
  if (!pre || (pre.state !== 'active' && pre.state !== 'transition')) {
    throw new Error('No hay protección habilitada o estado corrupto');
  }
  if (pre.lockedUntil && Date.now() < pre.lockedUntil) {
    throw new VaultError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.');
  }
  // Validación neutra: un método o formato inválido nunca cuenta como intento.
  if (method !== 'pin' && method !== 'passkey' && method !== 'recovery') {
    throw new Error('Método desconocido');
  }
  if (method === 'pin' && (!secret || !PIN_PATTERN.test(secret))) {
    throw new Error('PIN debe tener exactamente 6 dígitos');
  }

  return withTransitionMutex(async () => {
    const env = await getEnvelope();
    if (env === 'unreadable') throw new Error('Estado de protección ilegible');
    if (!env || (env.state !== 'active' && env.state !== 'transition')) {
      throw new Error('No hay protección habilitada o estado corrupto');
    }
    // N4/L1: revalidar el lockout DENTRO del mutex con el sobre recién leído
    // ANTES de cualquier comprobación de clave (KDF/unwrap). Los intentos
    // encolados en paralelo veían todos el mismo contador; si el bloqueado
    // llegara al KDF, un PIN erróneo devolvería BAD_KEY y el correcto LOCKED,
    // y ese oráculo permitiría al atacante localizar el PIN y esperar al
    // desbloqueo. En lockout la respuesta es idéntica sea cual sea el PIN:
    // el intento cuenta (extiende el bloqueo, como exige T5) y se rechaza.
    if (env.lockedUntil && Date.now() < env.lockedUntil) {
      // U1/U2: incremento atómico sobre el sobre ACTUAL, nunca la copia leída.
      await recordFailedAttempt();
      throw new VaultError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.');
    }

    const vc = getVaultClient();
    let rawKey: Uint8Array;

    try {
      if (method === 'recovery') {
        if (!env.recoveryKit) throw new Error('No hay código de recuperación configurado');
        const entries = await openRecoveryKit(env.recoveryKit, secret ?? '', {
          appId: 'gara-g',
          instanceId: LOCAL_INSTANCE_ID
        });
        const entry = entries[0];
        const b64 = (entry.share as { value: string }).value;
        const binString = atob(b64);
        rawKey = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i++) {
          rawKey[i] = binString.charCodeAt(i);
        }
      } else if (method === 'pin') {
        if (!env.pinEnvelope) throw new Error('No hay PIN configurado');
        await vc.unlock({ passphrase: secret as string });
        rawKey = await vc.unwrapKey(env.pinEnvelope);
      } else {
        if (!env.passkeyEnvelope) throw new Error('No hay Passkey configurado');
        await vc.unlock({ passkey: true });
        rawKey = await vc.unwrapKey(env.passkeyEnvelope);
      }
    } catch (err) {
      // Solo un fallo criptográfico real (BAD_KEY) cuenta como intento, y lo
      // cuenta sobre el sobre ACTUAL (U1/U2): restaurar la copia `env` tras la
      // KDF lenta resucitaría K1 tras un disable+enable o revertiría un changePin.
      if (err instanceof VaultError && err.code === 'BAD_KEY') {
        await recordFailedAttempt();
        throw new VaultError('BAD_KEY', 'PIN o código incorrecto');
      }
      throw err;
    }

    // Success - reset attempts, pero SOLO si el sobre sigue siendo el mismo
    // que se derivó (U1/U2): si rotó en otra pestaña, abortar sin escribir y
    // sin publicar la clave obsoleta en memoria.
    if (env.failedAttempts && env.failedAttempts > 0) {
      const reset = await casMutateEnvelope(env, (cur) => {
        cur.failedAttempts = 0;
        cur.lockedUntil = 0;
      });
      if (!reset) {
        throw new StaleTicketError(PROTECTION_CHANGED_MSG);
      }
    }

    const key = await crypto.subtle.importKey(
      'raw',
      rawKey as unknown as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    // U1: la importación es asíncrona; revalidar antes de publicar la clave en
    // memoria para no fijar K1 cuando ya rige K2 (resumeTransition revalida
    // además por su cuenta antes de migrar).
    await assertEnvelopeUnchanged(env);

    // Si la app se cerró a mitad de una transición, reanudarla con la clave recuperada.
    if (env.state === 'transition') {
      await resumeTransition(env, key);
      broadcastLockChange();
      return;
    }

    activeDataKey = key;
    activeDataKeyGen = envelopeGeneration(env);
    if (method === 'recovery') {
      currentMethod = env.targetMethod && env.targetMethod !== 'off' ? env.targetMethod : (env.pinEnvelope ? 'pin' : 'passkey');
    } else {
      currentMethod = method === 'passkey' ? 'passkey' : 'pin';
    }
  });
}

export function lock(): void {
  activeDataKey = null;
  activeDataKeyGen = null;
  currentMethod = null;
  if (vaultClientInstance) vaultClientInstance.lock();
}

export async function disableProtection(): Promise<void> {
  return withTransitionMutex(async () => {
    if (!activeDataKey) throw new Error('Debe desbloquear antes de deshabilitar');

    const env = await getEnvelope();
    if (env === 'unreadable' || !env || env.state !== 'active') return; // Already disabled or mid-transition

    // U1/U2: la clave en memoria debe ser de la generación del sobre; si otra
    // pestaña rotó la protección, esta clave descifraría filas perdidas.
    if (!isMemoryKeyValidFor(env)) {
      clearStaleMemoryKey();
      throw new StaleTicketError(PROTECTION_CHANGED_MSG);
    }

    // 1. Mark transition (CAS: si el sobre cambió bajo nuestros pies, abortar).
    const marked = await casMutateEnvelope(env, (cur) => {
      cur.state = 'transition';
      cur.targetMethod = 'off';
    });
    if (!marked) {
      throw new StaleTicketError(PROTECTION_CHANGED_MSG);
    }
    // Foto del marcador para el borrado final: el estado esperado ya es
    // transition/off, no el active original.
    const markedEnv: DeviceLockStore = { ...env, state: 'transition', targetMethod: 'off' };
    broadcastLockChange();

    // 2. Migrate back to plain text. Si falla, se conserva el estado 'transition' y el
    // sobre, de modo que unlock() puede reanudar o revertir sin perder la clave.
    const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
    await migrateLocalStoresEncryption(null);

    const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
    await migrateIdentityStoreEncryption(null);

    // 3. Clear envelope (condicional: si otra pestaña terminó la MISMA
    // transición ya no hay sobre y no es un error; si cambió a otra cosa,
    // abortar con error claro).
    const cleared = await casDeleteEnvelopeIf(markedEnv);
    if (!cleared) {
      throw new StaleTicketError(PROTECTION_CHANGED_MSG);
    }
    broadcastLockChange();

    // 4. Clear memory
    activeDataKey = null;
    activeDataKeyGen = null;
    currentMethod = null;
    if (vaultClientInstance) vaultClientInstance.lock();
  });
}

export async function changePin(oldPin: string, newPin: string): Promise<void> {
  return withTransitionMutex(async () => {
    if (!activeDataKey) throw new Error('Debe desbloquear antes de cambiar PIN');
    if (!PIN_PATTERN.test(newPin)) throw new Error('El nuevo PIN debe tener exactamente 6 dígitos');

    const vc = getVaultClient();
    const env = await getEnvelope();
    if (env === 'unreadable' || !env || !env.pinEnvelope) throw new Error('No hay PIN configurado');

    // Unwrap with old PIN just to verify they know the old PIN
    await vc.unlock({ passphrase: oldPin });
    const rawKey = await vc.unwrapKey(env.pinEnvelope);

    // Wrap with new PIN
    await vc.unlock({ passphrase: newPin });
    const newEnvelope = await vc.wrapKey(rawKey);

    // U1/U2: la derivación es lenta; solo persistir si el sobre sigue siendo el
    // mismo que se verificó (si otra pestaña rotó o contó intentos mientras
    // tanto, abortar sin escribir y sin tocar la clave en memoria). Los
    // contadores ajenos se conservan: se muta la copia almacenada, no `env`.
    const won = await casMutateEnvelope(env, (cur) => {
      cur.pinEnvelope = newEnvelope;
    });
    if (!won) {
      throw new StaleTicketError(PROTECTION_CHANGED_MSG);
    }
    // Misma pestaña y escritura ganadora: la clave en memoria sigue siendo
    // válida para el sobre nuevo.
    activeDataKeyGen = envelopeGeneration({ ...env, pinEnvelope: newEnvelope });
    broadcastLockChange();
  });
}
