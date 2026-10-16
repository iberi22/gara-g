/**
 * tests/csp-built-bundle.test.ts — la CSP del build cubre los scripts inline del build.
 *
 * Contexto: la politica que Astro emite en cada pagina (`security.csp`) lleva la lista de
 * hashes que arma src/lib/csp.ts leyendo `src/lib/inline/*.js`, y las plantillas emiten esos
 * MISMOS ficheros con `?raw` + `set:html`. Si esa lista no llegase al bundle, o si un script
 * inline se colase sin hash, el navegador lo bloquearia y la app perderia esa funcion sin
 * decir nada. Este test lee el bundle REAL (`dist/`) para comprobarlo.
 *
 * Como deploy-bundle-safety.test.ts, NO entra en el `test` por defecto (el script de la PWA
 * lo excluye con `--exclude`): sin build no hay bundle, y si se invoca sin build FALLA a
 * proposito. Se ejecuta despues de `pnpm --filter gara-g-app-pwa build` (ver ci.yml).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cspConfig, inlineScriptTexts, scriptHashes } from '../src/lib/csp.js';
import { CSP_HTML_FALLBACK, CSP_NONE, SECURITY_HEADERS } from '../src/lib/securityHeaders.js';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Todo el texto del bundle (worker, chunks y assets del cliente). */
const bundle = walk(DIST)
  .filter((p) => /\.(mjs|js|cjs|json|html|_headers)$/.test(p))
  .map((p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

describe('CSP del bundle construido', () => {
  it('el build dejo dist/ con el worker y los assets', () => {
    expect(bundle.length).toBeGreaterThan(10_000);
  });

  it('el bundle lleva el SHA-256 de CADA script inline de la app', () => {
    const faltan = scriptHashes().filter((h) => !bundle.includes(h));
    expect(faltan, 'hashes de scripts inline que no llegaron al bundle').toEqual([]);
  });

  it('cada script inline llega al bundle por su import ?raw (el que emite set:html)', () => {
    // El texto se guarda como literal JS con los saltos escapados, asi que no se puede
    // buscar la cadena cruda: se comprueba el module id `?raw`, que es la prueba de que
    // Vite inlineo el fichero y la plantilla lo emite. Que ese texto sea byte a byte el
    // mismo que hashea src/lib/csp.ts lo garantiza tests/csp-inline-hashes.test.ts (los
    // dos leen el mismo fichero) mas el `?raw` de Vite.
    const faltan = inlineScriptTexts()
      .filter(({ file }) => !bundle.includes(`lib/inline/${file}?raw`))
      .map(({ file }) => file);
    expect(faltan, 'scripts inline cuyo ?raw no esta en el bundle').toEqual([]);
  });

  it('la config de la CSP no lleva unsafe-eval ni unsafe-inline en script-src', () => {
    const config = cspConfig();
    expect(config.directives.join('; ')).not.toContain('unsafe-eval');
    expect(config.directives.join('; ')).not.toContain("script-src 'unsafe-inline'");
    // El respaldo del middleware tampoco (se comprueba tambien aqui para que el build no
    // pueda publicar una cabecera floja). Ojo: el bundle SI menciona `unsafe-eval` en los
    // comentarios del propio modulo, asi que no se puede buscar la palabra en todo el texto.
    expect(CSP_HTML_FALLBACK).not.toContain('unsafe-eval');
  });

  it('el bundle lleva los origenes de Cloudflare Web Analytics (script + beacon)', () => {
    // El beacon lo inyecta Cloudflare en el edge: la unica prueba de que la CSP lo deja
    // pasar es que estos dos hosts lleguen al bundle del servidor.
    expect(bundle).toContain('static.cloudflareinsights.com');
    expect(bundle).toContain('https://cloudflareinsights.com');
    expect(cspConfig().scriptDirective.resources).toContain(
      'https://static.cloudflareinsights.com',
    );
    expect(CSP_HTML_FALLBACK).toContain('https://static.cloudflareinsights.com');
  });

  it('dist/client/_headers lleva las cabeceras de los assets estaticos', () => {
    const headers = readFileSync(join(DIST, 'client', '_headers'), 'utf8');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers, `falta ${name} en dist/client/_headers`).toContain(`${name}: ${value}`);
    }
    expect(headers).toContain(`Content-Security-Policy: ${CSP_NONE}`);
  });
});
