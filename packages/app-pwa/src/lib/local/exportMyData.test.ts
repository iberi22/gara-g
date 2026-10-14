// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);

import { domainConfig } from '../domain.config';
import { LOCAL_INSTANCE_ID } from '../appMode';
import { createEntity, deleteEntity, listEntities, setStorageAdapter, getMemoryAdapter } from '../domain';
import { exportLocalData, importLocalData, assertLocalDump } from './dump';
import { closeLocalDb, getLocalAdapter } from './indexedDbAdapter';
import { buildSqlDump, exportMyDataFiles } from './exportMyData';

beforeEach(async () => {
  await closeLocalDb();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  setStorageAdapter(getLocalAdapter());
});

afterEach(() => {
  setStorageAdapter(getMemoryAdapter());
});

describe('exportMyDataFiles (JSON + SQL)', () => {
  it('exporta JSON que pasa assertLocalDump e importa idéntico, y SQL restaura correctamente', async () => {
    // 1. Seed
    const seededEntities: Record<string, string[]> = {};
    for (const entityDef of domainConfig.entities) {
      const entity = entityDef.name;
      // Some properties for seed
      const e1 = await createEntity(entity, { name: `test1_${entity}`, "quote'test": `O'Connor` }, LOCAL_INSTANCE_ID);
      const e2 = await createEntity(entity, { name: `test2_${entity}` }, LOCAL_INSTANCE_ID);
      seededEntities[entity] = [e1.id, e2.id];
    }

    // Seed tombstone
    const firstEntity = domainConfig.entities[0].name;
    const toDelete = await createEntity(firstEntity, { name: 'to_delete' }, LOCAL_INSTANCE_ID);
    await deleteEntity(firstEntity, toDelete.id, LOCAL_INSTANCE_ID);

    // Seed KV
    localStorage.setItem('gara:prefs', 'my_prefs');
    localStorage.setItem('gara:sync:code', 'SECRET_DO_NOT_EXPORT'); // Should NOT be in export

    // 2. Export
    const { json, sql } = await exportMyDataFiles();

    // 3. Verify JSON
    const parsed = JSON.parse(json);
    expect(() => assertLocalDump(parsed)).not.toThrow();

    // Assert secrets are not there
    expect(json).not.toContain('gara:sync');
    expect(sql).not.toContain('gara:sync');
    expect(sql).not.toContain('SECRET_DO_NOT_EXPORT');

    // Ensure entities match what we exported
    for (const entityDef of domainConfig.entities) {
      expect(parsed.entities[entityDef.name]).toHaveLength(2);
    }
    expect(parsed.deleted[firstEntity]).toHaveLength(1);

    // Test import round-trip
    await closeLocalDb();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    localStorage.clear();

    await importLocalData(parsed);
    const afterImport = await exportLocalData();
    expect(afterImport.entities).toEqual(parsed.entities);
    expect(afterImport.deleted).toEqual(parsed.deleted);

    // 4. Verify SQL with in-memory DB
    const wasmBinary = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
    const SQL = await initSqlJs({ wasmBinary });
    const db = new SQL.Database();

    // Exec the dump
    db.run(sql);

    // Check tables
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = res[0].values.map((v) => v[0] as string);

    expect(tables).toContain('_export_meta');
    expect(tables).toContain('_tombstones');
    expect(tables).toContain('_kv');

    for (const entityDef of domainConfig.entities) {
      const entity = entityDef.name;
      expect(tables).toContain(entity);
      const countRes = db.exec(`SELECT COUNT(*) FROM "${entity}"`);
      expect(countRes[0].values[0][0]).toBe(2);
    }

    // Check tombstones
    const tombCount = db.exec(`SELECT COUNT(*) FROM "_tombstones" WHERE entity='${firstEntity}'`);
    expect(tombCount[0].values[0][0]).toBe(1);

    // Check KV
    const kvCount = db.exec(`SELECT value FROM "_kv" WHERE key='gara:prefs'`);
    expect(kvCount[0].values[0][0]).toBe('my_prefs');

    // Ensure correct escaping for single quotes
    const quoteSearch = db.exec(`SELECT data FROM "${firstEntity}" WHERE data LIKE '%O''Connor%'`);
    expect(quoteSearch[0].values.length).toBeGreaterThan(0);

    db.close();
  });
});
