/**
 * tests/astro-frontmatter-only-imports.test.ts — nada de codigo de servidor en
 * la plantilla de un .astro.
 *
 * El fallo que cubre: `GenericTableAstro.astro` tenia el frontmatter cerrado en
 * la linea 74 y en la 77, ya en la plantilla, un
 * `import { DEFAULT_INSTANCE_ID } from '../lib/xavier.js';`. Astro evalua la
 * plantilla, asi que en vez de romperse emits el texto del import dentro del
 * HTML, que se renderiza como contenido visible en la primera celda de la
 * tabla. Once paginas de flota usan este componente.
 *
 * El componente ya importaba la constante correctamente en su frontmatter (L43),
 * asi que el de la plantilla era un duplicado huerfano: borrarlo no cambia nada
 * del comportamiento esperado.
 *
 * Estos tests son de ESTRUCTURA de fichero, no de comportamiento: no pueden
 * ejecutarse como una ruta, y no pretende(n) demostrar autorizacion ni nada de eso.
 * Lo que fijan es una invariante de un solo tipo: dentro de la plantilla de un
 * .astro solo hay marcado, sin sentencias de JavaScript de servidor.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** Devuelve lineas {n, texto} del frontmatter (entre los dos ---). */
function frontmatter(file: string): { n: number; texto: string }[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const fin = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return lines.slice(1, fin === -1 ? lines.length : fin).map((t, i) => ({ n: i + 2, texto: t }));
}

/** Devuelve lineas {n, texto} de la plantilla (despues del --- de cierre). */
function plantilla(file: string): { n: number; texto: string }[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const fin = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  const desde = fin === -1 ? lines.length : fin + 1;
  return lines.slice(desde).map((t, i) => ({ n: desde + i + 1, texto: t }));
}

function astroFiles(dir = SRC, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) astroFiles(p, acc);
    else if (e.endsWith('.astro')) acc.push(p);
  }
  return acc;
}

describe('ningun .astro ejecuta codigo de servidor en su plantilla', () => {
  const ficheros = astroFiles();

  it('ha encontrado ficheros que auditar', () => {
    expect(ficheros.length).toBeGreaterThan(10);
  });

  it('no hay import de codigo de servidor fuera de <script> ni del frontmatter', () => {
    const culpables: string[] = [];
    for (const f of ficheros) {
      // Un import dentro de <script> es legitimo: es codigo de cliente, y Astro
      // lo empaqueta y lo procesa. Lo que no puede pasar es un import de
      // modulo de servidor en el marcado, que se emite como texto visible.
      let dentroDeScript = false;
      for (const { n, texto } of plantilla(f)) {
        if (/<script[\s>]/.test(texto)) dentroDeScript = true;
        else if (/<\/script>/.test(texto)) dentroDeScript = false;

        if (dentroDeScript) continue;
        if (/^\s*import\s+[\w*{]/.test(texto) && !/^\s*import\s+type\b/.test(texto)) {
          culpables.push(`${f}:${n}: ${texto.trim()}`);
        }
      }
    }
    expect(culpables, 'imports fuera del frontmatter y fuera de <script>').toEqual([]);
  });

  it('el componente de la tabla usa la constante del frontmatter, no uno en su plantilla', () => {
    const f = join(SRC, 'components/GenericTableAstro.astro');
    const enFm = frontmatter(f).filter((l) => l.texto.includes('DEFAULT_INSTANCE_ID'));
    const enTmpl = plantilla(f).filter((l) => l.texto.includes('DEFAULT_INSTANCE_ID'));

    expect(enFm.length, 'el frontmatter debe importar y usar la constante').toBeGreaterThan(0);
    expect(enTmpl, 'la plantilla no debe mencionarla').toEqual([]);
  });
});
