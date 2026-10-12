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
 *   - `records`: clave [entity, id], valor { entity, id, record }, indice `by-entity`.
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

export const LOCAL_DB_NAME = 'gara-local';
export const LOCAL_DB_VERSION = 1;

interface RecordRow {
  entity: string;
  id: string;
  record: DomainRecord;
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

export class IndexedDbAdapter implements StorageAdapter {
  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    const db = await openLocalDb();
    const tx = db.transaction(['records', 'tombstones'], 'readwrite');
    await Promise.all([
      tx.objectStore('records').put({ entity, id: record.id, record }),
      // Un id que se vuelve a crear deja de estar borrado.
      tx.objectStore('tombstones').delete([entity, record.id]),
      tx.done,
    ]);
    notifyChanged();
    return record;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    const db = await openLocalDb();
    const rows = await db.getAllFromIndex('records', 'by-entity', entity);
    return rows.map((r) => r.record).filter((r) => r.instance_id === instanceId);
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const db = await openLocalDb();
    const row = await db.get('records', [entity, id]);
    if (!row || row.record.instance_id !== instanceId) return null;
    return row.record;
  }

  async update(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
  ): Promise<DomainRecord | null> {
    const db = await openLocalDb();
    const tx = db.transaction('records', 'readwrite');
    const row = await tx.store.get([entity, id]);
    if (!row || row.record.instance_id !== instanceId) {
      await tx.done;
      return null;
    }
    const next = { ...row.record, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
    await Promise.all([tx.store.put({ entity, id, record: next }), tx.done]);
    notifyChanged();
    return next;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const db = await openLocalDb();
    const tx = db.transaction(['records', 'tombstones'], 'readwrite');
    const row = await tx.objectStore('records').get([entity, id]);
    if (!row || row.record.instance_id !== instanceId) {
      await tx.done;
      return false;
    }
    await Promise.all([
      tx.objectStore('records').delete([entity, id]),
      tx.objectStore('tombstones').put({ entity, id, deletedAt: new Date().toISOString() }),
      tx.done,
    ]);
    notifyChanged();
    return true;
  }
}

/** Registros y lapidas del tenant local, agrupados por entidad (insumo de `exportLocalData`). */
export async function readLocalStores(): Promise<Pick<LocalDump, 'entities' | 'deleted'>> {
  const db = await openLocalDb();
  const [records, tombstones] = await Promise.all([db.getAll('records'), db.getAll('tombstones')]);
  const entities: Record<string, DomainRecord[]> = {};
  for (const r of records) {
    if (r.record.instance_id !== LOCAL_INSTANCE_ID) continue;
    (entities[r.entity] ??= []).push(r.record);
  }
  const deleted: Record<string, LocalTombstone[]> = {};
  for (const t of tombstones) (deleted[t.entity] ??= []).push({ id: t.id, deletedAt: t.deletedAt });
  return { entities, deleted };
}

/** Reemplaza TODO el contenido en una sola transaccion (si algo falla, no queda nada a medias). */
export async function replaceLocalStores(data: Pick<LocalDump, 'entities' | 'deleted'>): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(['records', 'tombstones'], 'readwrite');
  const records = tx.objectStore('records');
  const tombstones = tx.objectStore('tombstones');
  const writes: Promise<unknown>[] = [records.clear(), tombstones.clear()];
  for (const [entity, list] of Object.entries(data.entities)) {
    for (const record of list) {
      writes.push(
        records.put({ entity, id: record.id, record: { ...record, instance_id: LOCAL_INSTANCE_ID } }),
      );
    }
  }
  for (const [entity, list] of Object.entries(data.deleted)) {
    for (const t of list) writes.push(tombstones.put({ entity, id: t.id, deletedAt: t.deletedAt }));
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
