// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { exportLocalData, importLocalData, mergeLocalDumps } from './dump';
import { LOCAL_CHANGED_EVENT, LOCAL_INSTANCE_ID } from '../appMode';
import { createEntity, deleteEntity, getEntity, listEntities, setStorageAdapter, updateEntity, getMemoryAdapter } from '../domain';
import type { DomainRecord } from '../domain';
import { appendMovement, movementHistory, quantityOf } from '../inventory/ledger';
import { closeLocalDb, getLocalAdapter, openLocalDb, replaceLocalStores } from './indexedDbAdapter';
import type { LocalDump } from './types';
import { enableProtection, lock, unlock } from './deviceLock';
import { LockedError } from './recordCrypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rec = (id: string, updated_at: string, extra: Record<string, unknown> = {}): DomainRecord => ({
  id,
  instance_id: LOCAL_INSTANCE_ID,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at,
  ...extra,
});

const dump = (over: Partial<LocalDump> = {}): LocalDump => ({
  version: 1,
  exportedAt: '2026-06-01T00:00:00.000Z',
  entities: {},
  deleted: {},
  kv: {},
  ...over,
});

beforeEach(async () => {
  await closeLocalDb();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  setStorageAdapter(getLocalAdapter());
});

afterEach(() => {
  lock();
  setStorageAdapter(getMemoryAdapter());
});

describe('IndexedDbAdapter vía domain.ts', () => {
  it('crea, lista, lee y actualiza con instance_id local y fechas ISO', async () => {
    const v = await createEntity('vehicle', { plate: 'ABC123' }, LOCAL_INSTANCE_ID);
    expect(v.instance_id).toBe(LOCAL_INSTANCE_ID);
    expect(Date.parse(v.created_at)).not.toBeNaN();
    const list = await listEntities('vehicle', LOCAL_INSTANCE_ID);
    expect(list.map((r) => r.id)).toEqual([v.id]);
    await new Promise((r) => setTimeout(r, 5));
    const up = await updateEntity('vehicle', v.id, { plate: 'XYZ999' }, LOCAL_INSTANCE_ID);
    expect(up?.plate).toBe('XYZ999');
    expect(up!.updated_at > v.updated_at).toBe(true);
    expect((await getEntity('vehicle', v.id, LOCAL_INSTANCE_ID))?.plate).toBe('XYZ999');
  });

  it('actualizaciones concurrentes sobre campos distintos no se pisan', async () => {
    const v = await createEntity('vehicle', { plate: 'A', color: 'rojo' }, LOCAL_INSTANCE_ID);

    await Promise.all([
      updateEntity('vehicle', v.id, { plate: 'B' }, LOCAL_INSTANCE_ID),
      updateEntity('vehicle', v.id, { color: 'azul' }, LOCAL_INSTANCE_ID),
    ]);

    const got = await getEntity('vehicle', v.id, LOCAL_INSTANCE_ID);
    expect(got?.plate).toBe('B');
    expect(got?.color).toBe('azul');
  });

  it('una actualización pendiente no resucita una fila borrada', async () => {
    const v = await createEntity('vehicle', { plate: 'A' }, LOCAL_INSTANCE_ID);
    await enableProtection('pin', '123456');

    // Pausa el cifrado de la escritura para intercalar el borrado.
    const encryptProto = Object.getPrototypeOf(crypto.subtle) as SubtleCrypto;
    const realEncrypt = encryptProto.encrypt;
    let releaseEncrypt!: () => void;
    const encryptGate = new Promise<void>((resolve) => { releaseEncrypt = resolve; });
    let encryptPaused = false;
    const spy = vi.spyOn(encryptProto, 'encrypt').mockImplementation(function (this: SubtleCrypto, ...args: unknown[]) {
      encryptPaused = true;
      return encryptGate.then(() => (realEncrypt as (...a: unknown[]) => Promise<ArrayBuffer>).apply(this, args));
    });

    const pendingUpdate = updateEntity('vehicle', v.id, { plate: 'B' }, LOCAL_INSTANCE_ID);
    await vi.waitFor(() => expect(encryptPaused).toBe(true));
    await deleteEntity('vehicle', v.id, LOCAL_INSTANCE_ID);
    releaseEncrypt();

    await expect(pendingUpdate).resolves.toBeNull();
    spy.mockRestore();

    expect(await getEntity('vehicle', v.id, LOCAL_INSTANCE_ID)).toBeNull();
    expect(await listEntities('vehicle', LOCAL_INSTANCE_ID)).toHaveLength(0);
  });

  it('no mezcla tenants', async () => {
    const v = await createEntity('vehicle', { plate: 'A' }, 'otro-tenant');
    expect(await listEntities('vehicle', LOCAL_INSTANCE_ID)).toEqual([]);
    expect(await getEntity('vehicle', v.id, LOCAL_INSTANCE_ID)).toBeNull();
    expect(await deleteEntity('vehicle', v.id, LOCAL_INSTANCE_ID)).toBe(false);
  });

  it('borrar deja una lápida y emite el evento tras cada escritura', async () => {
    let events = 0;
    const on = () => events++;
    window.addEventListener(LOCAL_CHANGED_EVENT, on);
    const v = await createEntity('vehicle', { plate: 'A' }, LOCAL_INSTANCE_ID);
    await updateEntity('vehicle', v.id, { plate: 'B' }, LOCAL_INSTANCE_ID);
    expect(await deleteEntity('vehicle', v.id, LOCAL_INSTANCE_ID)).toBe(true);
    window.removeEventListener(LOCAL_CHANGED_EVENT, on);
    expect(events).toBe(3);
    expect(await listEntities('vehicle', LOCAL_INSTANCE_ID)).toEqual([]);
    const out = await exportLocalData();
    expect(out.deleted.vehicle?.map((t) => t.id)).toEqual([v.id]);
    expect(Date.parse(out.deleted.vehicle[0].deletedAt)).not.toBeNaN();
  });
});

describe('exportLocalData / importLocalData', () => {
  it('ida y vuelta: registros, lápidas y kv de la lista blanca', async () => {
    const v = await createEntity('vehicle', { plate: 'ABC123' }, LOCAL_INSTANCE_ID);
    const m = await createEntity('maintenance', { vehicleId: v.id, type: 'aceite' }, LOCAL_INSTANCE_ID);
    const gone = await createEntity('maintenance', { vehicleId: v.id, type: 'x' }, LOCAL_INSTANCE_ID);
    await deleteEntity('maintenance', gone.id, LOCAL_INSTANCE_ID);
    localStorage.setItem('garage:paint:v1:' + v.id, '{"hex":"FF0000"}');
    localStorage.setItem('swal:theme-mode', 'dark');
    localStorage.setItem('gara:sync:code', 'SECRETO');
    localStorage.setItem('garage:snapshot:v1', '{}');

    const out = await exportLocalData();
    expect(out.version).toBe(1);
    expect(Object.keys(out.kv).sort()).toEqual(['garage:paint:v1:' + v.id, 'swal:theme-mode'].sort());
    expect(JSON.stringify(out)).not.toContain('SECRETO');

    // Dispositivo nuevo
    await closeLocalDb();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    localStorage.clear();
    localStorage.setItem('gara:sync:code', 'MIO');
    localStorage.setItem('swal:theme-mode', 'light');
    localStorage.setItem('gara:prefs', 'viejo');

    await importLocalData(out);
    expect((await listEntities('vehicle', LOCAL_INSTANCE_ID)).map((r) => r.id)).toEqual([v.id]);
    expect((await listEntities('maintenance', LOCAL_INSTANCE_ID)).map((r) => r.id)).toEqual([m.id]);
    const again = await exportLocalData();
    expect(again.deleted.maintenance.map((t) => t.id)).toEqual([gone.id]);
    expect(localStorage.getItem('swal:theme-mode')).toBe('dark');
    expect(localStorage.getItem('gara:prefs')).toBeNull(); // el kv se reemplaza
    expect(localStorage.getItem('gara:sync:code')).toBe('MIO'); // fuera de la lista blanca: intacto
  });

  it('importar reemplaza lo que había', async () => {
    await createEntity('vehicle', { plate: 'VIEJO' }, LOCAL_INSTANCE_ID);
    await importLocalData(dump({ entities: { vehicle: [rec('n1', '2026-02-01T00:00:00.000Z', { plate: 'NUEVO' })] } }));
    const list = await listEntities('vehicle', LOCAL_INSTANCE_ID);
    expect(list.map((r) => r.plate)).toEqual(['NUEVO']);
  });

  it('un volcado inválido lanza y no toca nada', async () => {
    await createEntity('vehicle', { plate: 'A' }, LOCAL_INSTANCE_ID);
    localStorage.setItem('swal:theme-mode', 'dark');
    let events = 0;
    const on = () => events++;
    window.addEventListener(LOCAL_CHANGED_EVENT, on);
    const bad: unknown[] = [
      null,
      { ...dump(), version: 2 },
      { ...dump(), entities: [] },
      { ...dump(), kv: { 'swal:theme-mode': 3 } },
      dump({ entities: { vehicle: [{ plate: 'sin id' } as unknown as DomainRecord] } }),
      dump({ entities: { noExiste: [] } }),
      dump({ deleted: { vehicle: [{ id: 'x', deletedAt: 'ayer' }] } }),
    ];
    for (const b of bad) await expect(importLocalData(b as LocalDump)).rejects.toThrow(/inválido/);
    window.removeEventListener(LOCAL_CHANGED_EVENT, on);
    expect(events).toBe(0);
    expect(await listEntities('vehicle', LOCAL_INSTANCE_ID)).toHaveLength(1);
    expect(localStorage.getItem('swal:theme-mode')).toBe('dark');
  });

  it('importar emite el evento', async () => {
    let events = 0;
    const on = () => events++;
    window.addEventListener(LOCAL_CHANGED_EVENT, on);
    await importLocalData(dump());
    window.removeEventListener(LOCAL_CHANGED_EVENT, on);
    expect(events).toBe(1);
  });
});

describe('mergeLocalDumps', () => {
  const T1 = '2026-03-01T00:00:00.000Z';
  const T2 = '2026-03-02T00:00:00.000Z';
  const T3 = '2026-03-03T00:00:00.000Z';

  it('gana el updated_at mayor, sin importar el orden', () => {
    const a = dump({ entities: { vehicle: [rec('v1', T1, { plate: 'A' }), rec('v2', T3, { plate: 'solo-a' })] } });
    const b = dump({ entities: { vehicle: [rec('v1', T2, { plate: 'B' })] } });
    const ab = mergeLocalDumps(a, b);
    const ba = mergeLocalDumps(b, a);
    expect(ab.entities).toEqual(ba.entities);
    expect(ab.entities.vehicle.map((r) => [r.id, r.plate])).toEqual([['v1', 'B'], ['v2', 'solo-a']]);
  });

  it('empate exacto: resultado determinista en ambos órdenes', () => {
    const a = dump({ entities: { vehicle: [rec('v1', T1, { plate: 'A' })] } });
    const b = dump({ entities: { vehicle: [rec('v1', T1, { plate: 'B' })] } });
    expect(mergeLocalDumps(a, b).entities).toEqual(mergeLocalDumps(b, a).entities);
  });

  it('una lápida más reciente elimina el registro y se conserva; una más vieja no', () => {
    const a = dump({ entities: { vehicle: [rec('v1', T1), rec('v2', T3)] } });
    const b = dump({ deleted: { vehicle: [{ id: 'v1', deletedAt: T2 }, { id: 'v2', deletedAt: T2 }] } });
    for (const m of [mergeLocalDumps(a, b), mergeLocalDumps(b, a)]) {
      expect(m.entities.vehicle.map((r) => r.id)).toEqual(['v2']);
      expect(m.deleted.vehicle.map((t) => t.id).sort()).toEqual(['v1', 'v2']);
    }
  });

  it('lápida con la misma fecha que el registro: el registro se queda', () => {
    const m = mergeLocalDumps(
      dump({ entities: { vehicle: [rec('v1', T2)] } }),
      dump({ deleted: { vehicle: [{ id: 'v1', deletedAt: T2 }] } }),
    );
    expect(m.entities.vehicle.map((r) => r.id)).toEqual(['v1']);
  });

  it('kv: se une y ante conflicto gana el exportedAt mayor', () => {
    const a = dump({ exportedAt: T1, kv: { 'swal:theme-mode': 'light', 'gara:prefs': 'a' } });
    const b = dump({ exportedAt: T2, kv: { 'swal:theme-mode': 'dark', 'garage:theme:v1': 'b' } });
    for (const m of [mergeLocalDumps(a, b), mergeLocalDumps(b, a)]) {
      expect(m.kv).toEqual({ 'swal:theme-mode': 'dark', 'gara:prefs': 'a', 'garage:theme:v1': 'b' });
      expect(m.exportedAt).toBe(T2);
    }
  });

  it('no muta los argumentos', () => {
    const a = dump({ entities: { vehicle: [rec('v1', T1)] } });
    const snap = JSON.stringify(a);
    mergeLocalDumps(a, dump({ deleted: { vehicle: [{ id: 'v1', deletedAt: T3 }] } }));
    expect(JSON.stringify(a)).toBe(snap);
  });
});

describe('LockedError checks', () => {
  it('bloquea todas las operaciones de IDB cuando está protegido', async () => {
    await createEntity('vehicle', { plate: 'ABC' }, LOCAL_INSTANCE_ID);
    await enableProtection('pin', '123456');
    lock();

    await expect(listEntities('vehicle', LOCAL_INSTANCE_ID)).rejects.toThrow(LockedError);
    await expect(createEntity('vehicle', { plate: 'XYZ' }, LOCAL_INSTANCE_ID)).rejects.toThrow(LockedError);
    await expect(updateEntity('vehicle', '1', { plate: 'XYZ' }, LOCAL_INSTANCE_ID)).rejects.toThrow(LockedError);
    await expect(exportLocalData()).rejects.toThrow(LockedError);
    await expect(replaceLocalStores(dump())).rejects.toThrow(LockedError);
  });
});

describe('migrateLocalStoresEncryption', () => {
  it('aborts entirely if a later write fails (no partial commit)', async () => {
    // 1. Setup three unencrypted rows (fail on the SECOND write, not the first).
    for (let i = 0; i < 3; i++) {
      await createEntity('vehicle', { plate: `P${i}` }, LOCAL_INSTANCE_ID);
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const db = await (await import('./indexedDbAdapter')).openLocalDb();

    const txProto = Object.getPrototypeOf(db.transaction('records', 'readwrite'));
    const originalStore = txProto.objectStore;
    let puts = 0;

    vi.spyOn(txProto, 'objectStore').mockImplementation(function (this: unknown, ...args: unknown[]) {
      const name = args[0] as string;
      const store = originalStore.call(this, name);
      if (name === 'records') {
        const origPut = store.put;
        store.put = function (this: unknown, ...args: unknown[]) {
          puts++;
          if (puts === 2) throw new Error('Simulated atomic write failure');
          return origPut.apply(this, args);
        };
      }
      return store;
    });

    // 2. Attempt migration which should throw and abort the whole transaction.
    await expect((await import('./indexedDbAdapter')).migrateLocalStoresEncryption(key)).rejects.toThrow('Simulated atomic write failure');
    vi.restoreAllMocks();

    // 3. No row may be left encrypted: either all or nothing.
    const rows = await db.getAll('records');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.record !== undefined && r.enc === undefined)).toBe(true);

    const list = await listEntities('vehicle', LOCAL_INSTANCE_ID);
    expect(list).toHaveLength(3);
  });
});

describe('IndexedDbAdapter.createIfAbsent + ledger', () => {
  const T1 = '2026-03-01T00:00:00.000Z';
  const T2 = '2026-03-02T00:00:00.000Z';

  it('no sobrescribe un id existente (a diferencia de create)', async () => {
    const adapter = getLocalAdapter();
    expect(await adapter.createIfAbsent('vehicle', rec('race-1', T1, { plate: 'A' }))).toBe(true);
    expect(await adapter.createIfAbsent('vehicle', rec('race-1', T2, { plate: 'B' }))).toBe(false);
    expect((await adapter.get('vehicle', 'race-1', LOCAL_INSTANCE_ID))?.plate).toBe('A');
  });

  it('dos movimientos concurrentes con el mismo id: uno gana y el stock lo refleja', async () => {
    const adapter = getLocalAdapter();
    await adapter.create('inventoryItem', rec('item-race', T1, { quantity: 0 }));

    const results = await Promise.allSettled([
      appendMovement(adapter, LOCAL_INSTANCE_ID, 'item-race', 'purchase', 10, undefined, { id: 'race-id' }),
      appendMovement(adapter, LOCAL_INSTANCE_ID, 'item-race', 'purchase', 99, undefined, { id: 'race-id' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const history = await movementHistory(adapter, LOCAL_INSTANCE_ID, 'item-race');
    expect(history).toHaveLength(1);
    expect(await quantityOf(adapter, LOCAL_INSTANCE_ID, 'item-race')).toBe(Number((history[0] as unknown as DomainRecord).qty));
  });
});

describe('inventario cifrado con protección activa', () => {
  it('los movimientos se guardan cifrados y updateIfCurrent funciona sobre filas cifradas', async () => {
    const adapter = getLocalAdapter();
    await adapter.create('inventoryItem', rec('item-enc', '2026-03-01T00:00:00.000Z', { quantity: 0, name: 'Tornillo' }));
    await enableProtection('pin', '123456');

    const mov = await appendMovement(adapter, LOCAL_INSTANCE_ID, 'item-enc', 'purchase', 10, 'compra');

    // La fila cruda está cifrada: sin `record` en claro.
    const db = await openLocalDb();
    const raw = await db.get('records', ['stockMovement', mov.id]);
    expect(raw?.enc).toBeTypeOf('string');
    expect(raw?.record).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain('compra');

    // updateIfCurrent sobre fila cifrada: descifra, compara versión y re-cifra.
    const before = await adapter.get('inventoryItem', 'item-enc', LOCAL_INSTANCE_ID);
    expect(before?.quantity).toBe(10);
    const updated = await adapter.updateIfCurrent(
      'inventoryItem',
      'item-enc',
      { quantity: 10 },
      LOCAL_INSTANCE_ID,
      String(before!.updated_at),
    );
    expect(updated?.quantity).toBe(10);
    const rawItem = await db.get('records', ['inventoryItem', 'item-enc']);
    expect(rawItem?.enc).toBeTypeOf('string');
    expect(rawItem?.record).toBeUndefined();
    // Versión obsoleta: null sin tocar nada.
    await expect(
      adapter.updateIfCurrent('inventoryItem', 'item-enc', { quantity: 1 }, LOCAL_INSTANCE_ID, '2026-03-01T00:00:00.000Z'),
    ).resolves.toBeNull();

    // Bloqueado: ni el libro ni el CAS pasan.
    lock();
    await expect(movementHistory(adapter, LOCAL_INSTANCE_ID, 'item-enc')).rejects.toThrow(LockedError);
    await expect(
      adapter.updateIfCurrent('inventoryItem', 'item-enc', { quantity: 1 }, LOCAL_INSTANCE_ID, String(updated!.updated_at)),
    ).rejects.toThrow(LockedError);

    // Tras desbloquear, todo legible y el stock cuadra.
    await unlock('pin', '123456');
    expect(await quantityOf(adapter, LOCAL_INSTANCE_ID, 'item-enc')).toBe(10);
    expect((await movementHistory(adapter, LOCAL_INSTANCE_ID, 'item-enc')).map((m) => m.id)).toEqual([mov.id]);
  });
});
