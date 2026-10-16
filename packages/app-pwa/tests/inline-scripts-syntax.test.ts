/**
 * Los <script is:inline> y <script define:vars> de Astro llegan TAL CUAL al navegador: no
 * pasan por TypeScript. Un `as HTMLInputElement` en el de GenericTableAstro rompia el script
 * entero, y con el la busqueda y el CSV de todas las tablas de la app (2026-10-02). Esta
 * guardia los parsea como JavaScript.
 *
 * Desde el 2026-10-15 los cuerpos de esos scripts viven en `src/lib/inline/*.js` (fuera del
 * .astro, para que la CSP pueda llevar su SHA-256: ver tests/csp-inline-hashes.test.ts), asi
 * que aqui se parsean las dos cosas: lo que quede inline en una plantilla y los ficheros
 * de `src/lib/inline/`. Los dos caminos terminan en el mismo `<script>` del navegador.
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

/** Ficheros con el texto de un script inline (`?raw`): se parsean enteros, como programa. */
function rawScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return p.endsWith('.js') ? [p] : [];
  });
}

describe('scripts inline de Astro', () => {
  const files = astroFiles(join(__dirname, '..', 'src'));
  const rawFiles = rawScriptFiles(join(__dirname, '..', 'src', 'lib', 'inline'));

  it('hay archivos que revisar', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(rawFiles.length).toBeGreaterThanOrEqual(8);
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

  for (const file of rawFiles) {
    it(`src/lib/inline/${file.split('/inline/')[1]} es JavaScript valido`, () => {
      expect(() => new Function(readFileSync(file, 'utf-8'))).not.toThrow();
    });
  }
});
