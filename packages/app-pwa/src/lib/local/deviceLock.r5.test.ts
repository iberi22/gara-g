// @vitest-environment jsdom
// Regression tests for judge round 5 (PR #46, head 04956b7).
// Stale write-back of the envelope after the slow key derivation (U1/U2):
// every envelope write after an await must be compare-and-write, and two
// tabs failing a wrong PIN at once must keep both counter increments.
// Each test FAILS on the base head and PASSES after the fix:
//   R5-U1: wrong-PIN unlock racing disable+enable must not resurrect K1.
//   R5-U2: wrong-PIN unlock racing changePin must not revert the new PIN.
//   R5-T2: two tabs failing a wrong PIN at the same moment keep both increments.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      if (!db.objectStoreNames.contains(store)) {
        db.close();
        res(undefined);
        return;
      }
      const g = db
        .transaction(store)
        .objectStore(store)
        .get(key as IDBValidKey);
      g.onsuccess = () => {
        res(g.result);
        db.close();
      };
      g.onerror = () => rej(g.error);
    };
    r.onerror = () => rej(r.error);
  });
}

const env = () => rawGet('gara-lock', 'gara-lock', 'envelope') as Promise<any>;

const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  instance_id: 'local',
  created_at: 'c',
  updated_at: 'u',
  ...extra,
});

const errCode = (e: unknown) =>
  (e as { code?: string })?.code ?? (e as { name?: string })?.name ?? 'ERR';

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Park the first PBKDF2 deriveKey (tab X, slow/frozen KDF) until released. */
function gateFirstDeriveKey() {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let armed = true;
  const subtle = crypto.subtle;
  const orig = subtle.deriveKey.bind(subtle);
  const impl = async (...a: unknown[]): Promise<CryptoKey> => {
    if (armed) {
      armed = false;
      await held;
    }
    return orig(...(a as Parameters<typeof subtle.deriveKey>));
  };
  const spy = vi.spyOn(subtle, 'deriveKey').mockImplementation(impl as typeof subtle.deriveKey);
  return { release, spy };
}

const realNow = Date.now.bind(Date);

/** Travel past the lockout armed by a failed attempt so the next unlock is judged on the PIN. */
async function skipPastLockout() {
  const cur = (await env()) as { lockedUntil?: unknown };
  const lu = cur?.lockedUntil;
  if (typeof lu === 'number' && lu > realNow()) {
    const target = lu + 10;
    vi.spyOn(Date, 'now').mockImplementation(() => target);
  }
}

describe('r5 regressions', () => {
  it('R5-U1 wrong-PIN unlock in tab X does not resurrect the old envelope after tab Y disables+re-enables', async () => {
    const X = await fresh();
    const Y = await fresh();
    await Y.dl.enableProtection('pin', '111111');
    await Y.ad.getLocalAdapter().create('v', rec('a') as never);
    X.dl.lock();

    const g = gateFirstDeriveKey();
    const xu = X.dl.unlock('pin', '999999').then(
      () => 'OK',
      (e) => `ERR:${errCode(e)}`,
    );
    await new Promise((r) => setTimeout(r, 50)); // X parked inside the slow KDF
    g.spy.mockRestore(); // tab Y derives at full speed from here on
    await Y.dl.disableProtection();
    await Y.dl.enableProtection('pin', '222222');
    g.release();
    expect(await xu).toBe('ERR:BAD_KEY');

    // The stale save must not have restored the K1 envelope: the new PIN
    // unlocks, data is readable, and the old PIN no longer works.
    await skipPastLockout();
    await Y.dl.unlock('pin', '222222');
    expect(await Y.dl.getLockState()).toBe('unlocked');
    expect(await Y.ad.getLocalAdapter().list('v', 'local')).toHaveLength(1);
    const oldPin = await Y.dl.unlock('pin', '111111').then(
      () => 'OK',
      (e) => `ERR:${errCode(e)}`,
    );
    expect(oldPin).toBe('ERR:BAD_KEY');
  }, 60000);

  it('R5-U2 wrong-PIN unlock in tab X does not revert tab Y changePin', async () => {
    const X = await fresh();
    const Y = await fresh();
    await Y.dl.enableProtection('pin', '111111');

    const g = gateFirstDeriveKey();
    const xu = X.dl.unlock('pin', '999999').then(
      () => 'OK',
      (e) => `ERR:${errCode(e)}`,
    );
    await new Promise((r) => setTimeout(r, 50)); // X parked inside the slow KDF
    g.spy.mockRestore();
    await Y.dl.changePin('111111', '333333');
    g.release();
    expect(await xu).toBe('ERR:BAD_KEY');

    // The new PIN works, the old one does not: the change was not undone.
    Y.dl.lock();
    await skipPastLockout();
    await Y.dl.unlock('pin', '333333');
    expect(await Y.dl.getLockState()).toBe('unlocked');
    const oldPin = await Y.dl.unlock('pin', '111111').then(
      () => 'OK',
      (e) => `ERR:${errCode(e)}`,
    );
    expect(oldPin).toBe('ERR:BAD_KEY');
  }, 60000);

  it('R5-T2 two tabs failing a wrong PIN at the same moment keep both counter increments', async () => {
    const X = await fresh();
    const Y = await fresh();
    await Y.dl.enableProtection('pin', '111111');

    const [rx, ry] = await Promise.allSettled([
      X.dl.unlock('pin', '999999'),
      Y.dl.unlock('pin', '999999'),
    ]);
    expect(rx.status).toBe('rejected');
    expect(ry.status).toBe('rejected');
    expect(errCode((rx as PromiseRejectedResult).reason)).toBe('BAD_KEY');
    expect(errCode((ry as PromiseRejectedResult).reason)).toBe('BAD_KEY');
    expect(((await env()) as { failedAttempts: number }).failedAttempts).toBe(2);
  }, 60000);
});
