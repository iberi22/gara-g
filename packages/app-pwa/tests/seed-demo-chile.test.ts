/**
 * seed-demo-chile — la semilla de la flota demo chilena es idempotente y ficticia.
 * Se aplica dos veces a un SQLite en memoria (node:sqlite, mismo dialecto que D1).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CHILE_DEMO_INSTANCE_ID, buildChileDemo, countByEntity, rutDv } from '../src/lib/demoChile';
import { PRODUCTION_D1_ID, applySeed, buildE2EUserRow, buildSeedSql, countRows } from '../scripts/seed-demo-chile.mjs';
import { verifyPassword } from '../src/lib/password';

const TODAY = new Date('2026-10-17T12:00:00Z');

describe('seed-demo-chile', () => {
  it('aplicarla dos veces deja exactamente las mismas filas', () => {
    const db = new DatabaseSync(':memory:');
    const first = applySeed(db, buildChileDemo(TODAY), '2026-10-17T12:00:00.000Z');
    // Segunda corrida otro dia: actualiza fechas, no duplica.
    const second = applySeed(db, buildChileDemo(new Date('2026-10-18T12:00:00Z')), '2026-10-18T12:00:00.000Z');
    expect(second).toEqual(first);
    expect(first).toMatchObject({ fleet: 1, vehicle: 10, driver: 8, geofence: 3 });
    expect(first.maintenance).toBeGreaterThanOrEqual(20);
    expect(first.fuelLog).toBeGreaterThanOrEqual(20);
    expect(first.alert).toBeGreaterThanOrEqual(3);
    const reg = db.prepare('SELECT entity_count FROM seed_registry WHERE instance_id = ?').get(CHILE_DEMO_INSTANCE_ID) as { entity_count: number };
    expect(reg.entity_count).toBe(first.__total);
    db.close();
  });

  it('no toca filas de otros tenants', () => {
    const db = new DatabaseSync(':memory:');
    applySeed(db, [], '2026-10-17T00:00:00.000Z');
    db.prepare("INSERT INTO entity (instance_id, entity, id, data) VALUES ('otro-tenant', 'vehicle', 'cl-veh-01', '{}')").run();
    applySeed(db, buildChileDemo(TODAY));
    const other = db.prepare("SELECT data FROM entity WHERE instance_id = 'otro-tenant'").get() as { data: string };
    expect(other.data).toBe('{}');
    expect(countRows(db).__total).toBe(buildChileDemo(TODAY).length + 1);
    db.close();
  });

  it('las cuentas del SQL coinciden con el dataset', () => {
    const rows = buildChileDemo(TODAY);
    const db = new DatabaseSync(':memory:');
    db.exec(buildSeedSql(rows, { now: '2026-10-17T00:00:00.000Z' }));
    const { __total, ...counts } = countRows(db);
    expect(counts).toEqual(countByEntity(rows));
    expect(__total).toBe(rows.length);
    db.close();
  });

  it('se niega a generar SQL con destino la D1 de produccion', () => {
    expect(() => buildSeedSql(buildChileDemo(TODAY), { target: PRODUCTION_D1_ID })).toThrow(/PRODUCCION/);
  });

  it('datos chilenos y ficticios: patentes ABCD-12, RUT validos de rango ficticio, documentos por vencer', () => {
    const rows = buildChileDemo(TODAY);
    const vehicles = rows.filter((r) => r.entity === 'vehicle').map((r) => r.data);
    for (const v of vehicles) expect(v.plate).toMatch(/^ZZ[A-Z]{2}-\d{2}$/);
    expect(new Set(vehicles.map((v) => v.plate)).size).toBe(10);

    const drivers = rows.filter((r) => r.entity === 'driver').map((r) => r.data);
    for (const d of drivers) {
      const m = /^(\d{2})\.(\d{3})\.(\d{3})-([\dK])$/.exec(String(d.rut));
      expect(m).not.toBeNull();
      const body = Number(m![1] + m![2] + m![3]);
      expect(body).toBeGreaterThanOrEqual(30_000_000);
      expect(rutDv(body)).toBe(m![4]);
      expect(String(d.name)).toContain('Ejemplo');
    }

    const docs = rows.filter((r) => r.entity === 'document').map((r) => r.data);
    expect(docs.filter((d) => d.status === 'expiring').length).toBeGreaterThanOrEqual(3);
    expect(docs.some((d) => d.status === 'expired')).toBe(true);

    // Geocercas en la Region de Antofagasta (lat -21.5..-24.5, lng -68..-71).
    for (const g of rows.filter((r) => r.entity === 'geofence')) {
      for (const pt of String(g.data.polygon).split(' ')) {
        const [lat, lng] = pt.split(',').map(Number);
        expect(lat).toBeGreaterThan(-24.5);
        expect(lat).toBeLessThan(-21.5);
        expect(lng).toBeGreaterThan(-71);
        expect(lng).toBeLessThan(-68);
      }
    }
  });

  it('usuario e2e opcional: fila real que encuentra la consulta de authenticate(), idempotente', async () => {
    // Credencial efimera del propio test: el repo no guarda ninguna.
    const password = `e2e-${crypto.randomUUID()}`;
    const db = new DatabaseSync(':memory:');
    const rows = [...buildChileDemo(TODAY), await buildE2EUserRow({ email: 'E2E@example.test', password })];
    const first = applySeed(db, rows);
    const second = applySeed(db, [...buildChileDemo(TODAY), await buildE2EUserRow({ email: 'e2e@example.test', password })]);
    expect(second).toEqual(first);
    // Misma consulta que src/lib/authenticate.ts (findUserByEmailD1).
    const hit = db
      .prepare(
        `SELECT id AS userId, data FROM entity WHERE instance_id = ? AND entity = 'user'
           AND json_extract(data, '$.active') = 1 AND lower(json_extract(data, '$.email')) = lower(?)`,
      )
      .get('gara-staging', 'e2e@example.test') as { userId: string; data: string } | undefined;
    expect(hit?.userId).toBe('usr-e2e');
    const data = JSON.parse(hit!.data);
    expect(data.role).toBe('admin');
    expect(await verifyPassword(password, data.passwordHash)).toBe(true);
    expect(await verifyPassword('otra-cosa-cualquiera', data.passwordHash)).toBe(false);
    expect(hit!.data).not.toContain(password);
    // El usuario no cae en el tenant de la flota demo.
    expect(first.user).toBeUndefined();
    db.close();
  });

  it('usuario e2e: rechaza credenciales vacias o cortas', async () => {
    await expect(buildE2EUserRow({ email: undefined, password: 'x'.repeat(20) })).rejects.toThrow(/EMAIL/);
    await expect(buildE2EUserRow({ email: 'a@b.test', password: 'corta' })).rejects.toThrow(/PASSWORD/);
  });

  it('rutDv calcula el digito verificador (modulo 11)', () => {
    expect(rutDv(11_111_111)).toBe('1');
    expect(rutDv(12_345_678)).toBe('5');
    expect(rutDv(10_000_013)).toBe('K');
  });
});
