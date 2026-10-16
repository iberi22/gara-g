// domain.ts — helpers CRUD genericos para entities de domain.config.ts
// instance_id isolation GOAL #4/5: toda fila lleva instance_id, todo query filtra por el.
// Storage adapters: Memory (tests) -> D1 (Workers.prod).
// El modelo de negocio no habla a Surreal directo — pasa por estos helpers.

import { domainConfig } from './domain.config';

// Tipado generico por entity name
export type EntityName = (typeof domainConfig.entities)[number]['name'];
export type EntityDef = (typeof domainConfig.entities)[number];

// Record base que siempre lleva D1 id + instance isolation
export type DomainRecord<T = Record<string, unknown>> = T & {
  id: string;
  instance_id: string;
  created_at: string;
  updated_at: string;
};

// --- Adapter interface ---

export interface StorageAdapter {
  create(entity: string, record: DomainRecord): Promise<DomainRecord>;
  /**
   * Inserta solo si el id no existe: `true` si creo el registro, `false` si ya estaba.
   * A diferencia de `create` (que es un upsert), nunca sobrescribe. Los adapters
   * que pueden tener escrituras concurrentes (IndexedDB `put`, D1) lo implementan
   * de forma atomica; el resto queda serializado por el llamador.
   */
  createIfAbsent?(entity: string, record: DomainRecord): Promise<boolean>;
  /**
   * Escritura condicional: aplica el patch solo si `updated_at` sigue siendo
   * `expectedUpdatedAt`. Devuelve el registro o `null` si otro escritor se
   * adelanto (el llamador relee y reintenta). Atomico en los tres adapters
   * (misma transaccion / unico UPDATE condicional). El sello es estrictamente
   * monotono (ver `nextUpdatedAt`) para que el compare-and-set no tenga falsos
   * positivos dentro del mismo milisegundo.
   */
  updateIfCurrent?(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
    expectedUpdatedAt: string,
  ): Promise<DomainRecord | null>;
  list(entity: string, instanceId: string): Promise<DomainRecord[]>;
  get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null>;
  update(entity: string, id: string, patch: Record<string, unknown>, instanceId: string): Promise<DomainRecord | null>;
  del(entity: string, id: string, instanceId: string): Promise<boolean>;
}

// Sello `updated_at` estrictamente monotono: si `previous` no es anterior a
// "ahora", avanza 1ms para que dos escrituras nunca compartan sello y el
// compare-and-set (`updateIfCurrent`) no confunda una escritura ajena con la
// version esperada. Las cadenas ISO-8601 del mismo formato ordenan
// lexicograficamente igual que cronologicamente.
export function nextUpdatedAt(previous?: string): string {
  const now = new Date().toISOString();
  if (typeof previous === 'string' && previous !== '' && previous >= now) {
    return new Date(Date.parse(previous) + 1).toISOString();
  }
  return now;
}

// Memory adapter — usado en tests y como fallback si no hay D1
class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, Map<string, DomainRecord>>(); // entity -> id -> record

  private key(entity: string): Map<string, DomainRecord> {
    if (!this.store.has(entity)) this.store.set(entity, new Map());
    return this.store.get(entity)!;
  }

  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    this.key(entity).set(record.id, record);
    return record;
  }
  async createIfAbsent(entity: string, record: DomainRecord): Promise<boolean> {
    const bucket = this.key(entity);
    if (bucket.has(record.id)) return false;
    bucket.set(record.id, record);
    return true;
  }
  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    return [...this.key(entity).values()].filter((r) => r.instance_id === instanceId);
  }
  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const r = this.key(entity).get(id) ?? null;
    if (r && r.instance_id !== instanceId) return null;
    return r;
  }
  async update(entity: string, id: string, patch: Record<string, unknown>, instanceId: string): Promise<DomainRecord | null> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur) return null;
    const next = { ...cur, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
    this.key(entity).set(id, next);
    return next;
  }
  async updateIfCurrent(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
    expectedUpdatedAt: string,
  ): Promise<DomainRecord | null> {
    // Sin `await` entre la lectura y la escritura: atomico en este contexto.
    const cur = this.key(entity).get(id) ?? null;
    if (!cur || cur.instance_id !== instanceId || cur.updated_at !== expectedUpdatedAt) return null;
    const next = { ...cur, ...patch, updated_at: nextUpdatedAt(cur.updated_at) } as DomainRecord;
    this.key(entity).set(id, next);
    return next;
  }
  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur) return false;
    this.key(entity).delete(id);
    return true;
  }
  // para tests: clear
  clear() {
    this.store.clear();
  }
}

// Singleton memory — cada instancia de app tiene su propio adapter en memoria (aislado por instance_id de todos modos)
const memory = new MemoryAdapter();

// Selector: en prod Workers usa D1, en tests usa memory
// Llamar initD1Adapter(env.SWAL_D1) en middleware/SSR para swap
let adapter: StorageAdapter = memory;

export function setStorageAdapter(a: StorageAdapter) {
  adapter = a;
}
export function getStorageAdapter(): StorageAdapter {
  return adapter;
}
export function getMemoryAdapter(): MemoryAdapter {
  return memory;
}

// --- Helpers genericos ---

function resolveInstanceId(instanceId?: string): string {
  return (instanceId ?? (domainConfig.instanceId as string)) as string;
}

function assertEntity(entity: string) {
  const ok = domainConfig.entities.some((e) => e.name === entity);
  if (!ok) throw new Error(`Entity no whitelisteada en domain.config: ${entity}. Define entities[] primero.`);
}

function genId(): string {
  // nanoid-like simple (no dep extra)
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Genera DEFINE TABLE SurrealDB para docs/migraciones (no ejecuta, solo string)
export function surrealDefineTable(entity: string): string {
  assertEntity(entity);
  const def = domainConfig.entities.find((e: any) => e.name === entity)!;
  const fields = def.fields.map((f: string) => `DEFINE FIELD ${f} ON ${entity} TYPE string;`).join('\n');
  return [
    `DEFINE TABLE ${entity} SCHEMAFULL;`,
    `DEFINE FIELD instance_id ON ${entity} TYPE string;`,
    `DEFINE FIELD created_at ON ${entity} TYPE datetime;`,
    `DEFINE FIELD updated_at ON ${entity} TYPE datetime;`,
    `DEFINE INDEX ${entity}_instance_idx ON ${entity} FIELDS instance_id;`,
    fields,
  ].join('\n');
}

export async function createEntity<T extends Record<string, unknown>>(
  entity: EntityName,
  data: T,
  instanceId?: string,
  /** Id fijo, solo para registros con clave natural (p. ej. una preferencia por usuario). Nunca viene del cliente. */
  opts?: { id?: string },
): Promise<DomainRecord<T>> {
  assertEntity(entity as string);
  const iid = resolveInstanceId(instanceId);
  const now = new Date().toISOString();
  const record = { ...data, id: opts?.id ?? genId(), instance_id: iid, created_at: now, updated_at: now } as DomainRecord<T>;
  return (await adapter.create(entity as string, record as unknown as DomainRecord)) as DomainRecord<T>;
}

export async function listEntities<T = Record<string, unknown>>(
  entity: EntityName,
  instanceId?: string,
): Promise<DomainRecord<T>[]> {
  assertEntity(entity as string);
  const iid = resolveInstanceId(instanceId);
  return (await adapter.list(entity as string, iid)) as DomainRecord<T>[];
}

export async function getEntity<T = Record<string, unknown>>(
  entity: EntityName,
  id: string,
  instanceId?: string,
): Promise<DomainRecord<T> | null> {
  assertEntity(entity as string);
  const iid = resolveInstanceId(instanceId);
  return (await adapter.get(entity as string, id, iid)) as DomainRecord<T> | null;
}

export async function updateEntity<T extends Record<string, unknown>>(
  entity: EntityName,
  id: string,
  patch: Partial<T>,
  instanceId?: string,
): Promise<DomainRecord<T> | null> {
  assertEntity(entity as string);
  const iid = resolveInstanceId(instanceId);
  return (await adapter.update(entity as string, id, patch as Record<string, unknown>, iid)) as DomainRecord<T> | null;
}

export async function deleteEntity(entity: EntityName, id: string, instanceId?: string): Promise<boolean> {
  assertEntity(entity as string);
  const iid = resolveInstanceId(instanceId);
  return adapter.del(entity as string, id, iid);
}

// --- D1 Adapter (Cloudflare Workers runtime) ---

type D1Row = {
  instance_id: string;
  entity: string;
  id: string;
  data: string;
  created_at: string;
  updated_at: string;
};

/**
 * D1Adapter — conecta GARA-G al D1 real en Cloudflare Workers.
 * Implementa StorageAdapter: CRUD sobre tabla `entity` (instance_id, entity, id, data JSON).
 *
 * Usage en SSR (Astro API routes / middleware):
 *   import { initD1Adapter } from './domain.js';
 *   const d1 = runtime.env.SWAL_D1 as D1Database;
 *   initD1Adapter(d1);
 *
 * Tests vitest: sigue usando MemoryAdapter (initD1Adapter solo se llama en runtime Workers).
 */
export class D1Adapter implements StorageAdapter {
  constructor(private d1: D1Database) {}

  private serialize(record: DomainRecord): string {
    // Strip domain meta fields before storing (id, instance_id, created_at, updated_at stay in row columns)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, instance_id: _iid, created_at: _ca, updated_at: _ua, ...data } = record;
    return JSON.stringify(data);
  }

  private deserialize(row: D1Row): DomainRecord {
    return {
      ...JSON.parse(row.data),
      id: row.id,
      instance_id: row.instance_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    } as DomainRecord;
  }

  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    const { id, instance_id, created_at, updated_at } = record;
    const data = this.serialize(record);
    await this.d1
      .prepare('INSERT INTO entity (instance_id, entity, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(instance_id, entity, id, data, created_at, updated_at)
      .run();
    return record;
  }

  async createIfAbsent(entity: string, record: DomainRecord): Promise<boolean> {
    const { id, instance_id, created_at, updated_at } = record;
    const data = this.serialize(record);
    // INSERT OR IGNORE: si la clave (instance_id, entity, id) ya existe no toca la fila.
    const result = await this.d1
      .prepare('INSERT OR IGNORE INTO entity (instance_id, entity, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(instance_id, entity, id, data, created_at, updated_at)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    const result = await this.d1
      .prepare('SELECT instance_id, entity, id, data, created_at, updated_at FROM entity WHERE instance_id = ? AND entity = ? ORDER BY updated_at DESC')
      .bind(instanceId, entity)
      .all<D1Row>();
    return (result.results ?? []).map((row) => this.deserialize(row));
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const result = await this.d1
      .prepare('SELECT instance_id, entity, id, data, created_at, updated_at FROM entity WHERE instance_id = ? AND entity = ? AND id = ?')
      .bind(instanceId, entity, id)
      .first<D1Row>();
    if (!result) return null;
    if (result.instance_id !== instanceId) return null;
    return this.deserialize(result);
  }

  async update(entity: string, id: string, patch: Record<string, unknown>, instanceId: string): Promise<DomainRecord | null> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur) return null;
    const next: DomainRecord = { ...cur, ...patch, updated_at: new Date().toISOString() };
    const dataJson = this.serialize(next);
    await this.d1
      .prepare('UPDATE entity SET data = ?, updated_at = ? WHERE instance_id = ? AND entity = ? AND id = ?')
      .bind(dataJson, next.updated_at, instanceId, entity, id)
      .run();
    return next;
  }

  async updateIfCurrent(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
    expectedUpdatedAt: string,
  ): Promise<DomainRecord | null> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur || cur.updated_at !== expectedUpdatedAt) return null;
    const next: DomainRecord = { ...cur, ...patch, updated_at: nextUpdatedAt(cur.updated_at) };
    const dataJson = this.serialize(next);
    // Unico UPDATE condicional: atomico aunque dos workers escriban a la vez.
    const result = await this.d1
      .prepare('UPDATE entity SET data = ?, updated_at = ? WHERE instance_id = ? AND entity = ? AND id = ? AND updated_at = ?')
      .bind(dataJson, next.updated_at, instanceId, entity, id, expectedUpdatedAt)
      .run();
    if ((result.meta?.changes ?? 0) === 0) return null;
    return next;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const result = await this.d1
      .prepare('DELETE FROM entity WHERE instance_id = ? AND entity = ? AND id = ?')
      .bind(instanceId, entity, id)
      .run();
    return result.meta.changes > 0;
  }
}

/** Inicializa D1 adapter global. Solo llamar en contexto Workers (runtime env disponible). */
export function initD1Adapter(d1: D1Database): void {
  adapter = new D1Adapter(d1);
}
