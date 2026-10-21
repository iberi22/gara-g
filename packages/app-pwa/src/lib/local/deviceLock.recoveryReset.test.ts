import { webcrypto } from 'node:crypto';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enableProtection,
  getActiveKey,
  getLockState,
  lock,
  resetPinAfterRecovery,
  unlock,
} from './deviceLock';
import { closeLocalDb } from './indexedDbAdapter';

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  (globalThis as any).crypto = webcrypto;
}

beforeEach(async () => {
  await closeLocalDb();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  lock();
});

afterEach(() => {
  lock();
});

describe('resetPinAfterRecovery (integración, sin mocks de deviceLock)', () => {
  it('fija un PIN nuevo tras unlock(recovery) sin pedir el PIN viejo', async () => {
    const code = await enableProtection('pin', '123456');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const probe = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      getActiveKey() as CryptoKey,
      new TextEncoder().encode('probe'),
    );
    lock();
    await unlock('recovery', code);
    await resetPinAfterRecovery('654321');
    lock();

    await unlock('pin', '654321');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, getActiveKey() as CryptoKey, probe);
    expect(new TextDecoder().decode(plain)).toBe('probe');
    expect(await getLockState()).toBe('unlocked');
    lock();
    await expect(unlock('pin', '123456')).rejects.toBeDefined();
    expect(await getLockState()).toBe('locked');
  });

  it('la clave de recuperación es de un solo uso', async () => {
    const code = await enableProtection('pin', '123456');
    lock();
    await unlock('recovery', code);
    await resetPinAfterRecovery('654321');
    await expect(resetPinAfterRecovery('111111')).rejects.toThrow();
  });

  it('rechaza un PIN con formato inválido', async () => {
    const code = await enableProtection('pin', '123456');
    lock();
    await unlock('recovery', code);
    await expect(resetPinAfterRecovery('12ab')).rejects.toThrow(/6 dígitos/);
  });

  it('rechaza si el último desbloqueo fue con PIN', async () => {
    await enableProtection('pin', '123456');
    lock();
    await unlock('pin', '123456');
    await expect(resetPinAfterRecovery('654321')).rejects.toThrow();
    lock();
    await expect(unlock('pin', '123456')).resolves.toBeUndefined();
  });

  it('rechaza estando bloqueado', async () => {
    await enableProtection('pin', '123456');
    lock();
    await expect(resetPinAfterRecovery('654321')).rejects.toThrow();
  });
});
