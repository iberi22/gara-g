/**
 * Ningun archivo de src/ carga recursos de unpkg.com: la PWA instalada debe funcionar sin red.
 * Leaflet va empaquetado (import 'leaflet' + 'leaflet/dist/leaflet.css').
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('sin CDN unpkg', () => {
  const root = join(__dirname, '..', 'src');
  const files = walk(root).filter((p) => /\.(astro|svelte|ts|js|css|html)$/.test(p));

  it('hay archivos que revisar', () => expect(files.length).toBeGreaterThan(50));

  it('ningun archivo de src/ menciona unpkg.com', () => {
    const bad = files.filter((p) => /unpkg\.com/.test(readFileSync(p, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('el editor de geocercas importa Leaflet del paquete', () => {
    const src = readFileSync(join(root, 'pages/fleet/geofences/edit/[id].astro'), 'utf8');
    expect(src).toContain("import 'leaflet/dist/leaflet.css'");
    expect(src).toContain("import L from 'leaflet'");
  });
});
