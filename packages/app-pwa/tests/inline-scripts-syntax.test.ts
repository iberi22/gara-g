/**
 * Los <script is:inline> y <script define:vars> de Astro llegan TAL CUAL al navegador: no
 * pasan por TypeScript. Un `as HTMLInputElement` en el de GenericTableAstro rompia el script
 * entero, y con el la busqueda y el CSV de todas las tablas de la app (2026-10-02). Esta
 * guardia los parsea como JavaScript.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function astroFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? astroFiles(p) : p.endsWith('.astro') ? [p] : [];
  });
}

describe('scripts inline de Astro', () => {
  const files = astroFiles(join(__dirname, '..', 'src'));

  it('hay archivos que revisar', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    const blocks = [...src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(
      ([, attrs]) => /is:inline|define:vars/.test(attrs) && !/application\/ld\+json/.test(attrs),
    );
    if (blocks.length === 0) continue;
    it(`${file.split('/src/')[1]} es JavaScript valido`, () => {
      for (const [, , body] of blocks) {
        // define:vars envuelve el script en una funcion: se parsea como cuerpo de funcion.
        expect(() => new Function(body)).not.toThrow();
      }
    });
  }
});
