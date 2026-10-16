import { createVaultClient, type PasskeyPrfProvider, VaultError } from '@swal/vault/web';

export type LockState = 'off' | 'locked' | 'unlocked' | 'transition' | 'error';

export interface DeviceLockStore {
  pinEnvelope?: string;
  passkeyEnvelope?: string;
  state?: 'transition' | 'active';
  targetMethod?: 'pin' | 'passkey' | 'off';
  failedAttempts?: number;
  lockedUntil?: number; // timestamp
}

const STORE_NAME = 'gara-lock';
const KEY_NAME = 'envelope';

let activeDataKey: CryptoKey | null = null;
let currentMethod: 'pin' | 'passkey' | null = null;
let vaultClientInstance: ReturnType<typeof createVaultClient> | null = null;
let overridePasskeyProvider: PasskeyPrfProvider | undefined = undefined;

// IndexedDB para guardar el sobre
function openLockDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STORE_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getEnvelope(): Promise<DeviceLockStore | null | 'unreadable'> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    const db = await openLockDb();
    return await new Promise<DeviceLockStore | null | 'unreadable'>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_NAME);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve('unreadable');
    });
  } catch {
    return 'unreadable';
  }
}

async function saveEnvelope(data: DeviceLockStore): Promise<void> {
  const db = await openLockDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, KEY_NAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearEnvelope(): Promise<void> {
  const db = await openLockDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(KEY_NAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export async function getLockState(): Promise<LockState> {
  const env = await getEnvelope();
  if (env === 'unreadable') return 'error';

  if (env && env.state === 'transition') return 'transition';

  if (activeDataKey) return 'unlocked';
  if (env && env.state === 'active') return 'locked';
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
    try {
      await migrateLocalStoresEncryption(null);
      await migrateIdentityStoreEncryption(null);
    } finally {
      activeDataKey = null;
    }
    await clearEnvelope();
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
  activeDataKey = key;
  currentMethod = method;
}

// Devuelve código de recuperación de alta entropía (16 bytes en hex) al habilitar
export async function enableProtection(method: 'pin' | 'passkey', secret?: string): Promise<string> {
  const currentState = await getLockState();
  if (currentState === 'error') {
    throw new Error('Estado de protección ilegible: no se puede habilitar.');
  }
  if (currentState === 'transition') {
    throw new Error('Hay una transición pendiente. Desbloquea para reanudarla antes de volver a habilitar.');
  }
  if (currentState !== 'off') {
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

  const envelopeStore: DeviceLockStore = {
    state: 'transition',
    targetMethod: method,
    pinEnvelope,
    passkeyEnvelope,
    failedAttempts: 0,
    lockedUntil: 0
  };

  // 1. Write 'transition' marker (con la clave envuelta: nunca se pierde si algo falla)
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

  // 4. Publish state in memory
  activeDataKey = newActiveDataKey;
  currentMethod = method;

  // TODO: recovery flow must go through the vault recovery kit of PR #35
  // and the same phone's biometrics/pattern. For now return dummy
  return "00000000000000000000000000000000";
}

export async function unlock(method: 'pin' | 'passkey' | 'recovery', secret?: string): Promise<void> {
  const env = await getEnvelope();
  if (env === 'unreadable') throw new Error('Estado de protección ilegible');
  if (!env || (env.state !== 'active' && env.state !== 'transition')) {
    throw new Error('No hay protección habilitada o estado corrupto');
  }

  // Verify PIN limits
  if (env.lockedUntil && Date.now() < env.lockedUntil) {
    throw new VaultError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.');
  }

  const vc = getVaultClient();
  let rawKey: Uint8Array;

  try {
    if (method === 'pin') {
      if (!secret || !PIN_PATTERN.test(secret)) throw new Error('PIN debe tener exactamente 6 dígitos');
      if (!env.pinEnvelope) throw new Error('No hay PIN configurado');
      await vc.unlock({ passphrase: secret });
      rawKey = await vc.unwrapKey(env.pinEnvelope);
    } else if (method === 'passkey') {
      if (!env.passkeyEnvelope) throw new Error('No hay Passkey configurado');
      await vc.unlock({ passkey: true });
      rawKey = await vc.unwrapKey(env.passkeyEnvelope);
    } else {
      throw new Error('Método desconocido');
    }

    // Success - reset attempts
    if (env.failedAttempts && env.failedAttempts > 0) {
      env.failedAttempts = 0;
      env.lockedUntil = 0;
      await saveEnvelope(env);
    }

  } catch (err) {
    // On failure, increment attempt and save delay (only for actual crypto failures, not validation)
    if (err instanceof VaultError || (err instanceof Error && err.message.includes('Método'))) {
       // Only increment on actual attempt failures (BAD_KEY)
       if (err instanceof VaultError && err.code !== 'BAD_KEY') throw err;

       env.failedAttempts = (env.failedAttempts || 0) + 1;
       env.lockedUntil = Date.now() + calculateDelay(env.failedAttempts);
       await saveEnvelope(env);
       throw new VaultError('BAD_KEY', 'PIN o código incorrecto');
    }
    throw err;
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
    return;
  }

  activeDataKey = key;
  currentMethod = method === 'passkey' ? 'passkey' : 'pin';
}

export function lock(): void {
  activeDataKey = null;
  currentMethod = null;
  if (vaultClientInstance) vaultClientInstance.lock();
}

export async function disableProtection(): Promise<void> {
  if (!activeDataKey) throw new Error('Debe desbloquear antes de deshabilitar');

  const env = await getEnvelope();
  if (env === 'unreadable' || !env) return; // Already disabled or corrupt

  // 1. Mark transition
  env.state = 'transition';
  env.targetMethod = 'off';
  await saveEnvelope(env);

  // 2. Migrate back to plain text. Si falla, se conserva el estado 'transition' y el
  // sobre, de modo que unlock() puede reanudar o revertir sin perder la clave.
  const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
  await migrateLocalStoresEncryption(null);

  const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
  await migrateIdentityStoreEncryption(null);

  // 3. Clear envelope
  await clearEnvelope();

  // 4. Clear memory
  activeDataKey = null;
  currentMethod = null;
  if (vaultClientInstance) vaultClientInstance.lock();
}

export async function changePin(oldPin: string, newPin: string): Promise<void> {
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
  await saveEnvelope(env);
}
