/**
 * tests/tenant-single-source.test.ts — W3: un solo identificador de tenant.
 *
 * Habia cuatro constantes distintas para el tenant de esta app:
 *
 *   'gara-g-default-instance'  middleware, lib/xavier, domain.config, FleetLayout
 *   'gara-g-default'           registro de usuarios
 *   'demo-flota'               fleetSeed y GenericTableAstro
 *
 * El caso grave no era la duplicacion, era resolveInstanceId: en produccion
 * devolvia 'demo-flota' cuando la sesion no traia instanceId, de modo que las
 * escrituras iban al tenant de los datos de ejemplo y no al del cliente. Los
 * datos del cliente quedaban separados y los informes mezclaban ambos.
 *
 * Regla: el tenant sale de la sesion o de la constante canonica. Si no hay,
 * falla; nunca un tenant inventado.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = resolve(HERE, '../src');

const CANONICAL = 'gara-g-default-instance';
const DEMO = 'demo-flota';

function read(path: string): string {
  return readFileSync(resolve(SRC, path), 'utf8');
}

/** Cuerpo del fichero, sin las lineas que son puro comentario. */
function code(path: string): string {
  return read(path)
    .split('\n')
    .filter((linea) => {
      const t = linea.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/**
 * Todos los ficheros de src/ que pueden declarar codigo, en rutas relativas a
 * src/. Antes el test solo miraba tres ficheros escritos a mano; si el literal
 * aparecia en un cuarto, nadie se enteraba.
 */
function todosLosFicherosSrc(): string[] {
  const out: string[] = [];
  const visitar = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entrada.name);
      if (entrada.isDirectory()) {
        visitar(abs);
      } else if (/\.(ts|astro|svelte)$/.test(entrada.name) && !entrada.name.endsWith('.test.ts')) {
        out.push(relative(SRC, abs));
      }
    }
  };
  visitar(SRC);
  return out.sort();
}

describe('W3 - el tenant tiene una sola fuente', () => {
  it('resolveInstanceId no devuelve el tenant demo en la rama de produccion', () => {
    const src = code('lib/fleetApi.ts');
    const desde = src.indexOf('export function resolveInstanceId');
    expect(desde).toBeGreaterThan(-1);

    const cuerpo = src.slice(desde, desde + 800);
    const corte = cuerpo.indexOf('production');
    expect(corte, 'la funcion debe distinguir desarrollo de produccion').toBeGreaterThan(-1);

    // Todo lo que hay despues del primer 'production' es lo que corre en
    // produccion: ahi no puede aparecer el tenant de los datos demo.
    const enProduccion = cuerpo.slice(corte);
    expect(enProduccion).not.toContain(DEMO);
    expect(enProduccion).not.toContain('return DEMO_INSTANCE_ID');
  });

  it('resolveInstanceId falla en vez de inventar un tenant', () => {
    expect(code('lib/fleetApi.ts')).toContain('throw new Error');
  });

  it('el registro de usuarios no usa un tenant inventado', () => {
    expect(code('pages/api/auth/register.ts')).not.toContain("gara-g-default'");
  });

  it('GenericTableAstro no cae al tenant demo por defecto', () => {
    const patron = /instanceId\s*=\s*.demo-flota./;
    expect(code('components/GenericTableAstro.astro')).not.toMatch(patron);
  });

  it('el literal del tenant aparece en UN solo fichero de src/', () => {
    // El contrato nuevo: el literal solo puede existir en domain.config.ts, que
    // es el archivo base de una app nueva. El test anterior daba por bueno que
    // middleware.ts y xavier.ts lo escribieran a mano, y esa duplicacion es
    // justamente lo que dejo alicates.tenant usando el valor equivocado.
    const conLiteral: string[] = [];
    for (const file of todosLosFicherosSrc()) {
      if (code(file).includes(`'${CANONICAL}'`)) conLiteral.push(file);
    }
    expect(conLiteral, 'solo domain.config.ts debe escribir el literal').toEqual([
      'lib/domain.config.ts',
    ]);
  });

  it('todo el que nombra un tenant importa la constante, no la inventa', () => {
    for (const file of todosLosFicherosSrc()) {
      const src = code(file);
      if (!src.includes('DEFAULT_INSTANCE_ID')) continue;
      // Si lo usa, tiene que haberlo importado: de domain.config.ts (la fuente)
      // o de xavier.ts, que la reexporta para no romper a sus consumidores.
      const esCanonico = file === 'lib/domain.config.ts';
      const desdeFuente =
        /import\s*\{[^}]*DEFAULT_INSTANCE_ID[^}]*\}\s*from\s*['"][^'"]*domain\.config['"]/.test(
          src,
        );
      // xavier.ts reexporta la constante. El path relativo varia ('./xavier.js'
      // desde lib/, '../../lib/xavier' desde una pagina), asi que se busca el
      // nombre del modulo, no un path concreto.
      const desdeReexport =
        /import\s*\{[^}]*DEFAULT_INSTANCE_ID[^}]*\}[\s\S]{0,20}from\s*['"][^'"]*xavier(\.js)?['"]/.test(
          src,
        );
      expect(
        esCanonico || desdeFuente || desdeReexport,
        `${file} usa DEFAULT_INSTANCE_ID sin importarlo de domain.config ni de xavier`,
      ).toBe(true);
    }
  });

  it('la constante canonica se define una vez y se reexporta', () => {
    expect(code('lib/domain.config.ts')).toContain(`instanceId: '${CANONICAL}'`);
    expect(code('lib/domain.config.ts')).toContain(
      'export const DEFAULT_INSTANCE_ID = domainConfig.instanceId',
    );
    // xavier.ts la reexporta para no romper a sus consumidores, no la redeclara.
    expect(read('lib/xavier.ts')).not.toContain(
      `export const DEFAULT_INSTANCE_ID = '${CANONICAL}'`,
    );
  });

  it('DEMO_INSTANCE_ID avisa de que es solo el tenant de los datos demo', () => {
    const src = read('lib/fleetSeed.ts');
    expect(src).toContain(`export const DEMO_INSTANCE_ID = '${DEMO}'`);
    expect(src).toMatch(/no es el tenant de la app/i);
  });

  it('ningun endpoint de la API lleva un tenant escrito a mano', () => {
    const dir = resolve(SRC, 'pages/api/fleet');
    if (!existsSync(dir)) return;
    const ofensores: string[] = [];
    for (const nombre of ['files', 'stats', 'vehicle', 'driver', 'document']) {
      const ruta = resolve(dir, `${nombre}.ts`);
      if (!existsSync(ruta)) continue;
      const src = code(`pages/api/fleet/${nombre}.ts`);
      if (src.includes(`'${DEMO}'`) || src.includes(`'${CANONICAL}'`)) {
        ofensores.push(nombre);
      }
    }
    expect(ofensores).toEqual([]);
  });
});
