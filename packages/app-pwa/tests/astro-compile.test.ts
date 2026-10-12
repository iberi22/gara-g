/**
 * tests/astro-compile.test.ts — todo .astro de src compila con el compilador de Astro.
 *
 * El fallo que cubre: un parentesis de mas en GenericTableAstro.astro (`(_, i) =>` escrito
 * `((_, i) =>`, llego con un parche de Jules) hacia que siete paginas de la flota
 * respondieran 500 con "CompilerError: Expected `,` or `)`". Ni vitest ni los tests de
 * estructura lo vieron porque nadie compilaba la plantilla; esto lo hace en ~1 s.
 *
 * Se usa el MISMO compilador que usa Astro (@astrojs/compiler-binding, resuelto desde el
 * paquete astro), no uno aparte: lo que pasa aqui es lo que pasa en `astro dev/build`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const fromAstro = createRequire(createRequire(import.meta.url).resolve('astro/package.json'));
const { compileAstroSync } = fromAstro('@astrojs/compiler-binding') as {
  compileAstroSync: (src: string, opts: { filename: string }) => {
    diagnostics: { severity: string; text: string; labels: { line: number }[] }[];
  };
};

function astroFiles(dir = SRC, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) astroFiles(p, acc);
    else if (e.endsWith('.astro')) acc.push(p);
  }
  return acc;
}

describe('plantillas .astro', () => {
  const files = astroFiles();

  it('hay plantillas que compilar', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('todas compilan sin errores', () => {
    const errors: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1);
      try {
        const { diagnostics } = compileAstroSync(readFileSync(f, 'utf8'), { filename: rel });
        for (const d of diagnostics) {
          if (d.severity === 'error') errors.push(`${rel}:${d.labels[0]?.line ?? '?'} ${d.text}`);
        }
      } catch (e) {
        errors.push(`${rel}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    expect(errors, 'plantillas que no compilan').toEqual([]);
  });
});
