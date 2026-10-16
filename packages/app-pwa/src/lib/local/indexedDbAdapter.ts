import { type IDBPDatabase, type DBSchema, openDB } from 'idb';
import { LOCAL_CHANGED_EVENT, LOCAL_INSTANCE_ID } from '../appMode';
import type { DomainRecord, StorageAdapter } from '../domain';
import type { LocalDump, LocalTombstone } from './types';
import { encryptRecord, decryptRecord, LockedError } from './recordCrypto';
import {
  takeTicket,
  verifyTicket,
  waitForSettledState,
  isLockRetryable,
  getActiveKey,
  StaleTicketError,
  type WriteTicket,
} from './deviceLock';
import { beginDataOp, beginTransition } from './opGate';

export const LOCAL_DB_NAME = 'gara-local';
export const LOCAL_DB_VERSION = 1;

interface RecordRow {
  entity: string;
  id: string;
  record?: DomainRecord; // plain
  enc?: string; // encrypted
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

/** Intentos máximos del bucle foto-cifrar-verificar-escribir. */
const MAX_TICKET_ATTEMPTS = 12;

async function prepareWrite(
  entity: string,
  id: string,
  record: DomainRecord,
  ticket: WriteTicket
): Promise<RecordRow> {
  if (ticket.active && ticket.key) {
    const enc = await encryptRecord(entity, id, record, ticket.key);
    return { entity, id, enc };
  }
  return { entity, id, record };
}

async function prepareRead(row: RecordRow | undefined, ticket: WriteTicket): Promise<DomainRecord | null> {
  if (!row) return null;
  if (row.enc) {
    // Fila cifrada pero la foto no tiene clave: las filas son más nuevas que la
    // foto (o viceversa). Reintentar con una foto nueva en vez de fallar.
    if (!ticket.active || !ticket.key) {
      throw new StaleTicketError();
    }
    try {
      return await decryptRecord(row.entity, row.id, row.enc, ticket.key);
    } catch {
      throw new StaleTicketError('No se pudo descifrar; la protección pudo cambiar.');
    }
  }
  return row.record ?? null;
}

/** Bucle genérico foto → puerta compartida → verificar → confirmar. */
async function withVerifiedTicket<T>(fn: (ticket: WriteTicket) => Promise<T>): Promise<T> {
  let last: unknown = new Error('No se pudo completar la operación');
  for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
    const ticket = await takeTicket();
    const release = await beginDataOp();
    try {
      await verifyTicket(ticket);
      // fn() debe revalidar el ticket después del cifrado asíncrono y antes
      // de confirmar su transacción (ver create/replace/update/del).
      return await fn(ticket);
    } catch (err) {
      if (!isLockRetryable(err)) throw err;
      last = err;
    } finally {
      release();
    }
    await waitForSettledState();
  }
  throw last;
}

/** Igualdad de la fila cruda almacenada, para detectar cambios concurrentes (comparar y escribir). */
function rowsEqual(a: RecordRow | undefined, b: RecordRow | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.entity !== b.entity || a.id !== b.id) return false;
  if ((a.enc ?? null) !== (b.enc ?? null)) return false;
  if ((a.record ?? null) === null && (b.record ?? null) === null) return true;
  return JSON.stringify(a.record ?? null) === JSON.stringify(b.record ?? null);
}

export class IndexedDbAdapter implements StorageAdapter {
  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    const out = await withVerifiedTicket(async (ticket) => {
      const row = await prepareWrite(entity, record.id, record, ticket);
      await verifyTicket(ticket);

      const db = await openLocalDb();
      const tx = db.transaction(['records', 'tombstones'], 'readwrite');
      await Promise.all([
        tx.objectStore('records').put(row),
        // Un id que se vuelve a crear deja de estar borrado.
        tx.objectStore('tombstones').delete([entity, record.id]),
        tx.done,
      ]);
      return record;
    });
    notifyChanged();
    return out;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    let last: unknown = new Error('No se pudo leer');
    for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
      const ticket = await takeTicket();
      const release = await beginDataOp();
      try {
        const db = await openLocalDb();
        const rows = await db.getAllFromIndex('records', 'by-entity', entity);
        await verifyTicket(ticket);

        // Si hay un registro cifrado pero estamos bloqueados, prepareRead lanzara reintento o LockedError.
        const records = await Promise.all(rows.map((r) => prepareRead(r, ticket)));
        return records.filter((r): r is DomainRecord => r !== null && r.instance_id === instanceId);
      } catch (err) {
        if (!isLockRetryable(err)) throw err;
        last = err;
      } finally {
        release();
      }
      await waitForSettledState();
    }
    throw last;
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    let last: unknown = new Error('No se pudo leer');
    for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
      const ticket = await takeTicket();
      const release = await beginDataOp();
      try {
        const db = await openLocalDb();
        const row = await db.get('records', [entity, id]);
        await verifyTicket(ticket);
        const record = await prepareRead(row, ticket);
        if (!record || record.instance_id !== instanceId) return null;
        return record;
      } catch (err) {
        if (!isLockRetryable(err)) throw err;
        last = err;
      } finally {
        release();
      }
      await waitForSettledState();
    }
    throw last;
  }

  async update(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string
  ): Promise<DomainRecord | null> {
    let last: unknown = new Error('No se pudo actualizar el registro: demasiadas escrituras concurrentes');
    for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
      const ticket = await takeTicket();
      const release = await beginDataOp();
      try {
        const db = await openLocalDb();

        // 1. Leer y descifrar la fila actual.
        const readTx = db.transaction('records', 'readonly');
        const rawRow = await readTx.store.get([entity, id]);
        await readTx.done;
        await verifyTicket(ticket);

        const record = await prepareRead(rawRow, ticket);
        if (!record || record.instance_id !== instanceId) {
          return null;
        }

        const next = { ...record, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
        const writeRow = await prepareWrite(entity, id, next, ticket);
        await verifyTicket(ticket);

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
      } catch (err) {
        if (!isLockRetryable(err)) throw err;
        last = err;
      } finally {
        release();
      }
      await waitForSettledState();
    }

    throw last;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    let last: unknown = new Error('No se pudo borrar');
    for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
      const ticket = await takeTicket();
      const release = await beginDataOp();
      try {
        const db = await openLocalDb();
        const readTx = db.transaction('records', 'readonly');
        const rawRow = await readTx.store.get([entity, id]);
        await readTx.done;
        await verifyTicket(ticket);

        // Allow delete without decrypting? Yes, we just need to ensure it belongs to the instance if possible,
        // but without decryption we can't check instance_id.
        const record = await prepareRead(rawRow, ticket);
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
      } catch (err) {
        if (!isLockRetryable(err)) throw err;
        last = err;
      } finally {
        release();
      }
      await waitForSettledState();
    }
    throw last;
  }
}

/** Registros y lapidas del tenant local, agrupados por entidad (insumo de `exportLocalData`). */
export async function readLocalStores(): Promise<Pick<LocalDump, 'entities' | 'deleted'>> {
  let last: unknown = new Error('No se pudo leer');
  for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
    const ticket = await takeTicket();
    const release = await beginDataOp();
    try {
      const db = await openLocalDb();
      const [rows, tombstones] = await Promise.all([db.getAll('records'), db.getAll('tombstones')]);
      await verifyTicket(ticket);
      const entities: Record<string, DomainRecord[]> = {};
      for (const raw of rows) {
        const record = await prepareRead(raw, ticket);
        if (!record || record.instance_id !== LOCAL_INSTANCE_ID) continue;
        (entities[raw.entity] ??= []).push(record);
      }
      const deleted: Record<string, LocalTombstone[]> = {};
      for (const t of tombstones) (deleted[t.entity] ??= []).push({ id: t.id, deletedAt: t.deletedAt });
      return { entities, deleted };
    } catch (err) {
      if (!isLockRetryable(err)) throw err;
      last = err;
    } finally {
      release();
    }
    await waitForSettledState();
  }
  throw last;
}

/** Reemplaza TODO el contenido en una sola transaccion (si algo falla, no queda nada a medias). */
export async function replaceLocalStores(data: Pick<LocalDump, 'entities' | 'deleted'>): Promise<void> {
  await withVerifiedTicket(async (ticket) => {
    // Validate write possible before starting TX
    const rowWrites: RecordRow[] = [];
    for (const [entity, list] of Object.entries(data.entities)) {
      for (const record of list) {
        const row = await prepareWrite(entity, record.id, { ...record, instance_id: LOCAL_INSTANCE_ID }, ticket);
        rowWrites.push(row);
      }
    }
    await verifyTicket(ticket);

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
  });
  notifyChanged();
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
        const k = key || getActiveKey();
        if (!k) throw new Error('Se requiere clave para descifrar durante migración');
        plain = await decryptRecord(row.entity, row.id, row.enc, k);
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

// Re-exportado para compatibilidad: la puerta vive en opGate.ts para que el
// almacén de identidad use exactamente la misma.
export { beginDataOp, beginTransition } from './opGate';

// Mantener el error de candado accesible desde este módulo.
export { LockedError };
