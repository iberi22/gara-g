import { type IDBPDatabase, type DBSchema, openDB } from 'idb';
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

// Coordinación entre operaciones de datos y transiciones de cifrado.
// Las transiciones (activar/desactivar protección) migran TODAS las filas, pero las
// escrituras capturan estado y clave ANTES del cifrado asíncrono. Sin exclusión, una
// escritura en curso puede confirmarse después de la migración y quedar en el modo
// equivocado (fila cifrada con protección "off" y sin sobre). Este candado da acceso
// compartido a las operaciones normales y exclusivo a las transiciones.
let pendingDataOps = 0;
let transitionActive = false;
let transitionTail: Promise<void> = Promise.resolve();
const opWaiters: Array<() => void> = [];
const transitionWaiters: Array<() => void> = [];

function flushWaiters(waiters: Array<() => void>): void {
  for (const waiter of waiters.splice(0)) waiter();
}

async function beginDataOp(): Promise<() => void> {
  while (transitionActive) {
    await new Promise<void>((resolve) => opWaiters.push(resolve));
  }
  pendingDataOps++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingDataOps--;
    if (pendingDataOps === 0) flushWaiters(transitionWaiters);
  };
}

async function beginTransition(): Promise<() => void> {
  // Solo una transición a la vez.
  const previous = transitionTail;
  let releaseTail!: () => void;
  transitionTail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  await previous;

  transitionActive = true;
  while (pendingDataOps > 0) {
    await new Promise<void>((resolve) => transitionWaiters.push(resolve));
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    transitionActive = false;
    releaseTail();
    flushWaiters(opWaiters);
  };
}

// Helpers for read/write interception - state pre-fetched to avoid breaking idb tx
function checkLock(state: LockState) {
  if (state === 'error') {
    throw new LockedError('Estado de protección ilegible: operaciones bloqueadas.');
  }
  if (state === 'locked' || state === 'transition') {
    throw new LockedError('El dispositivo está bloqueado. Desbloquéalo para continuar.');
  }
}

/** Igualdad de la fila cruda almacenada, para detectar cambios concurrentes (comparar y escribir). */
function rowsEqual(a: RecordRow | undefined, b: RecordRow | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.entity !== b.entity || a.id !== b.id) return false;
  if ((a.enc ?? null) !== (b.enc ?? null)) return false;
  if ((a.record ?? null) === null && (b.record ?? null) === null) return true;
  return JSON.stringify(a.record ?? null) === JSON.stringify(b.record ?? null);
}

async function prepareWrite(entity: string, id: string, record: DomainRecord, state: LockState, key: CryptoKey | null): Promise<RecordRow> {
  checkLock(state);
  if (key) {
    const enc = await encryptRecord(entity, id, record, key);
    return { entity, id, enc };
  }
  return { entity, id, record };
}

async function prepareRead(row: RecordRow | undefined, state: LockState, key: CryptoKey | null): Promise<DomainRecord | null> {
  if (!row) return null;
  if (row.enc) {
    checkLock(state);
    if (!key) throw new Error('Se requiere clave activa para leer registro cifrado');
    return decryptRecord(row.entity, row.id, row.enc, key);
  }
  if (row.record) {
    checkLock(state); // Even plaintext rows shouldn't be read while locked
    return row.record;
  }
  return null;
}

export class IndexedDbAdapter implements StorageAdapter {
  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    const release = await beginDataOp();
    try {
      const state = await getLockState();
      checkLock(state);
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
    } finally {
      release();
    }
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    const release = await beginDataOp();
    try {
      const state = await getLockState();
      checkLock(state);
      const key = getActiveKey();

      const db = await openLocalDb();
      const rows = await db.getAllFromIndex('records', 'by-entity', entity);

      // Si hay un registro cifrado pero estamos bloqueados, prepareRead lanzara LockedError.
      const records = await Promise.all(rows.map(r => prepareRead(r, state, key)));
      return records.filter((r): r is DomainRecord => r !== null && r.instance_id === instanceId);
    } finally {
      release();
    }
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const release = await beginDataOp();
    try {
      const state = await getLockState();
      checkLock(state);
      const key = getActiveKey();

      const db = await openLocalDb();
      const row = await db.get('records', [entity, id]);
      const record = await prepareRead(row, state, key);
      if (!record || record.instance_id !== instanceId) return null;
      return record;
    } finally {
      release();
    }
  }

  async update(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
  ): Promise<DomainRecord | null> {
    const release = await beginDataOp();
    try {
      const db = await openLocalDb();
      const MAX_ATTEMPTS = 8;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const state = await getLockState();
        checkLock(state);
        const key = getActiveKey();

        // 1. Leer y descifrar la fila actual.
        const readTx = db.transaction('records', 'readonly');
        const rawRow = await readTx.store.get([entity, id]);
        await readTx.done;

        const record = await prepareRead(rawRow, state, key);
        if (!record || record.instance_id !== instanceId) {
          return null;
        }

        const next = { ...record, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
        const writeRow = await prepareWrite(entity, id, next, state, key);

        // 2. Comparar y escribir en la MISMA transacción: si la fila cambió (o se borró)
        //    desde la lectura, no la pisamos ni la resucitamos; se reintenta con la versión actual.
        const tx = db.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        const current = await store.get([entity, id]);
        if (!current) {
          await tx.done;
          return null; // Se borró durante la actualización: no resucitar.
        }
        if (!rowsEqual(current, rawRow)) {
          await tx.done; // Cambió concurrentemente: reintentar.
          continue;
        }
        await Promise.all([store.put(writeRow), tx.done]);
        notifyChanged();
        return next;
      }

      throw new Error('No se pudo actualizar el registro: demasiadas escrituras concurrentes');
    } finally {
      release();
    }
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const release = await beginDataOp();
    try {
      const state = await getLockState();
      checkLock(state);
      const key = getActiveKey();

      const db = await openLocalDb();
      const readTx = db.transaction('records', 'readonly');
      const rawRow = await readTx.store.get([entity, id]);
      await readTx.done;

      // Allow delete without decrypting? Yes, we just need to ensure it belongs to the instance if possible,
      // but without decryption we can't check instance_id.
      // However, prepareRead will throw if locked.
      const record = await prepareRead(rawRow, state, key);
      if (!record || record.instance_id !== instanceId) {
        return false;
      }

      const tx = db.transaction(['records', 'tombstones'], 'readwrite');
      await Promise.all([
        tx.objectStore('records').delete([entity, id]),
        tx.objectStore('tombstones').put({ entity, id, deletedAt: new Date().toISOString() }),
        tx.done,
      ]);
      notifyChanged();
      return true;
    } finally {
      release();
    }
  }
}

/** Registros y lapidas del tenant local, agrupados por entidad (insumo de `exportLocalData`). */
export async function readLocalStores(): Promise<Pick<LocalDump, 'entities' | 'deleted'>> {
  const release = await beginDataOp();
  try {
    const state = await getLockState();
    checkLock(state);
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
  } finally {
    release();
  }
}

/** Reemplaza TODO el contenido en una sola transaccion (si algo falla, no queda nada a medias). */
export async function replaceLocalStores(data: Pick<LocalDump, 'entities' | 'deleted'>): Promise<void> {
  const release = await beginDataOp();
  try {
    const state = await getLockState();
    checkLock(state);
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
  } finally {
    release();
  }
}

/** Migrate all rows to encrypted (if key is provided) or plaintext (if key is null). */
export async function migrateLocalStoresEncryption(key: CryptoKey | null): Promise<void> {
  // Exclusivo frente a cualquier operación de datos en curso o posterior.
  const release = await beginTransition();
  let ok = false;
  try {
    const db = await openLocalDb();
    const rows = await db.getAll('records');

    // Prepare all new rows outside the transaction because crypto is async
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
          newRows.push({ entity: row.entity, id: row.id, enc, record: undefined });
        } else {
          newRows.push({ entity: row.entity, id: row.id, record: plain, enc: undefined });
        }
      }
    }

    if (newRows.length > 0) {
      // Write phase: a single transaction. If ANY preparation or write fails we abort
      // explicitly, so a synchronous throw from put() cannot leave a partial commit.
      const tx = db.transaction('records', 'readwrite');
      try {
        const store = tx.objectStore('records');
        const writes: Promise<unknown>[] = [];
        for (const newRow of newRows) {
          const current = await store.get([newRow.entity, newRow.id]);
          const previous = rows.find((r) => r.entity === newRow.entity && r.id === newRow.id);

          // Only overwrite while the row is still the one we read during preparation:
          // a row deleted or changed concurrently is skipped, never resurrected.
          if (!current || !rowsEqual(current, previous)) continue;

          // Solo claves definidas: un `enc` o `record` undefined no debe persistirse literal.
          const toPut: RecordRow = { entity: newRow.entity, id: newRow.id };
          if (newRow.enc !== undefined) toPut.enc = newRow.enc;
          if (newRow.record !== undefined) toPut.record = newRow.record;
          writes.push(store.put(toPut));
        }
        await Promise.all([...writes, tx.done]);
        ok = true;
      } catch (err) {
        try {
          tx.abort();
        } catch {
          /* la transacción ya pudo terminar */
        }
        await tx.done.catch(() => undefined);
        throw err;
      }
    } else {
      ok = true;
    }
  } finally {
    release();
  }
  if (ok) notifyChanged();
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
