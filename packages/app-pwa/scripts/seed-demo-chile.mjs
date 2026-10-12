#!/usr/bin/env node
/**
 * seed-demo-chile.mjs — Siembra la flota demo FICTICIA chilena (tenant `flota-demo-chile`):
 * 10 camiones tolva, 8 conductores, mantenimiento, combustible, documentos (algunos por
 * vencer), 3 geocercas en Antofagasta/Calama y alertas. Los datos viven en
 * src/lib/demoChile.ts (misma fuente que la vista de solo lectura y el garage invitado).
 *
 * Escribe directo en la tabla generica `entity` (drizzle/0001_gara_g_d1_schema.sql) con ids
 * deterministas y UPSERT por (instance_id, entity, id): correrlo N veces deja las mismas
 * filas. No usa la API /api/fleet/* (como seed-demo-obras.mjs) porque esa exige sesion y
 * valida patentes colombianas; aqui no hay servidor que levantar.
 *
 *   # SQL para revisar o aplicar a mano
 *   node scripts/seed-demo-chile.mjs --out /tmp/seed-demo-chile.sql
 *
 *   # Aplicar a un SQLite local (crea el esquema si falta) e imprimir las cuentas
 *   node scripts/seed-demo-chile.mjs --sqlite /tmp/gara-demo.db
 *
 *   # Con el usuario real de los e2e (credenciales SOLO por entorno, nunca en el repo)
 *   E2E_USER_EMAIL=... E2E_USER_PASSWORD=... node scripts/seed-demo-chile.mjs --e2e-user \
 *     [--e2e-tenant gara-staging] --out /tmp/seed-demo-chile.sql
 *
 *   # D1 local de wrangler (miniflare), con el SQL generado arriba
 *   npx wrangler d1 execute gara-staging --local --file /tmp/seed-demo-chile.sql
 *
 * D1 de STAGING (`gara-staging`, id en config/staging-resources.json): lo aplica el owner
 * con `--remote`. NUNCA contra la D1 de produccion (la del wrangler.toml): el script se niega a escribir un
 * SQL cuyo destino declarado sea el id de produccion.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILE_DEMO_INSTANCE_ID, buildChileDemo, countByEntity } from '../src/lib/demoChile.ts';
import { productionIds, stagingIds } from '../../../scripts/infra-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Ids leidos de la config de infraestructura (wrangler.toml / staging-resources.json, que
// no van en el repo publico; sin ellos, las plantillas). Ver scripts/infra-config.mjs.
export const PRODUCTION_D1_ID = productionIds().d1;
export const STAGING_D1_ID = stagingIds().d1_database_id;

/** DDL minimo: la tabla `entity` y el registro de semillas, tal como en drizzle/0001. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entity (
  instance_id TEXT NOT NULL,
  entity      TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (instance_id, entity, id)
);
CREATE INDEX IF NOT EXISTS idx_entity_list ON entity (instance_id, entity, updated_at DESC);
CREATE TABLE IF NOT EXISTS seed_registry (
  instance_id  TEXT PRIMARY KEY,
  seeded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  entity_count INTEGER NOT NULL DEFAULT 0
);`.trim();

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** Sentencias UPSERT idempotentes para todas las filas de la demo. */
export function buildSeedStatements(rows, now = new Date().toISOString()) {
  const stmts = rows.map(
    (r) =>
      `INSERT INTO entity (instance_id, entity, id, data, created_at, updated_at) VALUES (${q(r.instanceId ?? CHILE_DEMO_INSTANCE_ID)}, ${q(r.entity)}, ${q(r.id)}, ${q(JSON.stringify(r.data))}, ${q(now)}, ${q(now)}) ` +
      'ON CONFLICT(instance_id, entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;',
  );
  const demoRows = rows.filter((r) => !r.instanceId || r.instanceId === CHILE_DEMO_INSTANCE_ID).length;
  stmts.push(
    `INSERT INTO seed_registry (instance_id, seeded_at, entity_count) VALUES (${q(CHILE_DEMO_INSTANCE_ID)}, ${q(now)}, ${demoRows}) ` +
      'ON CONFLICT(instance_id) DO UPDATE SET seeded_at = excluded.seeded_at, entity_count = excluded.entity_count;',
  );
  return stmts;
}

export function buildSeedSql(rows, { target = STAGING_D1_ID, now } = {}) {
  if (target === PRODUCTION_D1_ID) throw new Error('seed-demo-chile: destino = D1 de PRODUCCION (swal-billing). Abortado.');
  return [
    `-- seed-demo-chile: tenant ${CHILE_DEMO_INSTANCE_ID} (datos FICTICIOS)`,
    `-- destino previsto: D1 ${target}. NO aplicar a swal-billing (${PRODUCTION_D1_ID}).`,
    SCHEMA_SQL,
    ...buildSeedStatements(rows, now),
    '',
  ].join('\n');
}

/** Aplica la semilla a una base SQLite abierta (node:sqlite DatabaseSync). Devuelve las cuentas. */
export function applySeed(db, rows, now) {
  db.exec(SCHEMA_SQL);
  db.exec('BEGIN');
  try {
    for (const s of buildSeedStatements(rows, now)) db.exec(s);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return countRows(db);
}

/** Tenant donde se busca el usuario al hacer login en el stage (ver src/lib/staging.ts). */
export const E2E_DEFAULT_TENANT = 'gara-staging';

/**
 * Usuario REAL para los e2e que inician sesion (tabla `entity`, entity='user'), con el mismo
 * formato que lee src/lib/authenticate.ts. Email y contrasena llegan del entorno
 * (E2E_USER_EMAIL / E2E_USER_PASSWORD): ninguna credencial queda escrita en el repo y la
 * contrasena solo se guarda como hash PBKDF2. Id fijo: volver a sembrar actualiza la fila.
 */
export async function buildE2EUserRow({ email, password, tenant = E2E_DEFAULT_TENANT }) {
  if (typeof email !== 'string' || !email.includes('@')) throw new Error('E2E_USER_EMAIL invalido');
  if (typeof password !== 'string' || password.length < 12) throw new Error('E2E_USER_PASSWORD debe tener al menos 12 caracteres');
  const { hashPassword } = await import('../src/lib/password.ts');
  return {
    instanceId: tenant,
    entity: 'user',
    id: 'usr-e2e',
    data: { email: email.toLowerCase(), passwordHash: await hashPassword(password), role: 'admin', active: true, e2e: true },
  };
}

/** Filas por entidad del tenant demo, mas el total de la tabla. */
export function countRows(db) {
  const out = {};
  for (const r of db
    .prepare('SELECT entity, COUNT(*) AS n FROM entity WHERE instance_id = ? GROUP BY entity ORDER BY entity')
    .all(CHILE_DEMO_INSTANCE_ID)) {
    out[r.entity] = Number(r.n);
  }
  out.__total = Number(db.prepare('SELECT COUNT(*) AS n FROM entity').get().n);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const rows = buildChileDemo();
  if (process.argv.includes('--e2e-user')) {
    // Opcional: usuario para los e2e con login (vehicle-validation, nav-perf, forms-audit).
    rows.push(await buildE2EUserRow({ email: process.env.E2E_USER_EMAIL, password: process.env.E2E_USER_PASSWORD, tenant: arg('e2e-tenant') ?? E2E_DEFAULT_TENANT }));
    console.log(`[seed-demo-chile] + usuario e2e ${process.env.E2E_USER_EMAIL} en el tenant ${arg('e2e-tenant') ?? E2E_DEFAULT_TENANT}`);
  }
  const out = arg('out');
  const sqlite = arg('sqlite');
  if (!out && !sqlite) {
    console.error('Uso: node scripts/seed-demo-chile.mjs [--out archivo.sql] [--sqlite base.db]');
    process.exit(1);
  }
  // El destino declarado del stage sale del guard de staging, no de un literal aparte.
  const resources = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'staging-resources.json'), 'utf-8'));
  if (out) {
    writeFileSync(out, buildSeedSql(rows, { target: resources.d1_database_id }));
    console.log(`[seed-demo-chile] SQL escrito en ${out} (${rows.length} filas, destino D1 ${resources.d1_database_id})`);
  }
  if (sqlite) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sqlite);
    const counts = applySeed(db, rows);
    db.close();
    console.log(`[seed-demo-chile] ${sqlite}: ${JSON.stringify(counts)}`);
  }
  console.log(`[seed-demo-chile] esperado: ${JSON.stringify(countByEntity(rows))}`);
}
