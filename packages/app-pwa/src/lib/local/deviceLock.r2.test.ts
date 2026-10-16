// @vitest-environment jsdom
// Regression tests for judge round 2 (PR #46, head 0c5bac6).
// Each test FAILS on the base head and PASSES after the fix.
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

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('r2 regressions', () => {
  it('T1 cross-tab: second tab stops encrypting after protection is disabled', async () => {
    const A = await fresh();
    const B = await fresh();
    await A.ad.getLocalAdapter().create('v', rec('r1') as never);
    await A.dl.enableProtection('pin', '123456');
    await B.dl.unlock('pin', '123456');
    await A.dl.disableProtection();

    // The stale tab must no longer report unlocked once the envelope is gone.
    expect(await B.dl.getLockState()).toBe('off');

    // Writes from the stale tab must never produce ciphertext without an envelope.
    await B.ad.getLocalAdapter().create('v', rec('r2') as never);
    const raw = (await rawGet('gara-local', 'records', ['v', 'r2'])) as { enc?: string };
    expect(raw?.enc).toBeUndefined();

    // The disabling tab keeps a working entity list (no unreadable rows).
    const list = await A.ad.getLocalAdapter().list('v', 'local');
    expect(list.map((r: { id: string }) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('T2a identity save in flight during disable stays consistent', async () => {
    const { dl, id } = await fresh();
    await dl.enableProtection('pin', '123456');

    let gate!: () => void;
    const held = new Promise<void>((r) => (gate = r));
    let armed = true;
    const orig = crypto.subtle.encrypt.bind(crypto.subtle);
    type EncryptFn = typeof crypto.subtle.encrypt;
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((async (alg: unknown, k: unknown, d: unknown) => {
      const params = alg as { additionalData?: ArrayBuffer };
      const aad = params?.additionalData ? new TextDecoder().decode(params.additionalData) : '';
      if (armed && aad === 'gara-mesh|kv|node-keypair') {
        armed = false;
        await held;
      }
      return orig(alg as AlgorithmIdentifier, k as CryptoKey, d as BufferSource);
    }) as EncryptFn);

    const save = id.saveSerializedKeypair('KEYPAIR-SECRET');
    await new Promise((r) => setTimeout(r, 50));
    await dl.disableProtection();
    gate();
    await save;
    spy.mockRestore();

    // State is off, so the row must be plaintext and the identity must load.
    expect(await dl.getLockState()).toBe('off');
    const raw = (await rawGet('gara-mesh', 'kv', 'node-keypair')) as string;
    expect(String(raw).startsWith('v1.')).toBe(false);
    id.resetIdentityMemory();
    expect(await id.loadSerializedKeypair()).toBe('KEYPAIR-SECRET');
  });

  it('T2b identity save in flight during enable leaves no plaintext at rest', async () => {
    const { dl, id } = await fresh();
    await id.saveSerializedKeypair('KP0');

    let gate!: () => void;
    const held = new Promise<void>((r) => (gate = r));
    const realOpen = indexedDB.open.bind(indexedDB);
    let armed = true;
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, v?: number) => {
      if (armed && name === 'gara-mesh') {
        armed = false;
        const req: Record<string, unknown> = {};
        void held.then(() => {
          const r = realOpen(name, v);
          r.onsuccess = () => {
            req.result = r.result;
            (req.onsuccess as (() => void) | undefined)?.();
          };
          r.onerror = () => {
            req.error = r.error;
            (req.onerror as (() => void) | undefined)?.();
          };
        });
        return req;
      }
      return realOpen(name, v);
    }) as unknown as typeof indexedDB.open);

    const save = id.saveSerializedKeypair('KP-NEW-SECRET');
    await new Promise((r) => setTimeout(r, 20));
    await dl.enableProtection('pin', '123456');
    gate();
    await save;
    spy.mockRestore();

    expect(await dl.getLockState()).toBe('unlocked');
    const raw = (await rawGet('gara-mesh', 'kv', 'node-keypair')) as string;
    expect(String(raw).startsWith('v1.')).toBe(true);
    expect(String(raw)).not.toContain('KP-NEW-SECRET');
    id.resetIdentityMemory();
    expect(await id.loadSerializedKeypair()).toBe('KP-NEW-SECRET');
  });

  it('T3 concurrent enable: loser rejects cleanly, winner PIN keeps working', async () => {
    const { dl, ad } = await fresh();
    await ad.getLocalAdapter().create('v', rec('r1', { secret: 'S' }) as never);

    const res = await Promise.allSettled([
      dl.enableProtection('pin', '111111'),
      dl.enableProtection('pin', '222222'),
    ]);
    const fulfilled = res.filter((r) => r.status === 'fulfilled');
    const rejected = res.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winnerPin = res[0].status === 'fulfilled' ? '111111' : '222222';
    dl.lock();
    await dl.unlock('pin', winnerPin);
    expect(await dl.getLockState()).toBe('unlocked');
    const list = await ad.getLocalAdapter().list('v', 'local');
    expect(list).toHaveLength(1);
    expect((list[0] as unknown as Record<string, unknown>).secret).toBe('S');
  });

  it('T4 storage-unavailable with protection never enabled keeps memory fallback', async () => {
    const failingOpen = (() => {
      const req: Record<string, unknown> = {};
      setTimeout(() => {
        req.error = new DOMException('denied', 'InvalidStateError');
        (req.onerror as (() => void) | undefined)?.();
      }, 0);
      return req;
    }) as unknown as typeof indexedDB.open;
    vi.spyOn(indexedDB, 'open').mockImplementation(failingOpen);

    const id = await import('../../mesh/identityStore');
    const dl = await import('./deviceLock');
    expect(await dl.getLockState()).toBe('error');

    // Must not throw: mesh/node.ts falls back to an in-memory identity.
    await id.saveSerializedKeypair('KP');
    expect(await id.loadSerializedKeypair()).toBe('KP');
  });

  it('T5 parallel wrong unlocks each count toward lockout', async () => {
    const { dl } = await fresh();
    await dl.enableProtection('pin', '123456');
    dl.lock();

    const res = await Promise.allSettled(
      ['000001', '000002', '000003', '000004', '000005'].map((p) => dl.unlock('pin', p)),
    );
    expect(res.filter((r) => r.status === 'rejected')).toHaveLength(5);
    const env = (await rawGet('gara-lock', 'gara-lock', 'envelope')) as { failedAttempts?: number };
    expect(env.failedAttempts).toBe(5);
  });
});
