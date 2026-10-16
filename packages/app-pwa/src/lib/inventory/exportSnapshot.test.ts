import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getMemoryAdapter, setStorageAdapter } from '../domain';
import { exportLocalData, importLocalData } from '../local/dump';
import { closeLocalDb, getLocalAdapter } from '../local/indexedDbAdapter';
import {
  buildInventorySnapshot,
  sealInventorySnapshot,
  openInventorySnapshot,
  InventoryExportError,
} from './exportSnapshot';

// Vitest by default might not have localStorage if not in jsdom, we can polyfill it
const localStorageMock = (function() {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value.toString();
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key(i: number) {
      const keys = Object.keys(store);
      return keys[i] || null;
    }
  };
})();
globalThis.localStorage = localStorageMock as unknown as Record<string, unknown>;

describe('Inventory Export Snapshot', () => {
  beforeEach(async () => {
    // We need Web Crypto polyfill for test environment
    if (!globalThis.crypto?.subtle) {
      globalThis.crypto = (await import('node:crypto')).webcrypto as unknown as Crypto;
    }
    getMemoryAdapter().clear();
    setStorageAdapter(getMemoryAdapter());
    await closeLocalDb();
    globalThis.localStorage.clear();
  });

  it('buildInventorySnapshot correctly maps warehouse, inventoryItem and stockMovement', async () => {
    const adapter = getMemoryAdapter();
    const inst = 'inst-export-1';
    await adapter.create('warehouse', { id: 'w1', instance_id: inst, name: 'Main', type: 'bodega' } as unknown as Record<string, unknown>);
    await adapter.create('inventoryItem', {
      id: 'i1',
      instance_id: inst,
      sku: 'SKU123',
      name: 'Oil',
      quantity: 5,
      unit: 'L',
      minStock: 2,
      cost: 100,
      price: 150,
      warehouseId: 'w1',
      vehicleTypes: 'car,truck',
      notes: 'test note',
    } as unknown as Record<string, unknown>);
    await adapter.create('stockMovement', {
      id: 'm1',
      instance_id: inst,
      itemId: 'i1',
      kind: 'purchase',
      qty: 10,
    } as unknown as Record<string, unknown>);

    const snapshot = await buildInventorySnapshot(adapter, inst);

    expect(snapshot.format).toBe('swal-inventory-export/v1');
    expect(snapshot.source.appId).toBe('gara-g');
    expect(snapshot.source.instanceId).toBe(inst);

    expect(snapshot.locations).toHaveLength(1);
    expect(snapshot.locations[0].id).toBe('w1');
    expect(snapshot.locations[0].type).toBe('bodega');

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].id).toBe('i1');
    expect(snapshot.items[0].sku).toBe('SKU123');
    expect(snapshot.items[0].customFields.vehicleTypes).toBe('car,truck');
    expect(snapshot.items[0].customFields.notes).toBe('test note');

    expect(snapshot.movements).toHaveLength(1);
    expect(snapshot.movements[0].id).toBe('m1');
    expect(snapshot.movements[0].kind).toBe('purchase');
  });

  it('buildInventorySnapshot handles empty lists', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'empty-inst');
    expect(snapshot.locations).toHaveLength(0);
    expect(snapshot.items).toHaveLength(0);
    expect(snapshot.movements).toHaveLength(0);
  });

  it('seal and open round trip works correctly', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('warehouse', { id: 'w1', instance_id: 'inst1', name: 'Main', type: 'bodega' } as unknown as Record<string, unknown>);
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');

    const passphrase = 'llave de prueba larga';
    const sealed = await sealInventorySnapshot(snapshot, passphrase);

    expect(sealed.format).toBe('swal-inventory-export-enc/v1');
    expect(sealed.ciphertext).toBeTruthy();
    expect(sealed.iv).toBeTruthy();
    expect(sealed.salt).toBeTruthy();

    const opened = await openInventorySnapshot(sealed, passphrase);
    expect(opened.locations).toHaveLength(1);
    expect(opened.locations[0].name).toBe('Main');
  });

  it('openInventorySnapshot throws clave error on wrong passphrase', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');

    await expect(openInventorySnapshot(sealed, 'wrong-passphrase'))
      .rejects.toThrow(InventoryExportError);

    await expect(openInventorySnapshot(sealed, 'wrong-passphrase'))
      .rejects.toMatchObject({ kind: 'clave' });
  });

  it('openInventorySnapshot accepts plain document', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');

    const opened = await openInventorySnapshot(snapshot);
    expect(opened.locations).toHaveLength(0); // empty db
  });

  it('openInventorySnapshot throws formato error when check is missing', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');
    delete (sealed as unknown as {check?: string}).check;

    await expect(openInventorySnapshot(sealed, 'llave de prueba larga'))
      .rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws alterado error when ciphertext is tampered', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');

    // Alterado is now when check matches but decrypt fails. Since tampering with ciphertext will fail decrypt,
    // and check doesn't include ciphertext (it only hashes salt+iv), the check will succeed but decrypt will fail.
    // Let's flip one byte of the ciphertext.
    const cipherBuf = new Uint8Array(atob(sealed.ciphertext).split('').map(c => c.charCodeAt(0)));
    cipherBuf[0] ^= 0x01; // flip a bit
    sealed.ciphertext = btoa(String.fromCharCode.apply(null, Array.prototype.slice.call(cipherBuf) as number[]));

    await expect(openInventorySnapshot(sealed, 'llave de prueba larga'))
      .rejects.toMatchObject({ kind: 'alterado' });
  });

  it('openInventorySnapshot throws alterado error when plaintext is corrupted', async () => {
    // Modify plaintext by manually encrypting something that is not JSON, but using the correct KDF and check
    const passphrase = 'llave de prueba larga';
    const baseKey = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    const salt = new Uint8Array(16);
    const derivedBits = await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
      baseKey,
      512
    );
    const aesKeyBytes = derivedBits.slice(0, 32);
    const hmacKeyBytes = derivedBits.slice(32, 64);
    const aesKey = await globalThis.crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const hmacKey = await globalThis.crypto.subtle.importKey('raw', hmacKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

    const iv = new Uint8Array(12);
    const cipherBytes = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode('not-a-json'));

    const enc = new TextEncoder();
    const saltB64 = btoa(String.fromCharCode.apply(null, Array.prototype.slice.call(salt) as number[]));
    const ivB64 = btoa(String.fromCharCode.apply(null, Array.prototype.slice.call(iv) as number[]));
    const macData = enc.encode(`swal-inventory-export-enc/v1|${saltB64}`);
    const checkBuf = await globalThis.crypto.subtle.sign('HMAC', hmacKey, macData);

    const badSealed = {
      format: 'swal-inventory-export-enc/v1' as const,
      kdf: { name: 'PBKDF2' as const, hash: 'SHA-256' as const, iterations: 600000 },
      salt: saltB64,
      iv: ivB64,
      ciphertext: btoa(String.fromCharCode.apply(null, Array.prototype.slice.call(new Uint8Array(cipherBytes)) as number[])),
      check: btoa(String.fromCharCode.apply(null, Array.prototype.slice.call(new Uint8Array(checkBuf)) as number[])),
    };

    let err: Record<string, unknown> = {};
    try {
      await openInventorySnapshot(badSealed, passphrase);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InventoryExportError);
    expect(err.kind).toBe('alterado');
  });

  it('openInventorySnapshot throws formato for missing id', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    snapshot.items.push({
      sku: '123', name: 'name', quantity: 10, minStock: 0, cost: 0, price: 0, customFields: {}
    } as unknown as Record<string, unknown>); // missing id

    await expect(sealInventorySnapshot(snapshot, 'pass')).rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws formato for NaN qty', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    snapshot.items.push({
      id: 'id', name: 'name', quantity: NaN, minStock: 0, cost: 0, price: 0, customFields: {}
    } as unknown as Record<string, unknown>);

    await expect(sealInventorySnapshot(snapshot, 'pass')).rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws formato for bad date', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    snapshot.source.exportedAt = 'not-a-date';

    await expect(sealInventorySnapshot(snapshot, 'pass')).rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws formato for wrong KDF parameters', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'pass');
    sealed.kdf.iterations = 1000;

    await expect(openInventorySnapshot(sealed, 'pass')).rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws formato for items as [null]', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    snapshot.items = [null as unknown as Record<string, unknown>];

    await expect(sealInventorySnapshot(snapshot, 'pass')).rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws formato error if format is unknown', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');

    sealed.format = 'bad-format' as unknown as Record<string, unknown>;

    await expect(openInventorySnapshot(sealed, 'llave de prueba larga'))
      .rejects.toMatchObject({ kind: 'formato' });
  });

  it('buildInventorySnapshot maps unknown kind to adjust', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('stockMovement', { id: 'm1', instance_id: 'inst1', itemId: 'i1', kind: 'magic', qty: 10 } as unknown as Record<string, unknown>);

    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    expect(snapshot.movements[0].kind).toBe('adjust');
  });

  it('assert no secret keys in output', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('warehouse', { id: 'w1', instance_id: 'inst1', name: 'Main', type: 'bodega' } as unknown as Record<string, unknown>);
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');

    const jsonStr = JSON.stringify(sealed);
    expect(jsonStr).not.toContain('llave de prueba larga');
    // check clear output
    // check
  });

  it('local round trip using exportLocalData and importLocalData preserves the three entities', async () => {
    const adapter = getLocalAdapter();
    setStorageAdapter(adapter);
    // Use the default instance ID since readLocalStores filters by LOCAL_INSTANCE_ID
    const { LOCAL_INSTANCE_ID } = await import('../appMode');

    const now = new Date().toISOString();
    await adapter.create('warehouse', { id: 'w-local', instance_id: LOCAL_INSTANCE_ID, name: 'Local W', created_at: now, updated_at: now } as unknown as Record<string, unknown>);
    await adapter.create('inventoryItem', { id: 'i-local', instance_id: LOCAL_INSTANCE_ID, sku: 'LCL', name: 'Local I', created_at: now, updated_at: now } as unknown as Record<string, unknown>);
    await adapter.create('stockMovement', { id: 'm-local', instance_id: LOCAL_INSTANCE_ID, itemId: 'i-local', kind: 'adjust', qty: 1, created_at: now, updated_at: now } as unknown as Record<string, unknown>);

    const dump = await exportLocalData();
    expect(dump.entities.warehouse).toHaveLength(1);
    expect(dump.entities.inventoryItem).toHaveLength(1);
    expect(dump.entities.stockMovement).toHaveLength(1);

    await closeLocalDb();

    // Simulate import on a fresh DB
    const newAdapter = getLocalAdapter();
    await importLocalData(dump);

    const ws = await newAdapter.list('warehouse', LOCAL_INSTANCE_ID);
    expect(ws).toHaveLength(1);

    const is = await newAdapter.list('inventoryItem', LOCAL_INSTANCE_ID);
    expect(is).toHaveLength(1);

    const ms = await newAdapter.list('stockMovement', LOCAL_INSTANCE_ID);
    expect(ms).toHaveLength(1);
  });

  it('buildInventorySnapshot defaults to bodega for unknown types', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('warehouse', { id: 'w1', instance_id: 'inst1', name: 'Main', type: 'supermarket' } as unknown as Record<string, unknown>);
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    expect(snapshot.locations[0].type).toBe('bodega');
  });

  it('can round-trip 5000 items without error', async () => {
    const adapter = getMemoryAdapter();
    const inst = 'inst-large';
    await adapter.create('warehouse', { id: 'w-large', instance_id: inst, name: 'Large W', type: 'bodega' } as unknown as Record<string, unknown>);

    for (let i = 0; i < 5000; i++) {
      await adapter.create('inventoryItem', {
        id: `i-${i}`,
        instance_id: inst,
        name: `Item ${i}`,
        quantity: 1,
        warehouseId: 'w-large'
      } as unknown as Record<string, unknown>);
    }

    const snapshot = await buildInventorySnapshot(adapter, inst);
    expect(snapshot.items).toHaveLength(5000);

    const sealed = await sealInventorySnapshot(snapshot, 'large-pass');
    const opened = await openInventorySnapshot(sealed, 'large-pass');

    expect(opened.items).toHaveLength(5000);
  });

  it('buildInventorySnapshot applies signedQtyOf to movements and maps maintenanceId', async () => {
    const adapter = getMemoryAdapter();
    const inst = 'inst-export-signed';
    await adapter.create('inventoryItem', { id: 'i2', instance_id: inst, sku: 'SKU2', name: 'Oil', quantity: 5 } as unknown as Record<string, unknown>);
    await adapter.create('stockMovement', {
      id: 'm-use',
      instance_id: inst,
      itemId: 'i2',
      kind: 'use',
      qty: 10,
      maintenanceId: 'maint-123'
    } as unknown as Record<string, unknown>);

    const snapshot = await buildInventorySnapshot(adapter, inst);
    expect(snapshot.movements).toHaveLength(1);
    expect(snapshot.movements[0].qty).toBe(-10); // used item -> negative
    expect(snapshot.movements[0].customFields?.maintenanceId).toBe('maint-123');
  });

  it('buildInventorySnapshot filters out soft-deleted records', async () => {
    const adapter = getMemoryAdapter();
    const inst = 'inst-export-deleted';

    await adapter.create('warehouse', { id: 'w-del', instance_id: inst, name: 'Del', deleted_at: '2023-01-01' } as unknown as Record<string, unknown>);
    await adapter.create('inventoryItem', { id: 'i-del', instance_id: inst, name: 'DelItem', deletedAt: '2023-01-01' } as unknown as Record<string, unknown>);
    await adapter.create('stockMovement', { id: 'm-del', instance_id: inst, itemId: 'i-del', kind: 'use', qty: 10, deleted_at: '2023-01-01' } as unknown as Record<string, unknown>);

    const snapshot = await buildInventorySnapshot(adapter, inst);
    expect(snapshot.locations).toHaveLength(0);
    expect(snapshot.items).toHaveLength(0);
    expect(snapshot.movements).toHaveLength(0);
  });

  it('openInventorySnapshot throws formato for invalid salt base64', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');
    sealed.salt = '%';
    await expect(openInventorySnapshot(sealed, 'llave de prueba larga')).rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws formato for bad salt length', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');
    sealed.salt = btoa('short');
    await expect(openInventorySnapshot(sealed, 'llave de prueba larga')).rejects.toMatchObject({ kind: 'formato' });
  });

  it('openInventorySnapshot throws alterado for iv byte flip', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');
    const ivBytes = new Uint8Array(atob(sealed.iv).split('').map(c => c.charCodeAt(0)));
    ivBytes[0] ^= 1;
    sealed.iv = btoa(Array.prototype.slice.call(ivBytes).map(c => String.fromCharCode(c)).join(''));
    await expect(openInventorySnapshot(sealed, 'llave de prueba larga')).rejects.toMatchObject({ kind: 'alterado' });
  });

  it('openInventorySnapshot throws alterado for ciphertext byte flip', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');
    const ctBytes = new Uint8Array(atob(sealed.ciphertext).split('').map(c => c.charCodeAt(0)));
    ctBytes[0] ^= 1;
    sealed.ciphertext = btoa(Array.prototype.slice.call(ctBytes).map(c => String.fromCharCode(c)).join(''));
    await expect(openInventorySnapshot(sealed, 'llave de prueba larga')).rejects.toMatchObject({ kind: 'alterado' });
  });

  it('openInventorySnapshot throws clave for salt byte flip', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');
    const saltBytes = new Uint8Array(atob(sealed.salt).split('').map(c => c.charCodeAt(0)));
    saltBytes[0] ^= 1;
    sealed.salt = btoa(Array.prototype.slice.call(saltBytes).map(c => String.fromCharCode(c)).join(''));
    await expect(openInventorySnapshot(sealed, 'llave de prueba larga')).rejects.toMatchObject({ kind: 'clave' });
  });

  it('sealInventorySnapshot removes extraneous token/password fields', async () => {
    const adapter = getMemoryAdapter();
    const snapshot = await buildInventorySnapshot(adapter, 'inst1');
    (snapshot as unknown as unknown as Record<string, unknown>).token = 'SENSITIVE';
    (snapshot as unknown as unknown as Record<string, unknown>).password = 'SENSITIVE';
    const sealed = await sealInventorySnapshot(snapshot, 'llave de prueba larga');
    const opened = await openInventorySnapshot(sealed, 'llave de prueba larga');
    expect((opened as unknown as unknown as Record<string, unknown>).token).toBeUndefined();
    expect((opened as unknown as unknown as Record<string, unknown>).password).toBeUndefined();
  });
});
