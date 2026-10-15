import { createVaultClient, type PasskeyPrfProvider, VaultError } from '@swal/vault/web';

export type LockState = 'off' | 'locked' | 'unlocked';

export interface DeviceLockStore {
  envelope?: string;
  method?: 'pin' | 'passkey';
  recoveryEnvelope?: string; // Recovery code wrapping of the raw key
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

async function getEnvelope(): Promise<DeviceLockStore | null> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    const db = await openLockDb();
    return await new Promise<DeviceLockStore | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_NAME);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveEnvelope(envelope: string, method: 'pin' | 'passkey', recoveryEnvelope: string): Promise<void> {
  const db = await openLockDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ envelope, method, recoveryEnvelope }, KEY_NAME);
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
  if (activeDataKey) return 'unlocked';
  const env = await getEnvelope();
  if (env) return 'locked';
  return 'off';
}

export function getActiveKey(): CryptoKey | null {
  return activeDataKey;
}

export function getMethod(): 'pin' | 'passkey' | null {
  return currentMethod;
}

// Generates a mock recovery code and wraps the data key with it.
// Uses pbkdf2 and AES-GCM to wrap the key.
async function generateRecoveryCode(rawKey: Uint8Array): Promise<{ recoveryCode: string, recoveryEnvelope: string }> {
  const recoveryCodeBuffer = crypto.getRandomValues(new Uint8Array(16));
  const recoveryCode = Array.from(recoveryCodeBuffer).map(b => b.toString(16).padStart(2, '0')).join('');

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(recoveryCode),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey"]
  );

  const keyToWrap = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey(
    "raw",
    keyToWrap,
    wrappingKey,
    { name: "AES-GCM", iv: iv }
  );

  const combined = new Uint8Array(salt.length + iv.length + wrapped.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(wrapped), salt.length + iv.length);

  let binary = '';
  for (let i = 0; i < combined.byteLength; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  const recoveryEnvelope = btoa(binary);

  return { recoveryCode, recoveryEnvelope };
}

async function unwrapWithRecoveryCode(recoveryCode: string, recoveryEnvelope: string): Promise<Uint8Array> {
  const binary = atob(recoveryEnvelope);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i);
  }

  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const wrapped = combined.slice(28);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(recoveryCode),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["unwrapKey"]
  );

  const unwrappedKey = await crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    wrappingKey,
    { name: "AES-GCM", iv: iv },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const rawKeyBuffer = await crypto.subtle.exportKey('raw', unwrappedKey);
  return new Uint8Array(rawKeyBuffer);
}

// Devuelve código de recuperación de alta entropía (16 bytes en hex) al habilitar
export async function enableProtection(method: 'pin' | 'passkey', secret?: string): Promise<string> {
  if (await getLockState() !== 'off') {
    throw new Error('La protección ya está habilitada');
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  activeDataKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  const { recoveryCode, recoveryEnvelope } = await generateRecoveryCode(rawKey);

  const vc = getVaultClient();
  if (method === 'pin') {
    if (!secret || secret.length < 6) throw new Error('PIN debe tener al menos 6 dígitos');
    await vc.unlock({ passphrase: secret });
  } else {
    await vc.unlock({ passkey: true });
  }

  const envelope = await vc.wrapKey(rawKey);
  await saveEnvelope(envelope, method, recoveryEnvelope);
  currentMethod = method;

  // Run the migrations to encrypt existing data
  const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
  await migrateLocalStoresEncryption(activeDataKey);

  const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
  await migrateIdentityStoreEncryption(activeDataKey);

  return recoveryCode;
}

export async function unlock(method: 'pin' | 'passkey' | 'recovery', secret?: string): Promise<void> {
  const env = await getEnvelope();
  if (!env) throw new Error('No hay protección habilitada');

  const vc = getVaultClient();
  let rawKey: Uint8Array;

  try {
    if (method === 'recovery') {
      if (!secret) throw new Error('Se requiere código de recuperación');
      if (!env.recoveryEnvelope) throw new Error('No hay código de recuperación guardado');
      rawKey = await unwrapWithRecoveryCode(secret, env.recoveryEnvelope);

      // We must reset the vault client's passphrase if recovery was used, but we
      // don't know the new pin here. For this task, unlocking via recovery implies
      // the user is now unlocked and can change PIN later.
    } else if (method === 'pin') {
      if (!secret) throw new Error('Se requiere PIN');
      await vc.unlock({ passphrase: secret });
      rawKey = await vc.unwrapKey(env.envelope!);
    } else if (method === 'passkey') {
      await vc.unlock({ passkey: true });
      rawKey = await vc.unwrapKey(env.envelope!);
    } else {
      throw new Error('Método desconocido');
    }
  } catch (err) {
    if (err instanceof VaultError) {
      throw err;
    }
    throw new VaultError('BAD_KEY', 'PIN o código incorrecto');
  }

  activeDataKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  currentMethod = env.method || method;
}

export function lock(): void {
  activeDataKey = null;
  currentMethod = null;
  if (vaultClientInstance) vaultClientInstance.lock();
}

export async function disableProtection(): Promise<void> {
  if (!activeDataKey) throw new Error('Debe desbloquear antes de deshabilitar');

  // Run migrations back to plain text first, using the currently active key
  // BEFORE we clear the envelope.
  const { migrateLocalStoresEncryption } = await import('./indexedDbAdapter');
  await migrateLocalStoresEncryption(null);

  const { migrateIdentityStoreEncryption } = await import('../../mesh/identityStore');
  await migrateIdentityStoreEncryption(null);

  await clearEnvelope();
  activeDataKey = null;
  currentMethod = null;
  if (vaultClientInstance) vaultClientInstance.lock();
}

export async function changePin(oldPin: string, newPin: string): Promise<void> {
  if (!activeDataKey) throw new Error('Debe desbloquear antes de cambiar PIN');
  if (newPin.length < 6) throw new Error('El nuevo PIN debe tener al menos 6 dígitos');

  const vc = getVaultClient();
  const env = await getEnvelope();
  if(!env || env.method !== 'pin') throw new Error('El método actual no es PIN');

  // Unwrap with old PIN just to verify
  await vc.unlock({ passphrase: oldPin });
  const rawKey = await vc.unwrapKey(env.envelope!);

  // Wrap with new PIN
  await vc.unlock({ passphrase: newPin });
  const newEnvelope = await vc.wrapKey(rawKey);
  await saveEnvelope(newEnvelope, 'pin', env.recoveryEnvelope!);
}
