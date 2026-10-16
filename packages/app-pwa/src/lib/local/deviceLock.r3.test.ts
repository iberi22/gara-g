// @vitest-environment jsdom
// Regression tests for judge round 3 (PR #46, head ba84bba).
// Each test FAILS on the base head and PASSES after the fix:
//   R3-N1: cancelled passkey enable must not brick the app (transition marker).
//   R3-M3: in-memory key bound to envelope generation (stale tab, no BC).
//   R3-N4: parallel wrong+correct PINs must not bypass progressive lockout.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

if (typeof crypto === 'undefined' || !(crypto as Crypto).subtle) {
  const nodeCrypto = await import('node:crypto');
  (globalThis as unknown as { crypto: unknown }).crypto = nodeCrypto.webcrypto;
}

async function fresh() {
  vi.resetModules();
  const dl = await import('./deviceLock');
  const ad = await import('./indexedDbAdapter');
  const id = await import('../../mesh/identityStore');
  return { dl, ad, id };
}

function rawGet(dbName: string, store: string, key: unknown): Promise<unknown> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(dbName);
    r.onsuccess = () => {
      const db = r.result;
      const g = db.transaction(store).objectStore(store).get(key as IDBValidKey);
      g.onsuccess = () => {
        res(g.result);
        db.close();
      };
      g.onerror = () => rej(g.error);
    };
    r.onerror = () => rej(r.error);
  });
}

const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  instance_id: 'local',
  created_at: 'c',
  updated_at: 'u',
  ...extra,
});

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('r3 regressions', () => {
  it('R3-N1 cancelled passkey enable leaves no stuck marker; reload fully works', async () => {
    const A = await fresh();
    await A.ad.getLocalAdapter().create('v', rec('a') as never);
    A.dl.setPasskeyProvider({
      async getPrfOutput() {
        throw new Error('NotAllowedError: user cancelled');
      },
    } as never);
    await expect(A.dl.enableProtection('passkey', '123456')).rejects.toThrow();

    // Simulate reload: fresh module, same IndexedDB.
    const R = await fresh();
    expect(await R.dl.getLockState()).not.toBe('transition');

    await R.dl.enableProtection('pin', '123456');
    expect(await R.dl.getLockState()).toBe('unlocked');
    const list = await R.ad.getLocalAdapter().list('v', 'local');
    expect(list).toHaveLength(1);

    R.dl.lock();
    await R.dl.unlock('pin', '123456');
    expect(await R.dl.getLockState()).toBe('unlocked');

    await R.id.saveSerializedKeypair('KP');
    R.id.resetIdentityMemory();
    expect(await R.id.loadSerializedKeypair()).toBe('KP');

    await R.dl.disableProtection();
    expect(await R.dl.getLockState()).toBe('off');
  }, 60000);

  it('R3-M3 stale tab (no BroadcastChannel) locks itself instead of writing lost rows', async () => {
    const BC = (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
    (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    try {
      const W = await fresh();
      const T = await fresh();
      await T.dl.enableProtection('pin', '111111');
      await W.dl.unlock('pin', '111111');
      await T.dl.disableProtection();
      await T.dl.enableProtection('pin', '222222');

      // W holds K1 from a dead generation: must report locked, not unlocked.
      expect(await W.dl.getLockState()).toBe('locked');
      // ... and must not write rows encrypted under K1 (they would be lost).
      await expect(W.ad.getLocalAdapter().create('v', rec('w1') as never)).rejects.toThrow();
      await expect(W.id.saveSerializedKeypair('KP-W')).rejects.toThrow();

      // T with the new PIN keeps a working list (no permanent StaleTicketError).
      T.dl.lock();
      await T.dl.unlock('pin', '222222');
      expect(await T.ad.getLocalAdapter().list('v', 'local')).toEqual([]);
      await T.id.saveSerializedKeypair('KP-T');
      T.id.resetIdentityMemory();
      expect(await T.id.loadSerializedKeypair()).toBe('KP-T');
    } finally {
      (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel = BC;
    }
  }, 60000);

  it('R3-N4 parallel 8 wrong + 1 correct PIN: the correct one is rejected as locked', async () => {
    const { dl } = await fresh();
    await dl.enableProtection('pin', '123456');
    dl.lock();

    const guesses = [
      '000001',
      '000002',
      '000003',
      '000004',
      '000005',
      '000006',
      '000007',
      '000008',
      '123456',
    ];
    const res = await Promise.allSettled(guesses.map((g) => dl.unlock('pin', g)));
    // The 8 wrong ones are rejected AND the correct one queued behind them is
    // rejected as locked instead of being accepted and resetting the counter.
    // R4-L1: every attempt past the pre-check counts —including locked ones—
    // and returns the same LOCKED, so no BAD_KEY/LOCKED oracle (9 = 8 + correct).
    expect(res.slice(0, 8).every((r) => r.status === 'rejected')).toBe(true);
    expect(res[8].status).toBe('rejected');
    expect(await dl.getLockState()).toBe('locked');
    const env = (await rawGet('gara-lock', 'gara-lock', 'envelope')) as {
      failedAttempts?: number;
    };
    expect(env.failedAttempts).toBe(9);
  }, 120000);
});
