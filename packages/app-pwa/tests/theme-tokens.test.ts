/**
 * Tema TALLER de @swal/ui (src/styles/swal-taller.css) — guardias.
 *
 * 1. Las dos variantes (taller / taller-dark) definen EXACTAMENTE los mismos tokens: un
 *    token que solo existe en una deja la otra con el valor del tema anterior.
 * 2. Todo documento HTML de la app arranca el tema (ThemeBootstrap) y nace con data-theme.
 * 3. Trinquete de colores fijos: ningun .astro/.svelte puede tener MAS colores literales
 *    (#hex, rgb/rgba) fuera de var() que su linea base (tests/theme-color-baseline.json);
 *    un archivo nuevo debe tener cero. Al migrar un archivo a tokens, baja su numero en la
 *    linea base (`UPDATE_THEME_BASELINE=1 npx vitest run tests/theme-tokens.test.ts`).
 *    Los valores de respaldo dentro de var(--x, #hex) no cuentan.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASELINE = join(__dirname, 'theme-color-baseline.json');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
  });
}

function tokensOf(css: string, selector: string): string[] {
  const start = css.indexOf(selector);
  const body = css.slice(start, css.indexOf('}', start));
  return [...body.matchAll(/(--swal-[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();
}

/** Colores literales fuera de var(): quita los var(...) (con sus respaldos) y cuenta. */
export function literalColors(source: string): number {
  let s = source;
  // Quitar var(...) anidados de dentro hacia fuera.
  for (let i = 0; i < 5; i++) s = s.replace(/var\([^()]*\)/g, '');
  const hex = s.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b(?![\w-])/g) ?? [];
  const fn = s.match(/rgba?\([^)]*\)/g) ?? [];
  return hex.length + fn.length;
}

describe('tema taller de @swal/ui', () => {
  const css = readFileSync(join(SRC, 'styles/swal-taller.css'), 'utf-8');

  it('las dos variantes definen los mismos tokens', () => {
    const light = tokensOf(css, ':root[data-theme="taller"] {');
    const dark = tokensOf(css, ':root[data-theme="taller-dark"] {');
    expect(light.length).toBeGreaterThan(50);
    expect(dark).toEqual(light);
  });

  it('solo define tokens --swal-* y clases .swal-* (listo para portar al core)', () => {
    const props = [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect(props.every((p) => p.startsWith('--swal-'))).toBe(true);
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const classes = [...rules.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
    expect(classes.every((c) => c.startsWith('swal-') || c === 'is-active')).toBe(true);
  });

  it('cada documento HTML arranca el tema', () => {
    // Todo .astro que abre <html> en su plantilla, no solo los layouts: /alerts y /documents
    // (paginas heredadas fuera de FleetLayout) salian sin tema y nadie lo vio porque esta
    // lista era fija. Excepciones: el propio bootstrap y fleet/users, cuyo <html> esta dentro
    // del texto de la pagina 403 (la pagina normal usa FleetLayout).
    const SKIP = new Set(['components/theme/ThemeBootstrap.astro', 'pages/fleet/users/index.astro']);
    const roots = files(SRC, /\.astro$/)
      .map((f) => relative(SRC, f))
      .filter((f) => !SKIP.has(f) && /^\s*<html\b/m.test(readFileSync(join(SRC, f), 'utf-8')));
    expect(roots.length).toBeGreaterThanOrEqual(5);
    for (const f of roots) {
      const src = readFileSync(join(SRC, f), 'utf-8');
      expect(src, f).toContain('<ThemeBootstrap />');
      expect(src, f).toMatch(/<html[^>]*data-theme="taller"/);
    }
  });
});

describe('trinquete de colores fijos', () => {
  const all = files(SRC, /\.(astro|svelte)$/).map((f) => relative(ROOT, f));
  const counts = Object.fromEntries(all.map((f) => [f, literalColors(readFileSync(join(ROOT, f), 'utf-8'))]));

  if (process.env.UPDATE_THEME_BASELINE === '1' || !existsSync(BASELINE)) {
    const nonZero = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0).sort());
    writeFileSync(BASELINE, `${JSON.stringify(nonZero, null, 2)}\n`);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as Record<string, number>;

  it('cuenta solo colores fuera de var()', () => {
    expect(literalColors('color: var(--a, #fff); background: #0a0a0c; border: rgba(0,0,0,.1)')).toBe(2);
    expect(literalColors('color: var(--a, var(--b, #fff));')).toBe(0);
  });

  for (const f of all) {
    it(`${f} no agrega colores fijos`, () => {
      expect(counts[f], `${f}: ${counts[f]} colores literales (linea base ${baseline[f] ?? 0}). Usa tokens --swal-* / --g-*.`).toBeLessThanOrEqual(
        baseline[f] ?? 0,
      );
    });
  }
});
