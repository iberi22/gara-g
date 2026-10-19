/**
 * identityStore.ts — Persistencia del keypair del nodo (cadena serializada de edge-mesh).
 *
 * IndexedDB si existe y funciona; si no (modo privado, sin permisos, SSR), memoria: la
 * identidad dura lo que dure la pestana. Sin dependencias de edge-mesh.
 *
 * Los guardados pasan por la MISMA puerta compartida/exclusiva y la MISMA
 * verificación de sobre que el adaptador de registros: un guardado en vuelo
 * durante enable/disable se reintenta con una foto nueva en vez de dejar
 * ciphertext huérfano o plaintext con protección activa.
 */
import {
  getLockState,
  getActiveKey,
  takeTicket,
  verifyTicket,
  waitForSettledState,
  isLockRetryable,
  StaleTicketError,
  type WriteTicket,
} from '../lib/local/deviceLock';
import { beginDataOp, beginTransition } from '../lib/local/opGate';
import { LockedError } from '../lib/local/recordCrypto';

const DB_NAME = 'gara-mesh';
const STORE = 'kv';
const KEY = 'node-keypair';

let memoryCopy: string | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('indexedDB bloqueada'));
    } catch (err) {
      reject(err);
    }
  });
}

async function withMeshDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
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

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
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
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.encode(value));
  return `v1.${bufferToBase64(iv)}.${bufferToBase64(ciphertext as ArrayBuffer)}`;
}

async function decryptString(encrypted: string, key: CryptoKey): Promise<string> {
  const parts = encrypted.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return encrypted; // Si no está cifrado (fallback)
  const iv = base64ToBuffer(parts[1]);
  const ciphertext = base64ToBuffer(parts[2]);
  const aad = enc.encode('gara-mesh|kv|node-keypair');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext);
  return dec.decode(plaintext);
}

async function readRaw(): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return memoryCopy;
  return withMeshDb(
    (db) =>
      new Promise<string | null>((resolve, reject) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        r.onsuccess = () => resolve(typeof r.result === 'string' ? r.result : null);
        r.onerror = () => reject(r.error);
      })
  );
}

function putWithDb(db: IDBDatabase, value: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function writeRaw(value: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await withMeshDb((db) => putWithDb(db, value));
}

const MAX_TICKET_ATTEMPTS = 12;

export async function loadSerializedKeypair(): Promise<string | null> {
  const state = await getLockState();
  if (state === 'locked' || state === 'transition') {
    throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
  }
  if (state === 'error') {
    // Sobre ilegible: no bloquear la creación del nodo cuando la protección
    // nunca se habilitó. Un keypair cifrado (v1.) demuestra que SÍ se habilitó
    // y sin clave no se puede usar: se sigue bloqueando. Sin ciphertext, el
    // modo efectivo es off (memoria + plaintext best-effort, nunca lanzar).
    let raw: string | null = null;
    try {
      raw = await readRaw();
    } catch {
      return memoryCopy;
    }
    if (raw?.startsWith('v1.')) {
      throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
    }
    return memoryCopy ?? raw;
  }

  let last: unknown = new Error('No se pudo leer la identidad');
  for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
    let ticket: WriteTicket;
    try {
      ticket = await takeTicket();
    } catch (err) {
      if (err instanceof LockedError) throw err;
      return memoryCopy;
    }
    // Lectura fuera del candado (la puerta solo cubre verificar+descifrar).
    let raw: string | null;
    try {
      raw = await readRaw();
    } catch {
      return memoryCopy;
    }
    const release = await beginDataOp();
    try {
      await verifyTicket(ticket);
      if (raw?.startsWith('v1.')) {
        if (!ticket.key) {
          throw new StaleTicketError();
        }
        try {
          return await decryptString(raw, ticket.key);
        } catch {
          throw new StaleTicketError();
        }
      }
      return raw;
    } catch (err) {
      if (err instanceof LockedError) throw err;
      if (!isLockRetryable(err)) return memoryCopy;
      last = err;
    } finally {
      release();
    }
    await waitForSettledState();
  }
  void last;
  return memoryCopy;
}

export async function saveSerializedKeypair(value: string): Promise<void> {
  memoryCopy = value;
  const state = await getLockState();
  if (state === 'locked' || state === 'transition') {
    throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
  }
  if (state === 'error') {
    // Sin sobre legible no se puede decidir el modo de escritura: solo
    // plaintext best-effort (nunca ciphertext sin sobre que lo respalde).
    try {
      const raw = await readRaw();
      if (raw?.startsWith('v1.')) {
        throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
      }
      await writeRaw(value);
    } catch (err) {
      if (err instanceof LockedError) throw err;
      /* queda en memoria */
    }
    return;
  }

  let last: unknown = new Error('No se pudo guardar la identidad');
  for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
    let ticket: WriteTicket;
    try {
      ticket = await takeTicket();
    } catch (err) {
      if (err instanceof LockedError) throw err;
      return; /* queda en memoria */
    }
    const toSave = ticket.key ? await encryptString(value, ticket.key) : value;
    // Apertura fuera del candado: retener la puerta durante un open
    // bloqueado interbloquearía la migración que esperamos reintentar.
    let db: IDBDatabase | null = null;
    try {
      db = await openDb();
    } catch {
      return; /* queda en memoria */
    }
    const release = await beginDataOp();
    try {
      await verifyTicket(ticket);
      await putWithDb(db, toSave);
      return;
    } catch (err) {
      if (err instanceof LockedError) throw err;
      if (!isLockRetryable(err)) return; /* queda en memoria */
      last = err;
    } finally {
      release();
      try {
        db.close();
      } catch {
        /* best-effort */
      }
    }
    await waitForSettledState();
  }
  void last;
  /* queda en memoria */
}

export async function migrateIdentityStoreEncryption(key: CryptoKey | null): Promise<void> {
  // Exclusivo frente a guardados/cargas en curso (misma puerta que registros).
  const release = await beginTransition();
  try {
    let raw: string | null = null;
    try {
      raw = await readRaw();
    } catch {
      raw = memoryCopy;
    }

    let current = raw;
    if (raw?.startsWith('v1.')) {
      const activeKey = getActiveKey() || key;
      if (activeKey) {
        current = await decryptString(raw, activeKey);
      } else {
        throw new Error('Se requiere clave para descifrar durante migración');
      }
    }

    if (current) {
      if (typeof indexedDB === 'undefined') return;
      let toSave = current;
      if (key) {
        toSave = await encryptString(current, key);
      }
      await writeRaw(toSave);
    }
  } finally {
    release();
  }
}

/** @internal para pruebas */
export function resetIdentityMemory() {
  memoryCopy = null;
}
