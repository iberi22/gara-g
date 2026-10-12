/**
 * src/lib/local/dump.ts — Exportar, importar y fusionar los datos locales.
 *
 * Contrato del plan de onboarding local-first (2026-10-02, doc interno): el respaldo cifrado (S4)
 * solo importa estas tres funciones y no depende de nada mas de src/lib/local. El acceso a
 * IndexedDB se carga con import dinamico: `mergeLocalDumps` es pura y se puede usar en el
 * servidor o en tests sin arrastrar `idb`.
 */
import { domainConfig } from '../domain.config';
import type { DomainRecord } from '../domain';
import type { LocalDump, LocalTombstone } from './types';

/**
 * Lista blanca de claves de localStorage que valen como datos del usuario. Prefijos. NUNCA
 * entran `gara:sync:*` (ahi vive el codigo secreto del respaldo), `garage:snapshot:v1` (cache)
 * ni credenciales.
 */
export const KV_ALLOWED_PREFIXES = ['gara:prefs', 'garage:paint:', 'garage:theme:v1', 'swal:theme-mode'] as const;

export function isBackedUpKvKey(key: string): boolean {
  return KV_ALLOWED_PREFIXES.some((p) => key.startsWith(p));
}

const hasStorage = (): boolean => {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
};

function readKv(): Record<string, string> {
  const kv: Record<string, string> = {};
  if (!hasStorage()) return kv;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || !isBackedUpKvKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) kv[key] = value;
  }
  return kv;
}

/** Todo lo local de este navegador, listo para cifrar. */
export async function exportLocalData(): Promise<LocalDump> {
  const { readLocalStores } = await import('./indexedDbAdapter');
  const { entities, deleted } = await readLocalStores();
  return { version: 1, exportedAt: new Date().toISOString(), entities, deleted, kv: readKv() };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIso = (v: unknown): v is string => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));

/** Valida la forma de un volcado. Lanza con un mensaje claro si algo no cuadra. */
export function assertLocalDump(value: unknown): asserts value is LocalDump {
  if (!isObj(value)) throw new Error('Volcado inválido: no es un objeto');
  if (value.version !== 1) throw new Error(`Volcado inválido: versión ${String(value.version)} no soportada`);
  if (!isIso(value.exportedAt)) throw new Error('Volcado inválido: exportedAt');
  if (!isObj(value.entities)) throw new Error('Volcado inválido: entities');
  if (!isObj(value.deleted)) throw new Error('Volcado inválido: deleted');
  if (!isObj(value.kv)) throw new Error('Volcado inválido: kv');

  const known = new Set<string>(domainConfig.entities.map((e) => e.name));
  for (const [entity, list] of Object.entries(value.entities)) {
    if (!known.has(entity)) throw new Error(`Volcado inválido: entidad desconocida "${entity}"`);
    if (!Array.isArray(list)) throw new Error(`Volcado inválido: entities.${entity}`);
    for (const r of list) {
      if (!isObj(r) || typeof r.id !== 'string' || r.id === '' || !isIso(r.updated_at) || !isIso(r.created_at)) {
        throw new Error(`Volcado inválido: registro de ${entity}`);
      }
    }
  }
  for (const [entity, list] of Object.entries(value.deleted)) {
    if (!known.has(entity)) throw new Error(`Volcado inválido: entidad desconocida "${entity}"`);
    if (!Array.isArray(list)) throw new Error(`Volcado inválido: deleted.${entity}`);
    for (const t of list) {
      if (!isObj(t) || typeof t.id !== 'string' || t.id === '' || !isIso(t.deletedAt)) {
        throw new Error(`Volcado inválido: lápida de ${entity}`);
      }
    }
  }
  for (const [k, v] of Object.entries(value.kv)) {
    if (typeof v !== 'string') throw new Error(`Volcado inválido: kv.${k}`);
  }
}

/** Reemplaza lo local por `dump` (restaurar en un dispositivo nuevo). Si es inválido, no toca nada. */
export async function importLocalData(dump: LocalDump): Promise<void> {
  assertLocalDump(dump);
  const { replaceLocalStores } = await import('./indexedDbAdapter');
  await replaceLocalStores({ entities: dump.entities, deleted: dump.deleted });

  if (!hasStorage()) return;
  // El kv tambien se reemplaza, pero solo dentro de la lista blanca: un volcado ajeno no puede
  // pisar `gara:sync:*` ni otras claves de la app.
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && isBackedUpKvKey(key)) stale.push(key);
  }
  for (const key of stale) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(dump.kv)) {
    if (isBackedUpKvKey(key)) localStorage.setItem(key, value);
  }
}

const ms = (iso: string): number => Date.parse(iso);

function pickRecord(a: DomainRecord, b: DomainRecord): DomainRecord {
  const d = ms(a.updated_at) - ms(b.updated_at);
  if (d !== 0) return d > 0 ? a : b;
  // Empate exacto: desempate determinista para que el resultado no dependa del orden.
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/**
 * Fusion pura de dos volcados: por entidad e id gana el `updated_at` mas reciente, y una
 * lapida con `deletedAt` mas reciente que el registro lo elimina (la lapida se conserva).
 * `kv` se une y, ante conflicto, gana el volcado con `exportedAt` mas reciente. Los
 * registros y lapidas no dependen del orden de los argumentos. No toca IndexedDB.
 */
export function mergeLocalDumps(a: LocalDump, b: LocalDump): LocalDump {
  // Lapidas: por entidad e id, la mas reciente.
  const tombs = new Map<string, Map<string, LocalTombstone>>();
  for (const src of [a.deleted, b.deleted]) {
    for (const [entity, list] of Object.entries(src ?? {})) {
      const m = tombs.get(entity) ?? new Map<string, LocalTombstone>();
      for (const t of list) {
        const cur = m.get(t.id);
        if (!cur || ms(t.deletedAt) > ms(cur.deletedAt)) m.set(t.id, { id: t.id, deletedAt: t.deletedAt });
      }
      tombs.set(entity, m);
    }
  }

  // Registros: gana el updated_at mayor.
  const recs = new Map<string, Map<string, DomainRecord>>();
  for (const src of [a.entities, b.entities]) {
    for (const [entity, list] of Object.entries(src ?? {})) {
      const m = recs.get(entity) ?? new Map<string, DomainRecord>();
      for (const r of list) {
        const cur = m.get(r.id);
        m.set(r.id, cur ? pickRecord(cur, r) : r);
      }
      recs.set(entity, m);
    }
  }

  const entities: Record<string, DomainRecord[]> = {};
  for (const [entity, m] of recs) {
    const kept = [...m.values()].filter((r) => {
      const t = tombs.get(entity)?.get(r.id);
      return !t || !(ms(t.deletedAt) > ms(r.updated_at));
    });
    if (kept.length) entities[entity] = kept.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }

  const deleted: Record<string, LocalTombstone[]> = {};
  for (const [entity, m] of tombs) {
    if (m.size) deleted[entity] = [...m.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }

  // kv: gana el volcado mas reciente; en empate de exportedAt, el valor mayor (determinista).
  const aWins = ms(a.exportedAt) > ms(b.exportedAt);
  const tie = ms(a.exportedAt) === ms(b.exportedAt);
  const kv: Record<string, string> = {};
  for (const key of new Set([...Object.keys(a.kv ?? {}), ...Object.keys(b.kv ?? {})])) {
    const va = a.kv?.[key];
    const vb = b.kv?.[key];
    if (va === undefined) kv[key] = vb as string;
    else if (vb === undefined) kv[key] = va;
    else if (tie) kv[key] = va >= vb ? va : vb;
    else kv[key] = aWins ? va : vb;
  }

  return {
    version: 1,
    exportedAt: ms(a.exportedAt) >= ms(b.exportedAt) ? a.exportedAt : b.exportedAt,
    entities,
    deleted,
    kv,
  };
}
