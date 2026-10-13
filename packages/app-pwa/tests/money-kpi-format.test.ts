/**
 * tests/money-kpi-format.test.ts — N1 de la QA de entrega (2026-10-13).
 *
 * El panel mostraba `$9.81M` y `$28.60M` en los KPI de dinero (separador decimal ajeno al CLP
 * y truncado a millones con sufijo "M"), mientras en la misma tarjeta el kilometraje ya salia
 * `1.815.800`: `'$' + (x / 1_000_000).toFixed(2)` escrito a mano en el SSR y en el sondeo del
 * cliente. Es un test de ESTRUCTURA: el formato real lo fijan los tests de lib/market.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

/** El fichero sin comentarios: los comentarios que documentan el defecto no son el defecto. */
function code(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/** El frontmatter de un .astro (lo que se ejecuta en el servidor). */
function frontmatter(src: string): string {
  const lines = src.split('\n');
  const fin = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return lines.slice(1, fin).join('\n');
}

const FICHEROS = ['components/FleetList.astro', 'pages/fleet/analytics.astro'];

describe('los importes de la interfaz salen de formatMoney', () => {
  for (const f of FICHEROS) {
    it(`${f}: ningun importe se formatea a mano`, () => {
      const s = code(read(f));
      // El defecto exacto: dividir por un millon y concatenar el simbolo con toFixed.
      expect(s).not.toMatch(/1_000_000/);
      expect(s).not.toMatch(/toFixed\(2\)/);
      expect(s).not.toMatch(/' \$?'\s*\+/);
    });
  }

  it('el panel usa el formateador del mercado en el SSR y en el sondeo del cliente', () => {
    const s = read('components/FleetList.astro');
    // OJO: el import del FRONTMATTER es el que ejecuta el servidor. `formatMoney` en la
    // plantilla sin importarlo alli revienta la pagina en el Worker (ReferenceError) sin que
    // el build falle: los identificadores sueltos se empaquetan como globales.
    expect(frontmatter(s)).toMatch(/import \{[^}]*formatMoney[^}]*\} from '\.\.\/lib\/market\.js'/);
    expect(frontmatter(s)).toMatch(/import \{[^}]*formatNumber[^}]*\}/);
    expect(s).toMatch(/formatMoney\(serverStats\.totalFuelCost,\s*MARKET\)/);
    expect(s).toMatch(/formatMoney\(serverStats\.totalMaintCost,\s*MARKET\)/);
    // El sondeo del cliente usa el mismo formateador, no una copia del formato.
    expect(s).toMatch(/formatMoney\(s\.totalFuelCost,\s*MARKET\)/);
    expect(s).toMatch(/formatMoney\(s\.totalMaintCost,\s*MARKET\)/);
  });

  it('la analitica usa el mismo formateador en sus tres KPI y en la distribucion', () => {
    const s = read('pages/fleet/analytics.astro');
    expect(s).toMatch(/const cop = \(n: number\) => formatMoney\(n, MARKET\);/);
    expect((s.match(/\{cop\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
