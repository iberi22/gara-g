import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * tests/deploy-build-order.test.ts — el build llama al normalizador DESPUES de astro build.
 *
 * Contexto: `scripts/build-workers.js` envuelve a `astro build` y normaliza
 * dist/server/wrangler.json al terminar. El orden importa: astro regenera ese
 * fichero desde cero, asi que si el normalizador corre antes, el bundle que lee
 * `wrangler deploy` sale sin D1, sin R2, sin ENVIRONMENT y con el nombre del
 * proyecto en vez del worker — con exit 0 en el build.
 *
 * Este fichero solo lee el codigo del build (no necesita dist/), asi que corre
 * en la suite unitaria por defecto. El contenido real del bundle lo audita
 * tests/deploy-bundle-safety.test.ts, que se invoca aparte despues del build.
 */
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BUILD_SCRIPT = resolve(ROOT, '../../scripts/build-workers.js');

describe('el build llama al normalizador DESPUES de astro build', () => {
  it('build-workers.js invoca normalize-wrangler-config.mjs', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf-8');
    expect(src, 'el build no llama al normalizador').toContain('normalize-wrangler-config.mjs');
  });

  it('el normalizador se invoca despues de astro build, no antes', () => {
    // Este es el fallo concreto: en el orden contrario, astro regenera
    // wrangler.json y deja el bundle roto sin que nadie se entere.
    const src = readFileSync(BUILD_SCRIPT, 'utf-8');
    const iBuild = src.indexOf("'astro', 'build'");
    const iNorm = src.lastIndexOf('normalize-wrangler-config.mjs');
    expect(iBuild, 'no se encuentra la invocacion de astro build').toBeGreaterThan(-1);
    expect(iNorm, 'no se encuentra la invocacion del normalizador').toBeGreaterThan(-1);
    expect(iNorm, 'el normalizador tiene que correr DESPUES del build').toBeGreaterThan(iBuild);
  });

  it('el build aborta si el normalizador falla, en vez de dejar un bundle inseguro', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf-8');
    expect(src).toMatch(/normalize\.status\s*!==\s*0/);
    expect(src).toMatch(/Refusing to continue|process\.exit/);
  });
});
