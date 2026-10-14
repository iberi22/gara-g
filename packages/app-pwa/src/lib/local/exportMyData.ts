import { domainConfig } from '../domain.config';
import { exportLocalData } from './dump';
import type { LocalDump } from './types';

const isValidIdentifier = (name: string): boolean => /^[A-Za-z0-9_]+$/.test(name);
const escapeSqlString = (str: string | undefined | null): string => {
  if (str === undefined || str === null) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
};

/**
 * Genera un dump SQL (SQLite dialect) a partir del volcado local.
 */
export function buildSqlDump(dump: LocalDump): string {
  const lines: string[] = ['PRAGMA foreign_keys=OFF;', 'BEGIN;'];

  // _export_meta
  lines.push('CREATE TABLE IF NOT EXISTS "_export_meta" (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('format', 'export-v1');`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('app_id', ${escapeSqlString(domainConfig.appId)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('exported_at', ${escapeSqlString(dump.exportedAt)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('schema_version', '${dump.version}');`);

  // Registros de entidades
  for (const entity of Object.keys(dump.entities)) {
    if (!isValidIdentifier(entity)) throw new Error(`Invalid entity name: ${entity}`);
    lines.push(
      `CREATE TABLE IF NOT EXISTS "${entity}" (id TEXT PRIMARY KEY, instance_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, data TEXT NOT NULL);`
    );

    for (const record of dump.entities[entity]) {
      const id = escapeSqlString(record.id);
      const instance_id = escapeSqlString(record.instance_id);
      const created_at = escapeSqlString(record.created_at);
      const updated_at = escapeSqlString(record.updated_at);
      const data = escapeSqlString(JSON.stringify(record));
      // Se asume que no está borrado; el volcado exportLocalData() no mezcla deleted y entities.
      lines.push(
        `INSERT INTO "${entity}" (id, instance_id, created_at, updated_at, deleted_at, data) VALUES (${id}, ${instance_id}, ${created_at}, ${updated_at}, NULL, ${data});`
      );
    }
  }

  // Lápidas (_tombstones)
  lines.push('CREATE TABLE IF NOT EXISTS "_tombstones" (entity TEXT, id TEXT, deleted_at TEXT, PRIMARY KEY (entity, id));');
  for (const entity of Object.keys(dump.deleted)) {
    if (!isValidIdentifier(entity)) throw new Error(`Invalid entity name: ${entity}`);
    for (const tomb of dump.deleted[entity]) {
      const id = escapeSqlString(tomb.id);
      const deleted_at = escapeSqlString(tomb.deletedAt);
      lines.push(
        `INSERT INTO "_tombstones" (entity, id, deleted_at) VALUES (${escapeSqlString(entity)}, ${id}, ${deleted_at});`
      );
    }
  }

  // Clave/valor (_kv)
  lines.push('CREATE TABLE IF NOT EXISTS "_kv" (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  for (const [key, value] of Object.entries(dump.kv)) {
    lines.push(`INSERT INTO "_kv" (key, value) VALUES (${escapeSqlString(key)}, ${escapeSqlString(value)});`);
  }

  lines.push('COMMIT;');
  lines.push(''); // newline al final
  return lines.join('\n');
}

/**
 * Obtiene los datos locales en ambos formatos: JSON y SQL.
 */
export async function exportMyDataFiles(): Promise<{ json: string; sql: string; baseName: string }> {
  const dump = await exportLocalData();
  const json = JSON.stringify(dump, null, 2);
  const sql = buildSqlDump(dump);

  // Format YYYY-MM-DD
  const dateStr = new Date().toISOString().split('T')[0];
  const baseName = `gara-g-datos-${dateStr}`;

  return { json, sql, baseName };
}

/**
 * Dispara la descarga del archivo (JSON o SQL) en el navegador.
 */
export async function downloadMyData(kind: 'json' | 'sql'): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const { json, sql, baseName } = await exportMyDataFiles();
  const content = kind === 'json' ? json : sql;
  const mimeType = kind === 'json' ? 'application/json;charset=utf-8;' : 'application/sql;charset=utf-8;';
  const filename = `${baseName}.${kind}`;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
