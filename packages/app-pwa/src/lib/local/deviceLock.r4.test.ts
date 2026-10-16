// @vitest-environment jsdom
// Regression tests for judge round 4 (PR #46, head 5934ff0).
// Each test FAILS on the base head and PASSES after the fix:
//   R4-L1: lockout must not oracle the PIN (BAD_KEY vs LOCKED in parallel).
//   R4-L2: expired lease + enable in another tab must not lose data (CAS fence).
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
      if (!db.objectStoreNames.contains(store)) {
        db.close();
        res(undefined);
        return;
      }
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

function rawAll(dbName: string, store: string): Promise<any[]> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(dbName);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(store)) {
        db.close();
        res([]);
        return;
      }
      const g = db.transaction(store).objectStore(store).getAll();
      g.onsuccess = () => {
        res((g.result as any[]) ?? []);
        db.close();
      };
      g.onerror = () => rej(g.error);
    };
    r.onerror = () => rej(r.error);
  });
}

const env = () => rawGet('gara-lock', 'gara-lock', 'envelope') as Promise<any>;
const rows = () => rawAll('gara-local', 'records');

const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  instance_id: 'local',
  created_at: 'c',
  updated_at: 'u',
  ...extra,
});

const codeOf = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'OK' : ((r.reason as { code?: string }).code ?? 'ERR');

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('r4 regressions', () => {
  it('R4-L1 parallel batch past the pre-check returns LOCKED for every PIN', async () => {
    const T = await fresh();
    await T.dl.enableProtection('pin', '123456');
    T.dl.lock();

    // Sembrar fallos para que el primer BAD_KEY del lote arme un lockout largo.
    // (El pre-chequeo LOCKED no cuenta: avanzar el tiempo tras cada fallo.)
    const realNow = Date.now.bind(Date);
    let t = realNow();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => t);
    for (let i = 0; i < 4; i++) {
      await T.dl.unlock('pin', '000000').catch(() => undefined);
      const cur = (await env()) as { failedAttempts: number; lockedUntil: number };
      t = cur.lockedUntil + 10;
    }
    nowSpy.mockImplementation(() => t);
    const seeded = (await env()) as { failedAttempts: number; lockedUntil: number };
    expect(seeded.failedAttempts).toBeGreaterThanOrEqual(4);

    // El tiempo ya está congelado justo tras expirar el lockout: todo el lote
    // pasa el pre-chequeo, pero el primer fallo rearma el bloqueo para el resto.

    const firstSettled = T.dl.unlock('pin', '000000').then(
      () => 'OK',
      (e: { code?: string }) => e.code ?? 'ERR'
    );
    await new Promise((r) => setTimeout(r, 50)); // entra primero al mutex
    const rest = await Promise.allSettled([
      T.dl.unlock('pin', '123456'),
      T.dl.unlock('pin', '000002'),
      T.dl.unlock('pin', '000003'),
    ]);
    const firstCode = await firstSettled;

    // El primero falla normal (BAD_KEY) y arma el lockout; el resto —incluido
    // el PIN correcto— debe responder LOCKED, indistinguible (sin oráculo).
    expect(firstCode).toBe('BAD_KEY');
    for (const r of rest) expect(codeOf(r)).toBe('LOCKED');

    // Tras expirar el bloqueo, el PIN correcto desbloquea y resetea el contador.
    const after = (await env()) as { lockedUntil: number };
    vi.spyOn(Date, 'now').mockImplementation(() => after.lockedUntil + 10);
    await T.dl.unlock('pin', '123456');
    expect(await T.dl.getLockState()).toBe('unlocked');
    expect(((await env()) as { failedAttempts: number }).failedAttempts).toBe(0);
  }, 60000);

  it('R4-L2 slow passkey prompt + enable in another tab keeps data, loser aborts', async () => {
    const P = await fresh();
    const Q = await fresh();
    await Q.ad.getLocalAdapter().create('v', rec('a') as never);

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    P.dl.setPasskeyProvider({
      async getPrfOutput() {
        await held;
        return new Uint8Array(32).fill(7);
      },
    } as never);
    const pEnable = P.dl.enableProtection('passkey', '111111').then(
      () => 'ok',
      (e: Error) => `ERR:${e.message}`
    );

    let marker: { state?: string } | null = null;
    for (let i = 0; i < 200 && !marker; i++) {
      marker = (await env()) as { state?: string } | null;
      if (!marker) await new Promise((r) => setTimeout(r, 25));
    }
    expect(marker?.state).toBe('transition');

    // El prompt de P sigue abierto cuando vence el lease: Q ve 'off' y habilita.
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 121_000);
    expect(await Q.dl.getLockState()).toBe('off');
    await Q.dl.enableProtection('pin', '222222');
    expect(await Q.dl.getLockState()).toBe('unlocked');
    const envQ = await env();
    expect((await rows()).map((r) => (r.enc ? 'enc' : 'plain'))).toEqual(['enc']);

    // P reanuda: debe rechazar SIN migrar y SIN tocar el sobre de Q.
    release();
    const pRes = await pEnable;
    expect(pRes.startsWith('ERR')).toBe(true);
    expect(pRes).toMatch(/otra pestaña/i);
    expect(await env()).toEqual(envQ);
    expect((await rows()).map((r) => (r.enc ? 'enc' : 'plain'))).toEqual(['enc']);

    // Los datos de Q siguen intactos y desbloqueables; nada atascado en transición.
    vi.restoreAllMocks();
    Q.dl.lock();
    await Q.dl.unlock('pin', '222222');
    expect(await Q.dl.getLockState()).toBe('unlocked');
    const list = await Q.ad.getLocalAdapter().list('v', 'local');
    expect(list).toHaveLength(1);
    expect((list[0] as { id: string }).id).toBe('a');
  }, 120000);
});
