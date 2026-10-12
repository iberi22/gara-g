/**
 * tests/datos-honestos-paginas.test.ts — WAVE-32 issues 16, 18, 19 y 26 (estructura).
 *
 * Son invariantes de fuente: el comportamiento en navegador lo cubren los e2e
 * (empty-data, prerender-session, maintenance-calendar, responsive).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const leer = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

function ficheros(dir: string, ext: string[], acc: string[] = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) ficheros(p, ext, acc);
    else if (ext.some((x) => e.endsWith(x))) acc.push(p);
  }
  return acc;
}

describe('26 · ninguna pagina de sesion se prerenderiza', () => {
  // Con output:'server' una pagina prerenderizada se genera en build, sin Astro.locals: pierde el
  // email, el boton de salir y congela el contador de la campana. /api/** si puede declararlo.
  const paginas = ficheros(join(SRC, 'pages'), ['.astro']);

  it('hay paginas que auditar', () => expect(paginas.length).toBeGreaterThan(20));

  it.each(paginas.map((p) => p.slice(SRC.length)))('%s no declara prerender = true', (rel) => {
    const src = readFileSync(join(SRC, rel), 'utf8');
    expect(src).not.toMatch(/export\s+const\s+prerender\s*=\s*true/);
  });
});

describe('18 · sin series de ejemplo', () => {
  it('el dashboard no inventa kilometraje cuando no hay datos', () => {
    const s = leer('pages/fleet/index.astro');
    expect(s).not.toMatch(/label:\s*'Ene'/);
    expect(s).not.toContain('12000');
  });

  it('analitica no inventa combustible ni costo por tipo, y declara las 4 columnas', () => {
    const s = leer('pages/fleet/analytics.astro');
    expect(s).not.toMatch(/label:\s*'Ene'/);
    expect(s).not.toContain('350000');
    expect(s).not.toContain('800000');
    for (const k of ['plate', 'fuelDisplay', 'maintDisplay', 'totalDisplay']) {
      expect(s).toContain(`key: '${k}'`);
    }
  });
});

describe('16 · ningun grid impone un minimo mayor que el viewport', () => {
  const fuentes = [
    'pages/fleet/analytics.astro',
    'pages/fleet/index.astro',
    'pages/index.astro',
    'components/AuiInterface.svelte',
    'components/mercado/mercado.css',
    ...ficheros(join(SRC, 'components/v2v'), ['.svelte']).map((p) => p.slice(SRC.length + 1)),
    ...ficheros(join(SRC, 'components/mercado'), ['.svelte']).map((p) => p.slice(SRC.length + 1)),
  ];
  it.each(fuentes)('%s: todo minmax(Npx, …) va como minmax(min(Npx, 100%), …)', (rel) => {
    const malos = [...leer(rel).matchAll(/minmax\(\s*(\d+(?:\.\d+)?(?:px|rem))\s*,/g)].map((m) => m[0]);
    expect(malos).toEqual([]);
  });
});

describe('19 · calendario de mantenimiento', () => {
  const s = leer('pages/fleet/maintenance.astro');
  const css = s.slice(s.indexOf('<style>'));

  it('las clases g-cal* tienen reglas en el <style> de la pagina', () => {
    for (const c of ['.g-cal-grid', '.g-cal-weekday', '.g-cal-day', '.g-cal-day-today', '.g-cal-day-empty', '.g-cal-daynum', '.g-cal-dot', '.g-cal-badge', '.g-cal-badge-overdue', '.g-cal-upcoming', '.g-cal-empty', '.g-cal-filter']) {
      expect(css, c).toContain(c);
    }
    expect(css).toMatch(/\.g-cal-grid\s*\{[^}]*repeat\(7/);
  });

  it('el filtro no se envia solo al cambiar el select (WCAG 3.2.2): lleva boton Filtrar', () => {
    expect(s).not.toMatch(/onchange\s*=/);
    expect(s).toMatch(/<button type="submit"[^>]*aria-label=/);
  });

  it('"hoy" se calcula en hora local, no con toISOString (UTC)', () => {
    expect(s).not.toContain('today.toISOString()');
  });
});
