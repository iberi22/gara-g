/**
 * tests/helpers/inlineSource.ts — leer una plantilla CON el texto de sus scripts inline.
 *
 * Desde el 2026-10-15 los cuerpos de los `<script is:inline>` (y los de los dos que eran
 * `define:vars`) viven en `src/lib/inline/*.js` y la plantilla los emite con
 * `set:html={...}` sobre un import con `?raw` (es lo que permite que la CSP lleve su
 * SHA-256: ver src/lib/csp.ts). Para los tests de ESTRUCTURA que comprobaban ese codigo
 * dentro del .astro, leer solo el .astro deja de verlo: esta funcion devuelve el texto de
 * la plantilla MAS el de cada fichero que importa con `?raw`, que es lo que acaba en el
 * `<script>` del navegador.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const RAW_IMPORT = /import\s+\w+\s+from\s+['"]([^'"]+)\?raw['"]/g;

/** Texto de la plantilla mas el de cada import `?raw` (resuelto contra ella). */
export function readWithRaw(absPath: string): string {
  const src = readFileSync(absPath, 'utf8');
  const extras: string[] = [];
  for (const m of src.matchAll(RAW_IMPORT)) {
    extras.push(readFileSync(resolve(dirname(absPath), m[1]), 'utf8'));
  }
  return extras.length > 0 ? `${src}\n${extras.join('\n')}` : src;
}
