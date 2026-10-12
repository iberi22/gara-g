/**
 * tests/tracked-imports.test.ts — todo import relativo de un fichero versionado apunta a
 * otro fichero versionado.
 *
 * El fallo que cubre: `.gitignore` ignoraba `AuiRenderer.svelte`, `lib/aui.ts`,
 * `lib/llm.ts` y `lib/mesh.ts` como "huerfanos de plantilla", pero `AuiInterface.svelte`
 * (versionado) los importa. En el disco del autor existian, asi que el build y el deploy
 * funcionaban; un clon limpio fallaba con `Could not resolve './AuiRenderer.svelte'`.
 * Ningun test lo veia porque la suite corre sobre el disco, no sobre lo versionado.
 *
 * Si `git` no esta disponible (tarball sin .git) el test se salta, no pasa en falso.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PKG = process.cwd();

function gitTracked(): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', 'src'], { cwd: PKG, encoding: 'utf8' });
    return new Set(out.split('\0').filter(Boolean).map((p) => resolve(PKG, p)));
  } catch {
    return null;
  }
}

const EXTS = ['', '.ts', '.js', '.svelte', '.astro', '.mjs', '/index.ts', '/index.js'];

/** Resuelve un especificador relativo a un fichero existente (sin importar si esta versionado). */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = EXTS.map((e) => base + e);
  // `./x.js` en TS apunta a `./x.ts`.
  if (/\.js$/.test(spec)) candidates.push(base.replace(/\.js$/, '.ts'));
  // Solo ficheros: `import '../engine'` apunta a `engine/index.ts`, no al directorio.
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const IMPORT_RE = /(?:import|export)\s[^'"`]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

describe('imports relativos versionados', () => {
  const tracked = gitTracked();

  it.skipIf(tracked === null)('ningun fichero versionado importa un fichero que git no tiene', () => {
    const missing: string[] = [];
    for (const file of tracked ?? []) {
      if (!/\.(ts|svelte|astro|mjs|js)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2];
        if (/\.(css|json|svg|png|jpg|webp|woff2?)$/.test(spec)) continue;
        const target = resolveSpecifier(file, spec);
        if (target && !tracked!.has(target)) {
          missing.push(`${relative(PKG, file)} → ${spec} (${relative(PKG, target)} no esta en git)`);
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it.skipIf(tracked === null)('el test encuentra ficheros (no pasa por no mirar nada)', () => {
    expect(tracked!.size).toBeGreaterThan(100);
    expect([...tracked!].some((f) => f.endsWith(join('components', 'AuiInterface.svelte')))).toBe(true);
  });
});
