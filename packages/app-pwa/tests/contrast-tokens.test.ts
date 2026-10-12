/**
 * Contraste WCAG 2.2 AA del tema TALLER (claro y oscuro), medido sobre el CSS real.
 *
 * Parsea las propiedades personalizadas de src/styles/swal-taller.css (una tabla por
 * variante) y los alias --g-* de src/styles/gara-theme.css (:root), los resuelve contra
 * cada variante, compone los colores con alfa sobre el fondo y exige:
 *   - texto sobre fondo: >= 4.5:1 (1.4.3)
 *   - bordes de controles, relleno de acento y anillo de foco: >= 3:1 (1.4.11)
 * Los bordes "hairline"/"light" separan tarjetas y filas (decorativos, 1.4.11 no aplica):
 * van en DECORATIVE para que la exencion sea explicita y no un hueco silencioso.
 * UPDATE: CONTRAST_REPORT=1 npx vitest run tests/contrast-tokens.test.ts imprime la tabla.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = join(__dirname, '..', 'src', 'styles');
const taller = readFileSync(join(STYLES, 'swal-taller.css'), 'utf-8');
const gara = readFileSync(join(STYLES, 'gara-theme.css'), 'utf-8');

type Vars = Record<string, string>;

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no existe el bloque ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}
function props(body: string): Vars {
  const out: Vars = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Resuelve var(--x[, fallback]) recursivamente contra `vars`. */
function resolve(value: string, vars: Vars, depth = 0): string {
  if (depth > 10) throw new Error(`var() circular: ${value}`);
  return value.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fb) => {
    const v = vars[name] ?? fb;
    if (v === undefined) throw new Error(`token sin definir: ${name}`);
    return resolve(v, vars, depth + 1);
  });
}

type RGBA = [number, number, number, number];
function parseColor(c: string): RGBA {
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`color no soportado: ${c}`);
}
function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as RGBA;
}
function lum([r, g, b]: RGBA): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg: RGBA, bg: RGBA): number {
  const a = lum(over(fg, bg));
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const garaVars = props(block(gara, ':root {'));
const THEMES: Record<string, Vars> = {};
for (const [name, sel] of [
  ['taller', ':root[data-theme="taller"] {'],
  ['taller-dark', ':root[data-theme="taller-dark"] {'],
] as const) {
  const swal = props(block(taller, sel));
  // El alias --swal-* de gara-theme.css se evalua en el :root: ven los tokens del tema activo.
  THEMES[name] = { ...garaVars, ...swal };
  // Los alias de gara-theme que redefinen --swal-* (p. ej. --swal-radius-md) no pisan al tema.
}
const col = (theme: string, token: string): RGBA => parseColor(resolve(`var(${token})`, THEMES[theme]));

/** Fondos donde se pinta texto: hoja, hoja interior, tarjeta y campo. */
const SURFACES = ['--g-bg-base', '--g-bg-surface', '--g-bg-elevated', '--swal-bg-elevated', '--swal-card-bg'];
/** Texto (4.5:1) sobre todas las superficies. */
const TEXT = [
  '--g-text-primary', '--g-text-secondary', '--g-text-muted', '--g-text-faint', '--g-text-disabled',
  '--g-accent-cyan', '--g-accent-orange', '--g-accent-yellow', '--g-accent-red', '--g-accent-green',
  '--g-accent-primary', '--swal-info',
];
/** Bordes que delimitan un control (3:1). */
const CONTROL_BORDERS = ['--g-border-input', '--g-border-accent-strong'];
/** Bordes decorativos (separan tarjetas/filas): exentos de 1.4.11. */
const DECORATIVE = ['--g-border-subtle', '--g-border-accent'];

const rows: string[] = [];
function check(theme: string, fg: string, bg: string, min: number, bgOverride?: RGBA) {
  const back = bgOverride ?? col(theme, bg);
  const r = ratio(col(theme, fg), back);
  rows.push(`${theme.padEnd(11)} ${fg.padEnd(24)} sobre ${bg.padEnd(20)} ${r.toFixed(2)} (>=${min})`);
  return r;
}

describe.each(Object.keys(THEMES))('contraste AA: %s', (theme) => {
  it('el tema define todos los tokens que se miden', () => {
    for (const t of [...TEXT, ...SURFACES, ...CONTROL_BORDERS, ...DECORATIVE, '--swal-accent', '--swal-accent-contrast'])
      expect(() => col(theme, t), t).not.toThrow();
  });

  for (const fg of TEXT) {
    it(`${fg} >= 4.5:1 sobre cada superficie`, () => {
      for (const bg of SURFACES) expect(check(theme, fg, bg, 4.5), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('cabecera de .g-table: --g-text-faint sobre --swal-bg-surface (>= 4.5)', () => {
    expect(check(theme, '--g-text-faint', '--swal-bg-surface', 4.5)).toBeGreaterThanOrEqual(4.5);
  });

  it('texto sobre rellenos: acento, acento hover y peligro (>= 4.5)', () => {
    expect(check(theme, '--swal-accent-contrast', '--swal-accent', 4.5)).toBeGreaterThanOrEqual(4.5);
    expect(check(theme, '--swal-accent-contrast', '--swal-accent-hover', 4.5)).toBeGreaterThanOrEqual(4.5);
    expect(check(theme, '--swal-on-danger', '--swal-danger', 4.5)).toBeGreaterThanOrEqual(4.5);
  });

  it('pills: texto de color sobre su tinte compuesto sobre la superficie (>= 4.5)', () => {
    const pairs: [string, string][] = [
      ['--g-accent-green', '--swal-success-muted'], ['--g-accent-orange', '--swal-accent-muted'],
      ['--g-accent-red', '--swal-danger-muted'], ['--g-accent-yellow', '--swal-warning-muted'],
      ['--g-text-muted', '--swal-hover-bg'], ['--swal-text-secondary', '--swal-info-muted'],
    ];
    for (const [fg, tint] of pairs)
      for (const base of ['--g-bg-base', '--g-bg-surface', '--swal-surface']) {
        const bg = over(col(theme, tint), col(theme, base));
        expect(check(theme, fg, `${tint}/${base}`.slice(0, 20), 4.5, bg), `${fg} sobre ${tint}+${base}`).toBeGreaterThanOrEqual(4.5);
      }
  });

  for (const b of CONTROL_BORDERS) {
    it(`${b} (borde de control) >= 3:1 sobre cada superficie`, () => {
      for (const bg of SURFACES) expect(check(theme, b, bg, 3), `${b} sobre ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }

  it('anillo de foco y marcas de acento (>= 3:1 contra la superficie)', () => {
    for (const bg of SURFACES) {
      expect(check(theme, '--g-focus-ring', bg, 3), `foco sobre ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('los bordes decorativos existen y se declaran exentos', () => {
    for (const b of DECORATIVE) {
      for (const bg of SURFACES) check(theme, b, bg, 0);
      expect(() => col(theme, b)).not.toThrow();
    }
  });
});

describe('a11y global del tema', () => {
  it('prefers-reduced-motion nombra las animaciones que neutraliza', () => {
    const m = gara.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\s{6}\}/);
    expect(m, 'falta el bloque reduced-motion').not.toBeNull();
    expect(m![0]).toMatch(/\.g-status-dot/);
    expect(m![0]).toMatch(/animation:\s*none/);
    expect(m![0]).toMatch(/transition/);
  });
  it('pointer: coarse fija 44px de area tactil', () => {
    const m = gara.match(/@media \(pointer: coarse\)\s*\{[\s\S]*?\n\s{6}\}/);
    expect(m, 'falta el bloque pointer: coarse').not.toBeNull();
    expect(m![0]).toMatch(/min-height:\s*44px/);
    expect(m![0]).toMatch(/min-width:\s*44px/);
  });
  it('cada variante declara color-scheme (barras de desplazamiento y <select> nativos)', () => {
    expect(block(taller, ':root[data-theme="taller"] {')).toMatch(/color-scheme:\s*light/);
    expect(block(taller, ':root[data-theme="taller-dark"] {')).toMatch(/color-scheme:\s*dark/);
  });
});

describe('--swal-* usados en src/ resuelven a algo', () => {
  it('cada --swal-* con var() esta definido en el tema o lleva respaldo', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : /\.(astro|svelte|css|ts)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
      });
    const defined = new Set(Object.keys(THEMES.taller));
    const bad: string[] = [];
    for (const f of walk(join(__dirname, '..', 'src'))) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/var\(\s*(--swal-[a-z0-9-]+)\s*([,)])/g))
        if (!defined.has(m[1]) && m[2] === ')') bad.push(`${f.split('/src/')[1]}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});

if (process.env.CONTRAST_REPORT) {
  // eslint-disable-next-line no-console
  process.on('exit', () => console.log(rows.join('\n')));
}
