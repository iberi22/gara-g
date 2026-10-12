/**
 * identityStore.ts — Persistencia del keypair del nodo (cadena serializada de edge-mesh).
 *
 * IndexedDB si existe y funciona; si no (modo privado, sin permisos, SSR), memoria: la
 * identidad dura lo que dure la pestana. Sin dependencias de edge-mesh.
 */
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

export async function loadSerializedKeypair(): Promise<string | null> {
  try {
    if (typeof indexedDB === 'undefined') return memoryCopy;
    const db = await openDb();
    try {
      return await new Promise<string | null>((resolve, reject) => {
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
}

export async function saveSerializedKeypair(value: string): Promise<void> {
  memoryCopy = value;
  try {
    if (typeof indexedDB === 'undefined') return;
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, KEY);
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

/** @internal para pruebas */
export function resetIdentityMemory() {
  memoryCopy = null;
}
