/**
 * src/lib/local/indexedDbAdapter.ts — Almacen local (modo sin cuenta): `StorageAdapter` de
 * domain.ts sobre IndexedDB, para que `createEntity`, `listEntities` y `buildGarageSnapshot`
 * funcionen en el navegador sin D1.
 *
 * SOLO NAVEGADOR. Importa `idb`, que no puede entrar al bundle SSR: quien lo use desde un
 * componente o desde otro modulo debe cargarlo con `await import('./indexedDbAdapter')`
 * dentro de codigo que solo corre en el cliente (ver `getLocalAdapter`).
 *
 * Base `gara-local` v1:
 *   - `records`: clave [entity, id], valor { entity, id, record } o { entity, id, enc }, indice `by-entity`.
 *   - `tombstones`: clave [entity, id], valor { entity, id, deletedAt } (lapidas de borrado,
 *     para que una fusion con otro dispositivo no resucite lo que el usuario elimino).
 *
 * domain.ts ya rellena `instance_id`, `created_at` y `updated_at` en `createEntity` (el adapter
 * recibe el registro completo) y el adapter solo renueva `updated_at` en `update`, igual que
 * el de memoria y el de D1. Tras cada escritura emite LOCAL_CHANGED_EVENT.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { LOCAL_CHANGED_EVENT, LOCAL_INSTANCE_ID } from '../appMode';
import type { DomainRecord, StorageAdapter } from '../domain';
import type { LocalDump, LocalTombstone } from './types';
import { encryptRecord, decryptRecord, LockedError } from './recordCrypto';
import { getLockState, getActiveKey, type LockState } from './deviceLock';

export const LOCAL_DB_NAME = 'gara-local';
export const LOCAL_DB_VERSION = 1;

interface RecordRow {
  entity: string;
  id: string;
  record?: DomainRecord; // plain
  enc?: string;          // encrypted
}

interface TombstoneRow {
  entity: string;
  id: string;
  deletedAt: string;
}

interface LocalSchema extends DBSchema {
  records: {
    key: [string, string];
    value: RecordRow;
    indexes: { 'by-entity': string };
  };
  tombstones: {
    key: [string, string];
    value: TombstoneRow;
  };
}

type LocalDb = IDBPDatabase<LocalSchema>;

let dbPromise: Promise<LocalDb> | null = null;

/** Conexion unica a la base local (la abre la primera vez que se pide). */
export function openLocalDb(): Promise<LocalDb> {
  if (!dbPromise) {
    dbPromise = openDB<LocalSchema>(LOCAL_DB_NAME, LOCAL_DB_VERSION, {
      upgrade(db) {
        const records = db.createObjectStore('records', { keyPath: ['entity', 'id'] });
        records.createIndex('by-entity', 'entity');
        db.createObjectStore('tombstones', { keyPath: ['entity', 'id'] });
      },
      terminated() {
        dbPromise = null;
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Cierra la conexion cacheada (tests, o antes de borrar la base). */
export async function closeLocalDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_CHANGED_EVENT));
}

// Helpers for read/write interception - state pre-fetched to avoid breaking idb tx
async function prepareWrite(entity: string, id: string, record: DomainRecord, state: LockState, key: CryptoKey | null): Promise<RecordRow> {
  if (state === 'locked') throw new LockedError();
  if (key) {
    const enc = await encryptRecord(entity, id, record, key);
    return { entity, id, enc };
  }
  return { entity, id, record };
}

async function prepareRead(row: RecordRow | undefined, state: LockState, key: CryptoKey | null): Promise<DomainRecord | null> {
  if (!row) return null;
  if (row.enc) {
    if (state === 'locked') throw new LockedError();
    if (!key) throw new Error('Se requiere clave activa para leer registro cifrado');
    return decryptRecord(row.entity, row.id, row.enc, key);
  }
  if (row.record) {
    return row.record;
  }
  return null;
}

export class IndexedDbAdapter implements StorageAdapter {
  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    const state = await getLockState();
    const key = getActiveKey();
    const row = await prepareWrite(entity, record.id, record, state, key);

    const db = await openLocalDb();
    const tx = db.transaction(['records', 'tombstones'], 'readwrite');
    await Promise.all([
      tx.objectStore('records').put(row),
      // Un id que se vuelve a crear deja de estar borrado.
      tx.objectStore('tombstones').delete([entity, record.id]),
      tx.done,
    ]);
    notifyChanged();
    return record;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    const state = await getLockState();
    const key = getActiveKey();

    const db = await openLocalDb();
    const rows = await db.getAllFromIndex('records', 'by-entity', entity);

    // Si hay un registro cifrado pero estamos bloqueados, prepareRead lanzara LockedError.
    const records = await Promise.all(rows.map(r => prepareRead(r, state, key)));
    return records.filter((r): r is DomainRecord => r !== null && r.instance_id === instanceId);
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const state = await getLockState();
    const key = getActiveKey();

    const db = await openLocalDb();
    const row = await db.get('records', [entity, id]);
    const record = await prepareRead(row, state, key);
    if (!record || record.instance_id !== instanceId) return null;
    return record;
  }

  async update(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
  ): Promise<DomainRecord | null> {
    const state = await getLockState();
    const key = getActiveKey();

    const db = await openLocalDb();
    let rawRow: RecordRow | undefined;
    {
      const tx = db.transaction('records', 'readonly');
      rawRow = await tx.store.get([entity, id]);
    }

    const record = await prepareRead(rawRow, state, key);
    if (!record || record.instance_id !== instanceId) {
      return null;
    }

    const next = { ...record, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
    const writeRow = await prepareWrite(entity, id, next, state, key);

    {
      const tx = db.transaction('records', 'readwrite');
      await Promise.all([tx.store.put(writeRow), tx.done]);
    }
    notifyChanged();
    return next;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const state = await getLockState();
    const key = getActiveKey();

    const db = await openLocalDb();
    let rawRow: RecordRow | undefined;
    {
      const tx = db.transaction('records', 'readonly');
      rawRow = await tx.store.get([entity, id]);
    }

    // Allow delete without decrypting? Yes, we just need to ensure it belongs to the instance if possible,
    // but without decryption we can't check instance_id.
    // However, prepareRead will throw if locked.
    const record = await prepareRead(rawRow, state, key);
    if (!record || record.instance_id !== instanceId) {
      return false;
    }

    {
      const tx = db.transaction(['records', 'tombstones'], 'readwrite');
      await Promise.all([
        tx.objectStore('records').delete([entity, id]),
        tx.objectStore('tombstones').put({ entity, id, deletedAt: new Date().toISOString() }),
        tx.done,
      ]);
    }
    notifyChanged();
    return true;
  }
}

/** Registros y lapidas del tenant local, agrupados por entidad (insumo de `exportLocalData`). */
export async function readLocalStores(): Promise<Pick<LocalDump, 'entities' | 'deleted'>> {
  const state = await getLockState();
  const key = getActiveKey();

  const db = await openLocalDb();
  const [rows, tombstones] = await Promise.all([db.getAll('records'), db.getAll('tombstones')]);
  const entities: Record<string, DomainRecord[]> = {};
  for (const raw of rows) {
    const record = await prepareRead(raw, state, key);
    if (!record || record.instance_id !== LOCAL_INSTANCE_ID) continue;
    (entities[raw.entity] ??= []).push(record);
  }
  const deleted: Record<string, LocalTombstone[]> = {};
  for (const t of tombstones) (deleted[t.entity] ??= []).push({ id: t.id, deletedAt: t.deletedAt });
  return { entities, deleted };
}

/** Reemplaza TODO el contenido en una sola transaccion (si algo falla, no queda nada a medias). */
export async function replaceLocalStores(data: Pick<LocalDump, 'entities' | 'deleted'>): Promise<void> {
  const state = await getLockState();
  const key = getActiveKey();

  // Validate write possible before starting TX
  const rowWrites: RecordRow[] = [];
  for (const [entity, list] of Object.entries(data.entities)) {
    for (const record of list) {
      const row = await prepareWrite(entity, record.id, { ...record, instance_id: LOCAL_INSTANCE_ID }, state, key);
      rowWrites.push(row);
    }
  }

  const db = await openLocalDb();
  const tx = db.transaction(['records', 'tombstones'], 'readwrite');
  const records = tx.objectStore('records');
  const tombstones = tx.objectStore('tombstones');
  const writes: Promise<unknown>[] = [records.clear(), tombstones.clear()];

  for (const row of rowWrites) {
    writes.push(records.put(row));
  }
  for (const [entity, list] of Object.entries(data.deleted)) {
    for (const t of list) writes.push(tombstones.put({ entity, id: t.id, deletedAt: t.deletedAt }));
  }
  await Promise.all([...writes, tx.done]);
  notifyChanged();
}

/** Migrate all rows to encrypted (if key is provided) or plaintext (if key is null). */
export async function migrateLocalStoresEncryption(key: CryptoKey | null): Promise<void> {
  const db = await openLocalDb();
  const rows = await db.getAll('records');

  // Prepare all new rows before opening transaction to ensure atomicity of the actual write phase
  const newRows: RecordRow[] = [];
  for (const row of rows) {
    let plain: DomainRecord | null = null;
    if (row.enc) {
      if (!getActiveKey() && !key) throw new Error('Se requiere clave para descifrar durante migración');
      const k = key || getActiveKey();
      plain = await decryptRecord(row.entity, row.id, row.enc, k!);
    } else if (row.record) {
      plain = row.record;
    }

    if (plain) {
      if (key) {
        const enc = await encryptRecord(row.entity, row.id, plain, key);
        newRows.push({ entity: row.entity, id: row.id, enc });
      } else {
        newRows.push({ entity: row.entity, id: row.id, record: plain });
      }
    }
  }

  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');

  const writes: Promise<unknown>[] = [];
  for (const row of newRows) {
    writes.push(store.put(row));
  }
  await Promise.all([...writes, tx.done]);
  notifyChanged();
}

let shared: IndexedDbAdapter | null = null;

/**
 * Adapter compartido para `setStorageAdapter`. Se llama una sola vez, en el navegador, desde
 * codigo que haya cargado este modulo con import dinamico.
 */
export function getLocalAdapter(): IndexedDbAdapter {
  shared ??= new IndexedDbAdapter();
  return shared;
}
