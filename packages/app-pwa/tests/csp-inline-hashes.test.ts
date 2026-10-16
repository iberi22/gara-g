/**
 * tests/csp-inline-hashes.test.ts — la CSP y los scripts inline no pueden desincronizarse.
 *
 * El fallo que cubre: un `<script is:inline>` (o un `define:vars`) escrito a mano en una
 * plantilla NO lleva hash en ninguna parte, asi que con una CSP sin `'unsafe-inline'` el
 * navegador lo bloquea y la funcion que implementa muere en silencio (busqueda, CSV,
 * tema, sesion...). Y `define:vars` es peor que inutil: interpola datos de la request en
 * el propio script, de modo que su hash no existe hasta que la pagina se renderiza.
 *
 * La regla que se comprueba aqui:
 *   1. todo script inline de la app sale de `set:html={CONSTANTE}` (fichero en
 *      `src/lib/inline/` o constante exportada), nunca de un cuerpo literal ni de
 *      `define:vars`;
 *   2. su SHA-256 esta en la lista que consume `security.csp` (src/lib/csp.ts);
 *   3. cada fichero de `src/lib/inline/` se importa con `?raw` desde alguna plantilla
 *      (un fichero suelto sin plantilla que lo emita es un script que ya no corre).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cspConfig, inlineScriptTexts, scriptHashes, sha256 } from '../src/lib/csp.js';
import { GENERATED_INLINE_SCRIPTS } from '../src/lib/inline/prefs-bootstrap';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const INLINE_DIR = join(SRC, 'lib', 'inline');

function walk(dir: string, ext: string[] = ['.astro', '.svelte', '.ts', '.js']): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, ext) : ext.some((e) => p.endsWith(e)) ? [p] : [];
  });
}

const rel = (p: string) => relative(ROOT, p);

/** Scripts inline (<script …>con cuerpo</script>) de un fichero de plantilla. */
function scriptsInline(src: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script[^>]*>/gi)) {
    const attrs = m[1];
    if (!/is:inline|define:vars/.test(attrs)) continue;
    if (/application\/ld\+json/.test(attrs)) continue;
    out.push({ attrs, body: m[2] });
  }
  return out;
}

describe('scripts inline hasheados por la CSP', () => {
  it('hay scripts que auditar', () => {
    expect(inlineScriptTexts().length).toBeGreaterThanOrEqual(8);
    expect(scriptHashes().length).toBe(inlineScriptTexts().length + GENERATED_INLINE_SCRIPTS.length);
  });

  it('el SHA-256 de cada fichero de src/lib/inline esta en la lista de la CSP', () => {
    const hashes = new Set(scriptHashes());
    const faltan = inlineScriptTexts()
      .filter(({ text }) => !hashes.has(sha256(text)))
      .map(({ file }) => file);
    expect(faltan, 'ficheros de src/lib/inline sin hash en security.csp').toEqual([]);
  });

  it('los scripts generados por codigo tambien estan hasheados', () => {
    const hashes = new Set(scriptHashes());
    for (const text of GENERATED_INLINE_SCRIPTS) {
      expect(hashes.has(sha256(text))).toBe(true);
    }
  });

  it('la lista de hashes no tiene repetidos y usa SHA-256', () => {
    const hashes = scriptHashes();
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const h of hashes) expect(h).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
  });

  it('cada fichero de src/lib/inline es JavaScript valido', () => {
    for (const { file, text } of inlineScriptTexts()) {
      expect(() => new Function(text), `${file} no parsea`).not.toThrow();
    }
  });

  it('cada fichero de src/lib/inline lo emite alguna plantilla (?raw)', () => {
    const plantillas = walk(SRC, ['.astro']).map((p) => readFileSync(p, 'utf8')).join('\n');
    const sinEmisor = inlineScriptTexts()
      .filter(({ file }) => !plantillas.includes(`lib/inline/${file}?raw`))
      .map(({ file }) => file);
    expect(sinEmisor, 'ficheros de src/lib/inline que ninguna plantilla importa').toEqual([]);
  });

  it('ninguna plantilla tiene un script inline con cuerpo literal', () => {
    const culpables: string[] = [];
    for (const p of walk(SRC, ['.astro', '.svelte'])) {
      for (const { body } of scriptsInline(readFileSync(p, 'utf8'))) {
        if (body.trim() !== '') culpables.push(rel(p));
      }
    }
    // Un cuerpo literal no lo hashea Astro: la CSP lo bloquearia en produccion.
    expect(culpables, 'plantillas con script inline literal (usa set:html y ?raw)').toEqual([]);
  });

  it('ninguna plantilla usa define:vars', () => {
    const culpables = walk(SRC, ['.astro', '.svelte'])
      .filter((p) => /<script\b[^>]*define:vars/.test(readFileSync(p, 'utf8')))
      .map(rel);
    // define:vars interpola datos en el script: su hash no puede existir en el build.
    expect(culpables, 'plantillas con define:vars (usa un bloque JSON + set:html)').toEqual([]);
  });

  it('los dos scripts que eran define:vars leen sus datos de un bloque JSON', () => {
    const tabla = readFileSync(join(SRC, 'components', 'GenericTableAstro.astro'), 'utf8');
    expect(tabla).toContain('type="application/json" data-gtable-config');
    expect(tabla).toContain('set:html={gtableConfigJson}');
    expect(tabla).toMatch(/import genericTableScript from '.*generic-table\.js\?raw'/);

    const catalogo = readFileSync(join(SRC, 'pages', 'fleet', 'catalog.astro'), 'utf8');
    expect(catalogo).toContain('type="application/json" data-catalog-config');
    expect(catalogo).toContain('set:html={catalogConfigJson}');
    expect(catalogo).toMatch(/import catalogSearchScript from '.*catalog-search\.js\?raw'/);
  });

  it('los datos del bloque JSON no pueden cerrar el <script>', () => {
    // El `<` se escapa a `\u003c` (escape JSON valido): una placa o una nota con
    // "</script>" no puede romper la pagina.
    for (const fichero of ['components/GenericTableAstro.astro', 'pages/fleet/catalog.astro']) {
      const src = readFileSync(join(SRC, fichero), 'utf8');
      const bloque = src.match(/const \w+ConfigJson = JSON\.stringify\(\{[\s\S]*?\}\)\.replace\([^)]*\)/);
      expect(bloque, `${fichero}: no se encontro el JSON de configuracion`).not.toBeNull();
      expect(bloque?.[0]).toContain("/</g, '\\\\u003c'");
    }
  });

  it('la config de security.csp es la esperada', () => {
    const config = cspConfig('https://mesh.swal.network/');
    expect(config.algorithm).toBe('SHA-256');
    expect(config.scriptDirective.hashes).toEqual(scriptHashes());
    expect(config.directives.join('; ')).toContain('wss://mesh.swal.network');
    expect(config.directives.join('; ')).not.toContain('unsafe-eval');
    expect(config.scriptDirective.hashes.length).toBeGreaterThanOrEqual(9);
    // Los `style="..."` los gobierna style-src-attr: sin esto, el shell pierde el fondo.
    expect(config.styleDirective.resources).toEqual([{ resource: "'unsafe-inline'", kind: 'attribute' }]);
  });

  it('astro.config.mjs usa security.csp con esa config', () => {
    const config = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
    expect(config).toContain("import { cspConfig } from './src/lib/csp'");
    expect(config).toContain('security: { csp: cspConfig() }');
  });

  it('src/lib/csp.ts (node:crypto) no lo importa codigo de runtime', () => {
    const culpables = walk(SRC)
      .filter((p) => p !== join(SRC, 'lib', 'csp.ts'))
      .filter((p) => /from '[^']*lib\/csp(\.js)?'/.test(readFileSync(p, 'utf8')))
      .map(rel);
    // Importarlo desde el Worker o el navegador arrastraria node:crypto al bundle.
    expect(culpables).toEqual([]);
  });
});
