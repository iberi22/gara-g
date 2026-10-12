/**
 * tests/sw-build-id.test.ts — el BUILD_ID del service worker cambia cuando cambia el build.
 *
 * Bug: `stampServiceWorkerBuildId` decia hashear el bundle pero hasheaba solo el sw.js, asi que
 * el id (y el nombre de la cache) no cambiaba entre despliegues y los estaticos sin hash en el
 * nombre (iconos, manifest) servidos "cache primero" no se refrescaban nunca.
 *
 * Los tests arman un `dist/client` falso en un dir temporal; no tocan el dist/ real.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..', '..');
const SW = "const BUILD_ID = '__BUILD_ID__';\nconst CACHE = `gara-g-${BUILD_ID}`;\n";

let dir = '';
let mod: { computeBuildId: (d: string, sw: string) => string; stampServiceWorkerBuildId: (d: string) => string | null };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gara-g-swid-'));
  mod = await import(pathToFileURL(resolve(root, 'scripts/sw-build-id.js')).href);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function client(files: Record<string, string>, sw = SW): string {
  const d = mkdtempSync(join(dir, 'client-'));
  for (const [rel, body] of Object.entries({ 'sw.js': sw, ...files })) {
    const full = join(d, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return d;
}

describe('stampServiceWorkerBuildId', () => {
  const base = { 'manifest.webmanifest': '{"name":"GARA-G"}', 'icons/192.png': 'PNG-A', '_astro/app.abc123.js': 'console.log(1)' };

  it('dos builds con distinto contenido de un asset sin hash producen ids distintos', () => {
    const a = client(base);
    const b = client({ ...base, 'icons/192.png': 'PNG-B' });
    expect(mod.stampServiceWorkerBuildId(a)).not.toBe(mod.stampServiceWorkerBuildId(b));
  });

  it('un build con un fichero de mas o de menos tambien cambia el id', () => {
    const a = client(base);
    const b = client({ ...base, 'robots.txt': 'x' });
    expect(mod.computeBuildId(a, SW)).not.toBe(mod.computeBuildId(b, SW));
  });

  it('el mismo contenido da el mismo id (determinista), sin importar donde este el dir', () => {
    expect(mod.computeBuildId(client(base), SW)).toBe(mod.computeBuildId(client(base), SW));
  });

  it('sustituye el placeholder por el id, y el id es corto y hexadecimal', () => {
    const d = client(base);
    const id = mod.stampServiceWorkerBuildId(d);
    expect(id).toMatch(/^[0-9a-f]{10}$/);
    const sw = readFileSync(join(d, 'sw.js'), 'utf-8');
    expect(sw).not.toContain('__BUILD_ID__');
    expect(sw).toContain(`const BUILD_ID = '${id}'`);
  });

  it('el sw.js ya sellado no cuenta en el hash (no se persigue la cola)', () => {
    const a = client(base);
    const idA = mod.computeBuildId(a, SW);
    writeFileSync(join(a, 'sw.js'), SW.replace('__BUILD_ID__', idA));
    expect(mod.computeBuildId(a, SW)).toBe(idA);
  });

  it('cambiar la logica del sw.js tambien cambia la cache', () => {
    const d = client(base);
    expect(mod.computeBuildId(d, SW)).not.toBe(mod.computeBuildId(d, `${SW}// otro\n`));
  });

  it('sin placeholder o sin sw.js no hace nada', () => {
    const d = client(base, 'const BUILD_ID = "ya";');
    expect(mod.stampServiceWorkerBuildId(d)).toBeNull();
    const empty = mkdtempSync(join(dir, 'vacio-'));
    expect(mod.stampServiceWorkerBuildId(empty)).toBeNull();
  });
});

describe('build-workers.js', () => {
  it('sella el SW con el hash de dist/client despues de normalizar', () => {
    const src = readFileSync(resolve(root, 'scripts/build-workers.js'), 'utf-8');
    expect(src).toContain("from './sw-build-id.js'");
    expect(src).toMatch(/stampServiceWorkerBuildId\(clientDir\)/);
    expect(src).toContain("'dist/client'");
  });
});
