import { createVaultClient, type PasskeyPrfProvider, VaultError } from '@swal/vault/web';
import { LockedError, TransitionInProgressError } from './recordCrypto';

export type LockState = 'off' | 'locked' | 'unlocked' | 'transition' | 'error';

export interface DeviceLockStore {
  pinEnvelope?: string;
  passkeyEnvelope?: string;
  state?: 'transition' | 'active';
  targetMethod?: 'pin' | 'passkey' | 'off';
  failedAttempts?: number;
  lockedUntil?: number; // timestamp
  startedAt?: number; // timestamp de creación del marcador de transición (lease N1)
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
      await clearEnvelope();
      broadcastLockChange();
    } catch {
      /* best-effort */
    }
    return null;
  }
  return env;
}

async function saveEnvelope(data: DeviceLockStore): Promise<void> {
  await withLockDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, KEY_NAME);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
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

async function clearEnvelope(): Promise<void> {
  await withLockDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(KEY_NAME);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
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
    await clearEnvelope();
    broadcastLockChange();
    currentMethod = null;
    if (vaultClientInstance) vaultClientInstance.lock();
    return;
  }

  // Activación interrumpida: terminar de cifrar y marcar el sobre como activo.
  const method: 'pin' | 'passkey' = env.targetMethod === 'passkey' ? 'passkey' : 'pin';
  await migrateLocalStoresEncryption(key);
  await migrateIdentityStoreEncryption(key);
  env.state = 'active';
  env.targetMethod = undefined;
  await saveEnvelope(env);
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
    };
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
      envelopeStore.pinEnvelope = pinEnvelope;
      envelopeStore.passkeyEnvelope = passkeyEnvelope;
      await saveEnvelope(envelopeStore);

      // 2. Migrar (coordinada con las escrituras en curso dentro del adaptador).
      // Si algo falla, el sobre NO se borra: es la única forma de recuperar la clave. La
      // transición queda pendiente y unlock() la reanuda o revierte con la credencial original.
      const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
      await migrateLocalStoresEncryption(newActiveDataKey);

      const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
      await migrateIdentityStoreEncryption(newActiveDataKey);

      // 3. Mark as active
      envelopeStore.state = 'active';
      envelopeStore.targetMethod = undefined;
      await saveEnvelope(envelopeStore);
      broadcastLockChange();

      // 4. Publish state in memory
      activeDataKey = newActiveDataKey;
      activeDataKeyGen = envelopeGeneration(envelopeStore);
      currentMethod = method;

      // TODO: recovery flow must go through the vault recovery kit of PR #35
      // and the same phone's biometrics/pattern. For now return dummy
      return '00000000000000000000000000000000';
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
      // KDF interrumpida), el marcador quedó huérfano: borrarlo si sigue
      // siendo nuestro y sin sobres. La migración solo empieza después de
      // persistirlos, así que borrarlo no pierde nada recuperable.
      try {
        const cur = await getEnvelopeRaw();
        if (
          cur &&
          cur !== 'unreadable' &&
          cur.state === 'transition' &&
          !cur.pinEnvelope &&
          !cur.passkeyEnvelope
        ) {
          await clearEnvelope();
          broadcastLockChange();
        }
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
  if (method !== 'pin' && method !== 'passkey') {
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
    // N4: revalidar el lockout DENTRO del mutex con el sobre recién leído:
    // los intentos encolados en paralelo veían todos el mismo contador y el
    // correcto se colaba reseteando los fallos. Un fallo en lockout sigue
    // contando (extiende el bloqueo, como exige T5); un éxito en lockout se
    // rechaza sin resetear ni desbloquear.
    const wasLocked = !!env.lockedUntil && Date.now() < env.lockedUntil;

    const vc = getVaultClient();
    let rawKey: Uint8Array;

    try {
      if (method === 'pin') {
        if (!env.pinEnvelope) throw new Error('No hay PIN configurado');
        await vc.unlock({ passphrase: secret as string });
        rawKey = await vc.unwrapKey(env.pinEnvelope);
      } else {
        if (!env.passkeyEnvelope) throw new Error('No hay Passkey configurado');
        await vc.unlock({ passkey: true });
        rawKey = await vc.unwrapKey(env.passkeyEnvelope);
      }
    } catch (err) {
      // Solo un fallo criptográfico real (BAD_KEY) cuenta como intento.
      if (err instanceof VaultError && err.code === 'BAD_KEY') {
        env.failedAttempts = (env.failedAttempts || 0) + 1;
        env.lockedUntil = Date.now() + calculateDelay(env.failedAttempts);
        await saveEnvelope(env);
        broadcastLockChange();
        throw new VaultError('BAD_KEY', 'PIN o código incorrecto');
      }
      throw err;
    }

    // Success - reset attempts (salvo que el lockout nos haya alcanzado en la cola).
    if (wasLocked) {
      throw new VaultError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.');
    }
    if (env.failedAttempts && env.failedAttempts > 0) {
      env.failedAttempts = 0;
      env.lockedUntil = 0;
      await saveEnvelope(env);
    }

    const key = await crypto.subtle.importKey(
      'raw',
      rawKey as unknown as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    // Si la app se cerró a mitad de una transición, reanudarla con la clave recuperada.
    if (env.state === 'transition') {
      await resumeTransition(env, key);
      broadcastLockChange();
      return;
    }

    activeDataKey = key;
    activeDataKeyGen = envelopeGeneration(env);
    currentMethod = method === 'passkey' ? 'passkey' : 'pin';
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

    // 1. Mark transition
    env.state = 'transition';
    env.targetMethod = 'off';
    await saveEnvelope(env);
    broadcastLockChange();

    // 2. Migrate back to plain text. Si falla, se conserva el estado 'transition' y el
    // sobre, de modo que unlock() puede reanudar o revertir sin perder la clave.
    const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
    await migrateLocalStoresEncryption(null);

    const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
    await migrateIdentityStoreEncryption(null);

    // 3. Clear envelope
    await clearEnvelope();
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

    env.pinEnvelope = newEnvelope;
    // Misma pestaña: la clave en memoria sigue siendo válida para el sobre nuevo.
    activeDataKeyGen = envelopeGeneration(env);
    await saveEnvelope(env);
    broadcastLockChange();
  });
}
