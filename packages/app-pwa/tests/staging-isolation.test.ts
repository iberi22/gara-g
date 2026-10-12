import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { productionIds, stagingIds, stagingResources } from '../../../scripts/infra-config.mjs';
import { applyStagingIsolation } from '../scripts/prepare-staging-config.mjs';

/**
 * Ids de PRODUCCION, leidos de la config de wrangler (la unica fuente). En el repo publico es
 * la plantilla wrangler.example.toml; con la config real del deploy, el fichero real
 * (scripts/infra-config.mjs). Las reglas del guard son las mismas en los dos casos.
 */
function p() {
  const { d1, r2, kvSession, kvSwal } = productionIds();
  return { d1, r2, kvSession, kvSwal };
}

/** Config de deploy con la forma del bundle de produccion. */
function prodShapedConfig(i: ReturnType<typeof p>) {
  return { d1_databases: [{ binding: 'SWAL_D1', database_name: productionIds().d1Name, database_id: i.d1 }], r2_buckets: [{ bucket_name: i.r2 }], kv_namespaces: [{ binding: 'SESSION', id: i.kvSession }, { binding: 'SWAL_KV', id: i.kvSwal }] };
}

/** D1 `gara-staging` (config/staging-resources.json o su plantilla). */
const STAGING_D1: string = stagingIds().d1_database_id;
/** D1 de produccion (wrangler.toml o su plantilla). */
const PRODUCTION_D1 = p().d1;

describe('staging-isolation', () => {
  it('la config de produccion declara una D1 (uuid) distinta de la del stage', () => {
    expect(PRODUCTION_D1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(PRODUCTION_D1).not.toBe(STAGING_D1);
  });

  it('sustituye cada binding de produccion por el de staging', () => {
    const i = p();
    const c = prodShapedConfig(i);
    applyStagingIsolation(c, i, { d1_database_id: STAGING_D1, r2_bucket_name: 'b', kv: { SESSION: 'c', SWAL_KV: 'd' } });
    [c.d1_databases[0].database_id, c.r2_buckets[0].bucket_name, c.kv_namespaces[0].id, c.kv_namespaces[1].id].forEach((x, idx) => expect(x).not.toBe([i.d1, i.r2, i.kvSession, i.kvSwal][idx]));
  });

  it('rechaza una config de staging que reutiliza los ids de produccion', () => {
    const i = p();
    const c = prodShapedConfig(i);
    expect(() => applyStagingIsolation(c, i, { d1_database_id: i.d1, r2_bucket_name: i.r2, kv: { SESSION: i.kvSession, SWAL_KV: i.kvSwal } })).toThrow();
  });

  it('rechaza un id de produccion aunque este en otro campo (cruzado)', () => {
    const i = p();
    expect(() => applyStagingIsolation(prodShapedConfig(i), i, { d1_database_id: STAGING_D1, r2_bucket_name: 'b', kv: { SESSION: i.d1!, SWAL_KV: 'd' } })).toThrow(/production/);
    expect(() => applyStagingIsolation(prodShapedConfig(i), i, { d1_database_id: STAGING_D1, r2_bucket_name: i.kvSwal!, kv: { SESSION: 'c', SWAL_KV: 'd' } })).toThrow(/production/);
  });

  it('rechaza un D1 de staging que no es un uuid (un sentinel publicaria un stage sin base)', () => {
    const i = p();
    expect(() => applyStagingIsolation(prodShapedConfig(i), i, { d1_database_id: 'staging-not-prod-d1', r2_bucket_name: 'b', kv: { SESSION: 'c', SWAL_KV: 'd' } })).toThrow(/uuid/);
  });

  it('config/staging-resources.json no contiene ningun id de produccion', () => {
    const raw = readFileSync(stagingResources().path, 'utf-8');
    const ids = p();
    expect(raw).not.toContain(ids.d1);
    expect(raw).not.toContain(ids.r2);
    expect(raw).not.toContain(ids.kvSession);
    expect(raw).not.toContain(ids.kvSwal);
  });

  it('config/staging-resources.json apunta la D1 a gara-staging y el guard la acepta', () => {
    const s = stagingIds();
    expect(s.d1_database_id).toBe(STAGING_D1);
    expect(s.d1_database_name).toBe('gara-staging');
    const i = p();
    const c = prodShapedConfig(i);
    applyStagingIsolation(c, i, s);
    expect(c.d1_databases[0].database_id).toBe(STAGING_D1);
    expect(c.d1_databases[0].database_name).toBe('gara-staging');
  });
});
