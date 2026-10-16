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

// Devuelve código de recuperación de alta entropía (16 bytes en hex) al habilitar
export async function enableProtection(method: 'pin' | 'passkey', secret?: string): Promise<string> {
  const currentState = await getLockState();
  if (currentState !== 'off' && currentState !== 'transition') {
    throw new Error('La protección ya está habilitada');
  }

  // Si ya estábamos en transition de antes, podríamos limpiar o continuar.
  // Pero lo seguro es regenerar todo si intentan habilitar de nuevo (sobreescribir).
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

  // We should try to create passkey, and if secret is provided, create PIN envelope as fallback
  if (method === 'passkey') {
    await vc.unlock({ passkey: true });
    passkeyEnvelope = await vc.wrapKey(rawKey);
    // User can provide a PIN as fallback when enabling passkey
    if (secret && secret.length === 6) {
      await vc.lock();
      await vc.unlock({ passphrase: secret });
      pinEnvelope = await vc.wrapKey(rawKey);
    }
  } else if (method === 'pin') {
    if (!secret || secret.length !== 6) throw new Error('PIN debe tener exactamente 6 dígitos');
    await vc.unlock({ passphrase: secret });
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

  // 1. Write 'transition' marker
  await saveEnvelope(envelopeStore);

  try {
    // 2. Migrate
    const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
    await migrateLocalStoresEncryption(newActiveDataKey);

    const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
    await migrateIdentityStoreEncryption(newActiveDataKey);

    // 3. Mark as active
    envelopeStore.state = 'active';
    await saveEnvelope(envelopeStore);

    // 4. Publish state in memory
    activeDataKey = newActiveDataKey;
    currentMethod = method;

    // TODO: recovery flow must go through the vault recovery kit of PR #35
    // and the same phone's biometrics/pattern. For now return dummy
    return "00000000000000000000000000000000";
  } catch (e) {
    // Revert attempt on failure during migration
    await clearEnvelope();
    throw e;
  }
}

export async function unlock(method: 'pin' | 'passkey' | 'recovery', secret?: string): Promise<void> {
  const env = await getEnvelope();
  if (env === 'unreadable' || !env || env.state !== 'active') throw new Error('No hay protección habilitada o estado corrupto');

  // Verify PIN limits
  if (env.lockedUntil && Date.now() < env.lockedUntil) {
    throw new VaultError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.');
  }

  const vc = getVaultClient();
  let rawKey: Uint8Array;

  try {
    if (method === 'pin') {
      if (!secret || secret.length !== 6) throw new Error('PIN debe tener exactamente 6 dígitos');
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

  activeDataKey = await crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  currentMethod = method === 'passkey' && !env.passkeyEnvelope ? 'pin' : method as 'pin' | 'passkey';
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

  try {
    // 2. Migrate back to plain text
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
  } catch (e) {
    // If it fails, we keep the transition state so we know it's broken and needs fixing
    throw e;
  }
}

export async function changePin(oldPin: string, newPin: string): Promise<void> {
  if (!activeDataKey) throw new Error('Debe desbloquear antes de cambiar PIN');
  if (newPin.length !== 6) throw new Error('El nuevo PIN debe tener exactamente 6 dígitos');

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
