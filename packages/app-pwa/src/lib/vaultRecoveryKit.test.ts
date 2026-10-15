// Kit de recuperacion del vault: round trip, rechazos y restauracion en un dispositivo nuevo.
import { describe, it, expect, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto as any;
import 'fake-indexeddb/auto';
import { CloudflareVaultAdapter, type CloudflareEnv } from './cloudflareVaultAdapter';
import {
  generateRecoveryKitCode,
  sealRecoveryKit,
  openRecoveryKit,
  serializeRecoveryKit,
  RecoveryKitError,
  type RecoveryKitV1,
} from './vaultRecoveryKit';

function fakeCloud() {
  const r2 = new Map<string, string>();
  const kv = new Map<string, string>();
  const env: CloudflareEnv = {
    SWAL_R2: {
      put: async (k: string, v: string) => void r2.set(k, v),
      get: async (k: string) => {
        const v = r2.get(k);
        return v === undefined ? null : { text: async () => v };
      },
      delete: async (k: string) => void r2.delete(k),
      list: async () => ({ objects: [] as unknown[] }),
    },
    SWAL_KV: {
      put: async (k: string, v: string) => void kv.set(k, v),
      get: async (k: string) => kv.get(k) ?? null,
    },
  };
  return { env, r2, kv };
}

const SECRETO = 'dato-confidencial-del-cliente-12345';
const rec = () => ({
  id: 'r1',
  instance_id: 'inst1',
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  secreto: SECRETO,
});
const REFS = [{ entity: 'item', id: 'r1' }];

async function wipeIndexedDB() {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (!db.name) continue;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(db.name!);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => {};
    });
  }
}

async function setup() {
  const { env, r2, kv } = fakeCloud();
  const adapter = new CloudflareVaultAdapter(env, 'app-kit');
  await adapter.create('item', rec() as any);
  const code = await generateRecoveryKitCode();
  const { kit, missing } = await adapter.exportRecoveryKit('inst1', REFS, code);
  return { env, r2, kv, adapter, code, kit, missing };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof RecoveryKitError ? e.code : `otro:${String(e)}`;
  }
  return 'sin-error';
};

describe('kit de recuperacion del vault', () => {
  beforeEach(wipeIndexedDB);

  it('kit_round_trip', async () => {
    const { adapter, code, kit } = await setup();
    const entries = await openRecoveryKit(kit, code, { appId: 'app-kit', instanceId: 'inst1' });
    const share = await adapter.recoveryShare('item', 'inst1', 'r1');
    expect(entries).toEqual([{ entity: 'item', id: 'r1', share }]);
  });

  it('kit_export_no_cloud_writes', async () => {
    const { env, r2, kv, adapter } = await setup();
    const r2Size = r2.size;
    const kvSize = kv.size;
    const code = await generateRecoveryKitCode();
    const r2Put = env.SWAL_R2!.put;
    let puts = 0;
    env.SWAL_R2!.put = async (...a: [string, string, any?]) => (puts++, r2Put(...a));
    await adapter.exportRecoveryKit('inst1', REFS, code);
    expect([r2.size, kv.size, puts]).toEqual([r2Size, kvSize, 0]);
  });

  it('kit_wrong_code_refused', async () => {
    const { env, kit } = await setup();
    await wipeIndexedDB();
    const nuevo = new CloudflareVaultAdapter(env, 'app-kit');
    const otro = await generateRecoveryKitCode();
    expect(await codeOf(nuevo.restoreRecoveryKit(kit, otro, 'inst1'))).toBe('decrypt-failed');
    expect(await nuevo.recoveryShare('item', 'inst1', 'r1')).toBeNull();
  });

  it('kit_malformed_code_refused', async () => {
    const { kit } = await setup();
    expect(await codeOf(openRecoveryKit(kit, 'ABC', { appId: 'app-kit', instanceId: 'inst1' }))).toBe('bad-code');
  });

  it('kit_tampered_ct_refused', async () => {
    const { code, kit } = await setup();
    const c = kit.ct[5] === 'A' ? 'B' : 'A';
    const bad: RecoveryKitV1 = { ...kit, ct: kit.ct.slice(0, 5) + c + kit.ct.slice(6) };
    expect(await codeOf(openRecoveryKit(bad, code, { appId: 'app-kit', instanceId: 'inst1' }))).toBe('decrypt-failed');
  });

  it('kit_tampered_header_refused', async () => {
    const { code, kit } = await setup();
    const bad: RecoveryKitV1 = { ...kit, createdAt: new Date(Date.parse(kit.createdAt) + 1000).toISOString() };
    expect(await codeOf(openRecoveryKit(bad, code, { appId: 'app-kit', instanceId: 'inst1' }))).toBe('decrypt-failed');
  });

  it('kit_cross_appId_refused', async () => {
    const { env, code, kit } = await setup();
    await wipeIndexedDB();
    const b = new CloudflareVaultAdapter(env, 'app-b');
    expect(await codeOf(b.restoreRecoveryKit(kit, code, 'inst1'))).toBe('app-mismatch');
    expect(await b.recoveryShare('item', 'inst1', 'r1')).toBeNull();
  });

  it('kit_cross_instance_refused', async () => {
    const { env, code, kit } = await setup();
    await wipeIndexedDB();
    const nuevo = new CloudflareVaultAdapter(env, 'app-kit');
    expect(await codeOf(nuevo.restoreRecoveryKit(kit, code, 'inst2'))).toBe('instance-mismatch');
    expect(await nuevo.recoveryShare('item', 'inst2', 'r1')).toBeNull();
  });

  it('kit_restored_device_reads_old_record', async () => {
    const { env, code, kit } = await setup();
    await wipeIndexedDB();
    const nuevo = new CloudflareVaultAdapter(env, 'app-kit');
    expect(await nuevo.get('item', 'r1', 'inst1')).toBeNull();
    expect(await nuevo.restoreRecoveryKit(kit, code, 'inst1')).toEqual({ restored: 1, skipped: 0 });
    expect((await nuevo.get('item', 'r1', 'inst1'))?.secreto).toBe(SECRETO);
  });

  it('kit_restore_never_overwrites', async () => {
    const { env, adapter, code, kit } = await setup();
    const nuevo = new CloudflareVaultAdapter(env, 'app-kit');
    expect(await nuevo.restoreRecoveryKit(kit, code, 'inst1')).toEqual({ restored: 0, skipped: 1 });
    expect((await nuevo.get('item', 'r1', 'inst1'))?.secreto).toBe(SECRETO);
    expect((await adapter['deviceStore'].load(adapter['shareKey']('item', 'inst1', 'r1')))?.device).toBeTruthy();
  });

  it('kit_contains_no_plaintext_share', async () => {
    const { adapter, kit } = await setup();
    const share = await adapter.recoveryShare('item', 'inst1', 'r1');
    const text = serializeRecoveryKit(kit);
    expect(text).not.toContain(JSON.stringify(share));
    expect(text).not.toContain(String(share.value));
    // 'r1'/'item' en base64url aleatorio (ct, salt, iv) coincidirian por azar: se comprueban fuera de ellos.
    const cabecera = text.replace(kit.ct, '').replace(kit.salt, '').replace(kit.iv, '');
    expect(cabecera).not.toContain('r1');
    expect(cabecera).not.toContain('item');
  });
  it('kit_rejects_invalid_shares', async () => {
    const code = await generateRecoveryKitCode();
    const real = 'lgiV4UFxrWFIvOvmP//wB8fIbzKds+e8I35YC8AkOng=';
    const badIndex = await sealRecoveryKit('app-kit', 'inst1', [{ entity: 'item', id: 'r1', share: { index: 3, value: real } }], code);
    const badValue = await sealRecoveryKit('app-kit', 'inst1', [{ entity: 'item', id: 'r2', share: { index: 2, value: 'A' } }], code);
    expect(await codeOf(openRecoveryKit(badIndex, code, { appId: 'app-kit', instanceId: 'inst1' }))).toBe('bad-format');
    expect(await codeOf(openRecoveryKit(badValue, code, { appId: 'app-kit', instanceId: 'inst1' }))).toBe('bad-format');
  });
});
