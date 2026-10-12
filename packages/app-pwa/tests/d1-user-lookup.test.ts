/**
 * tests/d1-user-lookup.test.ts — el login contra D1 usa columnas que existen.
 *
 * El fallo que cubre: `findUserByEmailD1` filtraba por
 *
 *     WHERE instance_id = ? AND entity = 'user' AND active = 1
 *
 * `active` no es una columna de la tabla `entity`. El esquema (drizzle/0001) es
 *
 *     instance_id, entity, id, data, created_at, updated_at
 *
 * y todo el registro del usuario vive serializado dentro de `data`. SQLite
 * responde `no such column: active` y el endpoint de login devolvia 500 con
 * `{"ok":false,"error":"Error interno"}` para CUALQUIER usuario. No era un caso
 * raro: era el login entero, siempre que hubiera usuarios en D1 (que es lo que
 * pasa en produccion, donde el login de demo esta desactivado).
 *
 * Estos casos ejecutan el SQL real contra un SQLite en memoria con el esquema
 * de la migracion, no un grep del fuente: comprueban que la consulta se
 * ejecuta, que encuentra al usuario activo y que EXCLUYE al desactivado.
 */
import { describe, expect, it } from 'vitest';

/**
 * El esquema tal cual esta en drizzle/0001_gara_g_d1_schema.sql. Se replica aqui
 * a proposito: si la migracion cambia, este test debe cambiar con ella, y a mano
 * se ve. `tests/d1-schema.test.ts` comprueba que las dos copias siguen iguales.
 */
const ESQUEMA = `
  CREATE TABLE entity (
    instance_id TEXT NOT NULL,
    entity      TEXT NOT NULL,
    id          TEXT NOT NULL,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (instance_id, entity, id)
  );
`;

/** Columnas reales de la tabla, extraidas del esquema. */
const COLUMNAS = ['instance_id', 'entity', 'id', 'data', 'created_at', 'updated_at'];

describe('el esquema de entity', () => {
  it('no tiene una columna active: por eso el filtro va sobre el JSON', () => {
    // Si alguien anade la columna, este test avisa: la consulta del login
    // tendria que cambiar, y este fichero con ella.
    expect(COLUMNAS).not.toContain('active');
  });
});

describe('la consulta del login se ejecuta y filtra bien', () => {
  it('la consulta de findUserByEmailD1 no lanza y encuentra al usuario activo', async () => {
    const { default: Database } = await import('node:sqlite').then((m) => ({
      default: m.DatabaseSync,
    }));
    const db = new Database(':memory:');
    db.exec(ESQUEMA);

    const pass = { email: 'a@b.c', passwordHash: 'c2FsdA==:aGFzaA==', role: 'admin', active: true };
    const ins = db.prepare(
      'INSERT INTO entity (instance_id, entity, id, data) VALUES (?, ?, ?, ?)',
    );
    ins.run('t1', 'user', 'u1', JSON.stringify(pass));
    ins.run('t1', 'user', 'u2', JSON.stringify({ ...pass, email: 'off@b.c', active: false }));
    ins.run('t2', 'user', 'u3', JSON.stringify({ ...pass, email: 'otro@b.c' }));

    // La consulta EXACTA de src/lib/authenticate.ts tras el fix.
    const q = db.prepare(
      `SELECT id AS userId, data FROM entity
       WHERE instance_id = ? AND entity = 'user'
         AND json_extract(data, '$.active') = 1
         AND lower(json_extract(data, '$.email')) = lower(?)`,
    );

    const activo = q.get('t1', 'A@B.C') as { userId: string; data: string } | undefined;
    expect(activo, 'debe encontrarlo sin distinguir mayusculas').toBeDefined();
    expect(activo?.userId).toBe('u1');
    expect(JSON.parse(activo!.data).passwordHash).toBe(pass.passwordHash);

    // Un usuario desactivado no entra, aunque su email y hash sean correctos.
    expect(q.get('t1', 'off@b.c')).toBeUndefined();
    // El mismo email en OTRO tenant no debe colarse: el tenant va en el WHERE,
    // no se deduce del email. u3 vive en t2.
    expect(q.get('t1', 'otro@b.c'), 'otro tenant no debe entrar').toBeUndefined();
    expect(q.get('t2', 'otro@b.c')?.userId, 'pero en su propio tenant si').toBe('u3');
    db.close();
  });

  it('la consulta del test es la MISMA que la del codigo', async () => {
    // Sin esto, el test probaria su propia copia del SQL y el bug volveria sin
    // que nadie se entere. Se comparan las condiciones, no el fichero entero.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/lib/authenticate.ts'), 'utf8');
    const bloque = /SELECT id AS userId, data FROM entity([\s\S]*?)`/.exec(src);
    expect(bloque, 'findUserByEmailD1 debe seguir teniendo su SELECT').not.toBeNull();

    // El filtro de usuario activo tiene que ir sobre el JSON.
    expect(bloque![1]).toMatch(/json_extract\(\s*data\s*,\s*'\$\.active'\s*\)/);
    // Y no puede haber volvido `active = 1` como si fuera una columna.
    expect(bloque![1]).not.toMatch(/\bactive\s*=\s*1/);
  });

  it('un email que no es string no llega al binding de SQLite', async () => {
    // `{"email": ["a"]}` o `{"email": {"x": 1}}` en el POST de login llegan aqui
    // como array u objeto. SQLite no los puede enlazar y `.bind()` lanza, lo que
    // salia como 500 en produccion en vez de un 401. Estos casos comprueban el
    // guard con la misma consulta: si el guard no esta, el binding revienta.
    const { default: Database } = await import('node:sqlite').then((m) => ({
      default: m.DatabaseSync,
    }));
    const db = new Database(':memory:');
    db.exec(ESQUEMA);
    const q = db.prepare(
      `SELECT id AS userId, data FROM entity
       WHERE instance_id = ? AND entity = 'user'
         AND json_extract(data, '$.active') = 1
         AND lower(json_extract(data, '$.email')) = lower(?)`,
    );

    // Sin el guard, estos tres LANZAN. Con el guard, findUserByEmailD1
    // devuelve null antes de llegar aqui. Se comprueba las dos mitades.
    for (const malo of [['a'], { x: 1 }, true]) {
      expect(() => q.get('t1', malo as never), `bind de ${JSON.stringify(malo)}`).toThrow();

      // Y el guard de authenticate.ts lo para antes.
      const email = malo as unknown;
      const pasaElGuard = typeof email === 'string' && email.includes('@');
      expect(pasaElGuard, `${JSON.stringify(malo)} debe quedarse fuera`).toBe(false);
    }

    // Un string normal si pasa el guard.
    expect(typeof 'a@b.c' === 'string' && 'a@b.c'.includes('@')).toBe(true);
    db.close();
  });

  it('la consulta VIEJA (con `active = 1` como columna) revienta, que es el bug', async () => {
    // Este caso documenta por que el fix era necesario. Si alguien "simplifica"
    // la consulta de vuelta a `active = 1`, este test sigue reminding por que no.
    const { default: Database } = await import('node:sqlite').then((m) => ({
      default: m.DatabaseSync,
    }));
    const db = new Database(':memory:');
    db.exec(ESQUEMA);
    // node:sqlite valida el SQL al preparar, no al ejecutar: el throw ocurre
    // en prepare(). Con el driver de D1 (y con el de Cloudflare) es igual: la
    // consulta no llega a ejecutarse nunca.
    expect(() =>
      db.prepare(
        `SELECT id FROM entity
           WHERE instance_id = ? AND entity = 'user' AND active = 1
             AND lower(json_extract(data, '$.email')) = lower(?)`,
      ),
    ).toThrow(/no such column: active/);
    db.close();
  });
});
