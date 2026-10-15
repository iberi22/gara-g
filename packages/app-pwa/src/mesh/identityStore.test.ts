// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { loadSerializedKeypair, saveSerializedKeypair, migrateIdentityStoreEncryption, resetIdentityMemory } from './identityStore';
import { enableProtection, disableProtection, lock, unlock } from '../lib/local/deviceLock';

// Polyfill webcrypto for Vitest environment if missing
if (typeof crypto === 'undefined' || !crypto.subtle) {
  const nodeCrypto = await import('node:crypto');
  // @ts-ignore
  globalThis.crypto = nodeCrypto.webcrypto;
}

beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetIdentityMemory();
});

afterEach(async () => {
  lock();
});

describe('identityStore', () => {
  it('guarda y carga la identidad en texto claro sin protección', async () => {
    await saveSerializedKeypair('test-keypair-data');
    const loaded = await loadSerializedKeypair();
    expect(loaded).toBe('test-keypair-data');
  });

  it('guarda y carga la identidad cifrada cuando está protegido', async () => {
    await enableProtection('pin', '123456');
    await saveSerializedKeypair('test-secret-keypair');

    // Verificamos que se haya cargado bien
    const loaded = await loadSerializedKeypair();
    expect(loaded).toBe('test-secret-keypair');

    // Y comprobamos que crudo en IDB no sea texto plano
    const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('gara-mesh', 1);
        r.onsuccess = () => resolve(r.result);
    });
    const raw = await new Promise<string>((resolve) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get('node-keypair');
        req.onsuccess = () => resolve(req.result);
    });
    expect(raw).not.toContain('test-secret-keypair');
    expect(raw.startsWith('v1.')).toBe(true);
    db.close();
  });

  it('falla la carga cuando está bloqueado', async () => {
    await enableProtection('pin', '123456');
    await saveSerializedKeypair('test-secret-keypair');

    lock();
    await expect(loadSerializedKeypair()).rejects.toThrow('Base de datos bloqueada');
  });

  it('no guarda cuando está bloqueado (porque no tiene la clave)', async () => {
    await enableProtection('pin', '123456');
    lock();

    await saveSerializedKeypair('new-data');

    // Intentamos cargar (desbloqueando primero)
    await unlock('pin', '123456');
    const loaded = await loadSerializedKeypair();
    expect(loaded).toBeNull(); // No debio guardar nada porque falló
  });
});
