import { webcrypto } from 'node:crypto';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { VaultError, createVaultClient } from '@swal/vault/web';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_INSTANCE_ID } from '../appMode';
import { parseBackupCode } from '../e2ee/crypto';
import { type RecoveryKitEntry, openRecoveryKit } from '../vaultRecoveryKit';
import {
  changePin,
  disableProtection,
  enableProtection,
  getActiveKey,
  getLockState,
  getMethod,
  lock,
  setPasskeyProvider,
  unlock,
} from './deviceLock';
import {
  closeLocalDb,
  getLocalAdapter,
  migrateLocalStoresEncryption,
  openLocalDb,
} from './indexedDbAdapter';
import { LockedError, decryptRecord } from './recordCrypto';

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  (globalThis as any).crypto = webcrypto;
}

beforeEach(async () => {
  await closeLocalDb();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  lock();
});

afterEach(() => {
  vi.restoreAllMocks();
  lock();
});

/** Lee el sobre persistido del candado (`gara-lock`/`envelope`). */
async function readLockEnvelope(): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gara-lock', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('gara-lock');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('gara-lock', 'readonly');
      const get = tx.objectStore('gara-lock').get('envelope');
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

/** Modifica el sobre persistido (para modelar estados heredados/parciales). */
async function patchLockEnvelope(patch: (env: any) => void): Promise<void> {
  const env = await readLockEnvelope();
  patch(env);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('gara-lock', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('gara-lock');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('gara-lock', 'readwrite');
      tx.objectStore('gara-lock').put(env, 'envelope');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

// Clave de datos fijada: su base64 estándar usa '+' y '/', los únicos caracteres
// que distinguen el alfabeto estándar del base64url. Fijarla hace determinista la
// comprobación de formato (con una clave aleatoria, 1 de cada 4 no contiene
// ninguno de los dos y un mutante base64url pasaría inadvertido).
const PINNED_DATA_KEY = new Uint8Array(32);
for (let i = 0; i < PINNED_DATA_KEY.length; i++) {
  PINNED_DATA_KEY[i] = [0xfb, 0xff, 0xbf][i % 3];
}

/**
 * Habilita la protección con la clave de datos fijada y devuelve además los
 * bytes crudos de esa clave, para poder comprobar qué se selló exactamente en
 * el kit de recuperación.
 */
async function enableWithPinnedKey(
  method: 'pin' | 'passkey',
  secret: string,
): Promise<{ code: string; rawKey: Uint8Array }> {
  const realGetRandomValues = crypto.getRandomValues.bind(crypto);
  const proto = Object.getPrototypeOf(crypto.subtle) as SubtleCrypto;
  const realImportKey = proto.importKey;
  let rawKey: Uint8Array | null = null;
  const randomSpy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    if (array instanceof Uint8Array && array.length === 32) {
      array.set(PINNED_DATA_KEY);
      return array;
    }
    return realGetRandomValues(array);
  }) as typeof crypto.getRandomValues);
  const importSpy = vi.spyOn(proto, 'importKey').mockImplementation(function (
    this: SubtleCrypto,
    ...args: Parameters<SubtleCrypto['importKey']>
  ) {
    const [format, keyData, algorithm] = args;
    if (
      !rawKey &&
      format === 'raw' &&
      keyData instanceof Uint8Array &&
      keyData.length === 32 &&
      (algorithm as KeyAlgorithm).name === 'AES-GCM'
    ) {
      rawKey = new Uint8Array(keyData);
    }
    return realImportKey.apply(this, args);
  });
  try {
    const code = await enableProtection(method, secret);
    return { code, rawKey: rawKey as unknown as Uint8Array };
  } finally {
    randomSpy.mockRestore();
    importSpy.mockRestore();
  }
}

describe('deviceLock', () => {
  it('1. enables and disables protection cycle on raw IDB values', async () => {
    // 1. Setup plain IDB value
    const db = await openLocalDb();
    await db.put('records', {
      entity: 'v',
      id: '1',
      record: { id: '1', instance_id: 'local', updated_at: 'now', created_at: 'now' } as any,
    });

    // 2. Enable
    await enableProtection('pin', '123456');
    expect(await getLockState()).toBe('unlocked');

    // 3. Verify encrypted in IDB
    const rawEnc = await db.get('records', ['v', '1']);
    expect(rawEnc?.record).toBeUndefined();
    expect(rawEnc?.enc).toBeDefined();

    // 4. Disable
    await disableProtection();
    expect(await getLockState()).toBe('off');

    // 5. Verify plain in IDB
    const rawPlain = await db.get('records', ['v', '1']);
    expect(rawPlain?.record).toBeDefined();
    expect(rawPlain?.enc).toBeUndefined();
  });

  it('2. wrong PIN delays progressively (1s, 2s, 4s)', async () => {
    await enableProtection('pin', '123456');
    lock();

    await expect(unlock('pin', '000000')).rejects.toThrow(VaultError);
    // Mock Date.now to simulate delays without fake timers which breaks IndexedDB
    const RealDateNow = Date.now;

    try {
      let currentTime = RealDateNow();
      globalThis.Date.now = () => currentTime;

      await expect(unlock('pin', '000000')).rejects.toThrow(
        'Demasiados intentos. Inténtalo más tarde.',
      );

      currentTime += 1001; // wait 1s

      await expect(unlock('pin', '000000')).rejects.toThrow(VaultError); // 2nd attempt, delay is 2s

      await expect(unlock('pin', '000000')).rejects.toThrow(
        'Demasiados intentos. Inténtalo más tarde.',
      );

      currentTime += 2001; // wait 2s

      await expect(unlock('pin', '000000')).rejects.toThrow(VaultError); // 3rd attempt, delay is 4s

      currentTime += 4001;

      // Correct PIN resets
      await unlock('pin', '123456');
    } finally {
      globalThis.Date.now = RealDateNow;
    }
    expect(await getLockState()).toBe('unlocked');
  });

  it('3. locked operations throw correctly', async () => {
    await enableProtection('pin', '123456');
    lock();
    expect(await getLockState()).toBe('locked');
    // Actual locked operations are tested in local.test.ts, but we check state here
  });

  it('4. PIN change requires current PIN and updates correctly', async () => {
    await enableProtection('pin', '123456');

    // Changing pin using a mock to avoid triggering the wait timeouts directly here
    const RealDateNow = Date.now;

    try {
      let currentTime = RealDateNow();
      globalThis.Date.now = () => currentTime;

      await expect(changePin('000000', '654321')).rejects.toThrow(); // Wrong current PIN

      // Wait out the lockout period triggered by the wrong PIN attempt above
      currentTime += 2000;

      await changePin('123456', '654321');
      lock();

      await expect(unlock('pin', '123456')).rejects.toThrow(); // Old PIN fails

      currentTime += 2000; // wait out lockout

      await unlock('pin', '654321'); // New PIN works
      expect(await getLockState()).toBe('unlocked');
    } finally {
      globalThis.Date.now = RealDateNow;
    }
  });

  it('5. rollback keeps the recoverable envelope and resumes enable with the original PIN', async () => {
    const adapter = await import('./indexedDbAdapter');
    const db = await openLocalDb();
    await db.put('records', {
      entity: 'v',
      id: '1',
      record: { id: '1', instance_id: 'local', updated_at: 'now', created_at: 'now' } as any,
    });

    vi.spyOn(adapter, 'migrateLocalStoresEncryption').mockRejectedValueOnce(
      new Error('Migration Failure Mock'),
    );

    await expect(enableProtection('pin', '123456')).rejects.toThrow('Migration Failure Mock');
    // El sobre NO se borra: mantiene la clave envuelta para poder reanudar.
    expect(await getLockState()).toBe('transition');

    // El PIN correcto reanuda y completa la activación.
    await unlock('pin', '123456');
    expect(await getLockState()).toBe('unlocked');
    const row = await db.get('records', ['v', '1']);
    expect(row?.enc).toBeDefined();
    expect(row?.record).toBeUndefined();
  });

  it('5b. rollback after local migration succeeded keeps the key recoverable', async () => {
    const identity = await import('../../mesh/identityStore');
    const db = await openLocalDb();
    await db.put('records', {
      entity: 'v',
      id: '1',
      record: { id: '1', instance_id: 'local', updated_at: 'now', created_at: 'now' } as any,
    });

    // La migración local cifra, la de identidad falla: antes se borraba el sobre y
    // la clave se perdía. Ahora el sobre se conserva y el PIN permite reanudar.
    vi.spyOn(identity, 'migrateIdentityStoreEncryption').mockRejectedValueOnce(
      new Error('Identity Migration Failure'),
    );
    await expect(enableProtection('pin', '123456')).rejects.toThrow('Identity Migration Failure');

    expect(await getLockState()).toBe('transition');
    const encrypted = await db.get('records', ['v', '1']);
    expect(encrypted?.enc).toBeDefined();

    await unlock('pin', '123456');
    expect(await getLockState()).toBe('unlocked');
    const activeKey = getActiveKey();
    expect(activeKey).not.toBeNull();
    const plain = await decryptRecord('v', '1', encrypted?.enc as string, activeKey as CryptoKey);
    expect(plain.id).toBe('1');
  });

  it('5c. a failed disable is resumable after the app is closed (memory key lost)', async () => {
    const adapter = await import('./indexedDbAdapter');
    const db = await openLocalDb();
    await db.put('records', {
      entity: 'v',
      id: '1',
      record: { id: '1', instance_id: 'local', updated_at: 'now', created_at: 'now' } as any,
    });
    await enableProtection('pin', '123456');
    expect((await db.get('records', ['v', '1']))?.enc).toBeDefined();

    vi.spyOn(adapter, 'migrateLocalStoresEncryption').mockRejectedValueOnce(
      new Error('Disable Failure Mock'),
    );
    await expect(disableProtection()).rejects.toThrow('Disable Failure Mock');
    expect(await getLockState()).toBe('transition');

    // "Cerrar la app": se pierde la clave en memoria pero NO el sobre.
    lock();
    expect(getActiveKey()).toBeNull();

    // El PIN correcto reanuda la desactivación con la clave del sobre.
    await unlock('pin', '123456');
    expect(await getLockState()).toBe('off');
    const row = await db.get('records', ['v', '1']);
    expect(row?.record).toBeDefined();
    expect(row?.enc).toBeUndefined();
  });

  it('5d. enableProtection refuses to overwrite a pending transition', async () => {
    vi.spyOn(
      await import('./indexedDbAdapter'),
      'migrateLocalStoresEncryption',
    ).mockRejectedValueOnce(new Error('Migration Failure Mock'));
    await expect(enableProtection('pin', '123456')).rejects.toThrow('Migration Failure Mock');
    expect(await getLockState()).toBe('transition');
    // Reintentar con otra clave perdería la anterior: debe rechazarse.
    await expect(enableProtection('pin', '654321')).rejects.toThrow('transición pendiente');
    expect(await getLockState()).toBe('transition');
  });

  it('6. passkey + PIN envelopes both unlock', async () => {
    // We mock the internals via the provider to avoid ESM spyOn issues.
    // Testing state machine updates
    let mockPasskeyUnwrapped = false;
    const dummyKey = crypto.getRandomValues(new Uint8Array(32));

    setPasskeyProvider({
      isSupported: async () => true,
      create: async () => ({
        id: '1',
        rawId: '1',
        type: 'public-key',
        response: {} as unknown as AuthenticatorAttestationResponse,
        getClientExtensionResults: () => ({ prf: { enabled: true, results: {} } }),
      }),
      get: async () => {
        return {
          id: '1',
          rawId: '1',
          type: 'public-key',
          response: {} as unknown as AuthenticatorAssertionResponse,
          getClientExtensionResults: () => ({ prf: { results: { first: dummyKey } } }),
        };
      },
      extractPrfOutputs: () => ({ first: dummyKey }),
      getPrfOutput: () => {
        mockPasskeyUnwrapped = true;
        return dummyKey as unknown as Uint8Array<ArrayBufferLike>;
      },
    } as any);

    await enableProtection('passkey', '123456');
    expect(await getLockState()).toBe('unlocked');
    lock();

    // Unlock with passkey
    await unlock('passkey');
    expect(await getLockState()).toBe('unlocked');
    expect(mockPasskeyUnwrapped).toBe(true);
    lock();

    // Unlock with fallback PIN
    await unlock('pin', '123456');
    expect(await getLockState()).toBe('unlocked');

    setPasskeyProvider(undefined);
  });

  it('7. enable with missing or short PIN throws', async () => {
    await expect(enableProtection('pin', '12345')).rejects.toThrow(
      'PIN debe tener exactamente 6 dígitos',
    );
  });

  it('8. unlock with missing or short PIN throws', async () => {
    await enableProtection('pin', '123456');
    lock();
    await expect(unlock('pin', '123')).rejects.toThrow('PIN debe tener exactamente 6 dígitos');
  });

  it('9. change to short PIN throws', async () => {
    await enableProtection('pin', '123456');
    await expect(changePin('123456', '123')).rejects.toThrow(
      'El nuevo PIN debe tener exactamente 6 dígitos',
    );
  });

  it('10. disable without unlocking throws', async () => {
    await enableProtection('pin', '123456');
    lock();
    await expect(disableProtection()).rejects.toThrow('Debe desbloquear antes de deshabilitar');
  });

  it('11. unreadable lock store yields error and blocks data operations (identity falls back when never protected)', async () => {
    const realOpen = indexedDB.open.bind(indexedDB);
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(((
      name: string,
      ...args: unknown[]
    ) => {
      if (name === 'gara-lock') throw new Error('gara-lock unavailable');
      return (realOpen as unknown as (n: string, ...a: unknown[]) => IDBOpenDBRequest)(
        name,
        ...args,
      );
    }) as typeof indexedDB.open);

    expect(await getLockState()).toBe('error');

    const adapter = getLocalAdapter();
    const record = {
      id: 'e1',
      instance_id: LOCAL_INSTANCE_ID,
      created_at: 'now',
      updated_at: 'now',
    };
    await expect(adapter.create('vehicle', record)).rejects.toThrow(LockedError);
    await expect(adapter.list('vehicle', LOCAL_INSTANCE_ID)).rejects.toThrow(LockedError);
    await expect(adapter.get('vehicle', 'e1', LOCAL_INSTANCE_ID)).rejects.toThrow(LockedError);
    await expect(adapter.update('vehicle', 'e1', {}, LOCAL_INSTANCE_ID)).rejects.toThrow(
      LockedError,
    );
    await expect(adapter.del('vehicle', 'e1', LOCAL_INSTANCE_ID)).rejects.toThrow(LockedError);

    // Sin ciphertext de keypair previo (protección nunca habilitada), la
    // identidad no bloquea la creación del nodo: fallback en memoria/plano.
    const { saveSerializedKeypair, loadSerializedKeypair, resetIdentityMemory } = await import(
      '../../mesh/identityStore'
    );
    await saveSerializedKeypair('x');
    expect(await loadSerializedKeypair()).toBe('x');
    resetIdentityMemory();
    expect(await loadSerializedKeypair()).toBe('x');

    spy.mockRestore();
  });

  it('12. an in-flight write is coordinated with a concurrent disable (no orphaned ciphertext)', async () => {
    const db = await openLocalDb();
    await db.put('records', {
      entity: 'v',
      id: 'base',
      record: {
        id: 'base',
        instance_id: LOCAL_INSTANCE_ID,
        created_at: 'now',
        updated_at: 'now',
      } as any,
    });
    await enableProtection('pin', '123456');

    // Pausa la operación de cifrado para simular una escritura en curso.
    const encryptProto = Object.getPrototypeOf(crypto.subtle) as SubtleCrypto;
    const realEncrypt = encryptProto.encrypt;
    let releaseEncrypt!: () => void;
    const encryptGate = new Promise<void>((resolve) => {
      releaseEncrypt = resolve;
    });
    let encryptCalls = 0;
    const spy = vi.spyOn(encryptProto, 'encrypt').mockImplementation(function (
      this: SubtleCrypto,
      ...args: unknown[]
    ) {
      encryptCalls++;
      const paused = encryptCalls === 1 ? encryptGate : Promise.resolve();
      return paused.then(() =>
        (realEncrypt as (...a: unknown[]) => Promise<ArrayBuffer>).apply(this, args),
      );
    });

    const adapter = getLocalAdapter();
    const pendingCreate = adapter.create('vehicle', {
      id: 'new',
      instance_id: LOCAL_INSTANCE_ID,
      created_at: 'now',
      updated_at: 'now',
    });
    await vi.waitFor(() => expect(encryptCalls).toBeGreaterThan(0));

    const pendingDisable = disableProtection();
    releaseEncrypt();

    await pendingCreate;
    await pendingDisable;
    spy.mockRestore();

    const rows = await db.getAll('records');
    expect(rows).toHaveLength(2);
    // Ninguna fila puede quedar cifrada con la protección ya desactivada.
    expect(rows.every((r) => !!r.record && !r.enc)).toBe(true);
    expect(await getLockState()).toBe('off');
  });

  it('13. recovery flow generates a valid code and seals recoveryKit into envelope', async () => {
    const code = await enableProtection('pin', '123456');
    expect(code).toBeDefined();

    // Verify it is a valid backup code format
    await expect(parseBackupCode(code)).resolves.toBeDefined();

    // Verify envelope has recovery kit
    const env = await readLockEnvelope();

    expect(env.recoveryKit).toBeDefined();
    expect(env.recoveryKit.format).toBe('swal-vault-recovery-kit');
  });

  it('14. recovery flow decrypts with valid code and restores usable key', async () => {
    const code = await enableProtection('pin', '123456');
    lock();

    await unlock('recovery', code);
    expect(await getLockState()).toBe('unlocked');

    // Ensure the key is usable (symmetric AES-GCM)
    const key = getActiveKey();
    expect(key).not.toBeNull();
    expect(key?.algorithm.name).toBe('AES-GCM');
    expect(key?.usages).toContain('encrypt');
    expect(key?.usages).toContain('decrypt');

    // Test a basic encryption roundtrip with the key
    const text = 'test message';
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key as CryptoKey,
      new TextEncoder().encode(text),
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key as CryptoKey,
      encrypted,
    );
    expect(new TextDecoder().decode(decrypted)).toBe(text);
  });

  it('15. recovery flow throws with wrong code and leaves state untouched', async () => {
    await enableProtection('pin', '123456');
    lock();

    // Unlock fails with wrong code
    let thrownError: any;
    try {
      await unlock('recovery', 'bad-code');
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError.code).toBe('bad-code');

    // Valid format but wrong code triggers decrypt-failed
    const foreignCode = await import('../e2ee/crypto').then((m) => m.generateBackupCode());
    let foreignError: any;
    try {
      await unlock('recovery', foreignCode);
    } catch (e) {
      foreignError = e;
    }
    expect(foreignError).toBeDefined();
    expect(foreignError.code).toBe('decrypt-failed');

    // State is still locked
    expect(await getLockState()).toBe('locked');
  });

  it('16. sealed recovery kit contains no plaintext key data', async () => {
    const code = await enableProtection('pin', '123456');
    const env = await readLockEnvelope();

    const kitStr = JSON.stringify(env.recoveryKit);

    const parsed = await parseBackupCode(code);
    const rawBytes = parsed.secret;
    const b64Key = btoa(String.fromCharCode(...rawBytes));

    // The kit must not contain the base64 encoded secret code
    expect(kitStr).not.toContain(b64Key);
    // It should also not contain the code as is
    expect(kitStr).not.toContain(code);
  });

  it('17. recovery restores the exact data key that protects the records', async () => {
    const { code } = await enableWithPinnedKey('pin', '123456');
    const adapter = getLocalAdapter();
    await adapter.create('vehicle', {
      id: 'rec-17',
      instance_id: LOCAL_INSTANCE_ID,
      created_at: 'now',
      updated_at: 'now',
    });
    const db = await openLocalDb();
    const row = await db.get('records', ['vehicle', 'rec-17']);
    expect(row?.record).toBeUndefined();
    expect(row?.enc).toBeDefined();

    // La app se cierra (se pierde la clave en memoria) y se reabre con el código.
    lock();
    await unlock('recovery', code);
    expect(await getLockState()).toBe('unlocked');

    // La clave restaurada tiene que descifrar lo que cifró la original: un mutante
    // que altere los bytes decodificados deja el desbloqueo aparentemente correcto
    // pero inutiliza todos los datos del usuario.
    expect(await adapter.get('vehicle', 'rec-17', LOCAL_INSTANCE_ID)).toMatchObject({
      id: 'rec-17',
    });
  });

  it('18. the sealed kit carries the exact recovery entry in standard base64', async () => {
    const { code, rawKey } = await enableWithPinnedKey('pin', '123456');
    const env = await readLockEnvelope();

    const entries: RecoveryKitEntry[] = await openRecoveryKit(env.recoveryKit, code, {
      appId: 'gara-g',
      instanceId: LOCAL_INSTANCE_ID,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].entity).toBe('device-lock');
    expect(entries[0].id).toBe('data-key');
    expect((entries[0].share as { index: number }).index).toBe(2);

    // Base64 ESTÁNDAR exacto (alfabeto A-Za-z0-9+/ y un único '=' final) de los 32
    // bytes de la clave de datos: ni base64url, ni hex, ni otro largo.
    const share = (entries[0].share as { value: string }).value;
    expect(share).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(share).toBe(btoa(String.fromCharCode(...rawKey)));
  });

  it('19. recovery unlock restores the configured method', async () => {
    // Con respaldo PIN (el caso normal) el método vigente tras recuperar es 'pin'.
    const withPin = await enableWithPinnedKey('pin', '123456');
    lock();
    await unlock('recovery', withPin.code);
    expect(await getLockState()).toBe('unlocked');
    expect(getMethod()).toBe('pin');

    await disableProtection();

    // Sobre heredado con solo passkey: la recuperación no debe fijar 'pin' a mano.
    const dummyKey = new Uint8Array(32).fill(7);
    setPasskeyProvider({
      isSupported: async () => true,
      create: async () => ({
        id: '1',
        rawId: '1',
        type: 'public-key',
        response: {} as unknown as AuthenticatorAttestationResponse,
        getClientExtensionResults: () => ({ prf: { enabled: true, results: {} } }),
      }),
      get: async () => ({
        id: '1',
        rawId: '1',
        type: 'public-key',
        response: {} as unknown as AuthenticatorAssertionResponse,
        getClientExtensionResults: () => ({ prf: { results: { first: dummyKey } } }),
      }),
      extractPrfOutputs: () => ({ first: dummyKey }),
      getPrfOutput: () => dummyKey as unknown as Uint8Array<ArrayBufferLike>,
    } as any);

    const passkeyOnly = await enableWithPinnedKey('passkey', '123456');
    await patchLockEnvelope((env) => {
      delete env.pinEnvelope;
    });
    lock();
    await unlock('recovery', passkeyOnly.code);
    expect(await getLockState()).toBe('unlocked');
    expect(getMethod()).toBe('passkey');

    setPasskeyProvider(undefined);
  });
  it('20. recovery rejects zero-placeholder dummy codes and never exposes placeholder', async () => {
    const code = await enableProtection('pin', '123456');
    expect(code).not.toBe('00000000000000000000000000000000');
    expect(code).not.toMatch(/^0+$/);

    lock();
    await expect(unlock('recovery', '00000000000000000000000000000000')).rejects.toThrow();
    expect(await getLockState()).toBe('locked');
  });
});
