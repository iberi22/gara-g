/**
 * identityStore.ts — Persistencia del keypair del nodo (cadena serializada de edge-mesh).
 *
 * IndexedDB si existe y funciona; si no (modo privado, sin permisos, SSR), memoria: la
 * identidad dura lo que dure la pestana. Sin dependencias de edge-mesh.
 */
import { getLockState, getActiveKey } from '../lib/local/deviceLock';
import { LockedError } from '../lib/local/recordCrypto';

const DB_NAME = 'gara-mesh';
const STORE = 'kv';
const KEY = 'node-keypair';

let memoryCopy: string | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB bloqueada'));
  });
}

function bufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function encryptString(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = enc.encode('gara-mesh|kv|node-keypair');
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    enc.encode(value)
  );
  return `v1.${bufferToBase64(iv)}.${bufferToBase64(ciphertext as ArrayBuffer)}`;
}

async function decryptString(encrypted: string, key: CryptoKey): Promise<string> {
  const parts = encrypted.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return encrypted; // Si no está cifrado (fallback)
  const iv = base64ToBuffer(parts[1]);
  const ciphertext = base64ToBuffer(parts[2]);
  const aad = enc.encode('gara-mesh|kv|node-keypair');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    ciphertext
  );
  return dec.decode(plaintext);
}

export async function loadSerializedKeypair(): Promise<string | null> {
  let raw: string | null = null;
  const state = await getLockState();
  if (state === 'locked' || state === 'transition' || state === 'error') {
    throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
  }

  try {
    if (typeof indexedDB === 'undefined') return memoryCopy;
    const db = await openDb();
    try {
      raw = await new Promise<string | null>((resolve, reject) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        r.onsuccess = () => resolve(typeof r.result === 'string' ? r.result : null);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return memoryCopy;
  }

  if (raw && raw.startsWith('v1.')) {
    const key = getActiveKey();
    if (key) {
      return await decryptString(raw, key);
    }
  }
  return raw;
}

export async function saveSerializedKeypair(value: string): Promise<void> {
  const state = await getLockState();
  if (state === 'locked' || state === 'transition' || state === 'error') {
    throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
  }

  memoryCopy = value;
  try {
    if (typeof indexedDB === 'undefined') return;

    let toSave = value;
    const key = getActiveKey();
    if (key) {
      toSave = await encryptString(value, key);
    }

    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(toSave, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* queda en memoria */
  }
}

export async function migrateIdentityStoreEncryption(key: CryptoKey | null): Promise<void> {
  let raw: string | null = null;
  try {
    if (typeof indexedDB === 'undefined') {
        raw = memoryCopy;
    } else {
        const db = await openDb();
        try {
            raw = await new Promise<string | null>((resolve, reject) => {
            const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
            r.onsuccess = () => resolve(typeof r.result === 'string' ? r.result : null);
            r.onerror = () => reject(r.error);
            });
        } finally {
            db.close();
        }
    }
  } catch {
    raw = memoryCopy;
  }

  let current = raw;
  if (raw && raw.startsWith('v1.')) {
    const activeKey = getActiveKey() || key;
    if (activeKey) {
      current = await decryptString(raw, activeKey);
    } else {
        throw new Error('Se requiere clave para descifrar durante migración');
    }
  }

  if (current) {
    if (typeof indexedDB === 'undefined') return;
    const db = await openDb();
    let toSave = current;
    if (key) {
      toSave = await encryptString(current, key);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(toSave, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
}

/** @internal para pruebas */
export function resetIdentityMemory() {
  memoryCopy = null;
}
