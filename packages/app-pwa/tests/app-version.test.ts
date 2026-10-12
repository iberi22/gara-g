import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const layout = readFileSync(new URL('../src/layouts/FleetLayout.astro', import.meta.url), 'utf8');

describe('version visible', () => {
  it('es la de la release 0.1.1', () => {
    expect(pkg.version).toBe('0.1.1');
  });

  it('el pie del menu la lee de package.json y no la escribe a mano', () => {
    expect(layout).toContain("import { version as APP_VERSION } from '../../package.json'");
    expect(layout).toMatch(/footer-version">v\{APP_VERSION\}/);
    expect(layout).not.toMatch(/footer-version">v\d/);
  });
});
