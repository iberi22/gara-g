// scripts/sw-build-id.js — Sella el BUILD_ID del service worker con un hash del build real.
//
// El SW de public/ se copia literal a dist/client/sw.js con el placeholder __BUILD_ID__, y su
// cache se llama `gara-g-<BUILD_ID>`. Si el id no cambia entre despliegues, los estaticos que
// el SW sirve "cache primero" y que no llevan hash en el nombre (iconos, manifest...) no se
// refrescan nunca. Por eso el id sale de TODO lo construido en dist/client, no del sw.js solo.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PLACEHOLDER = '__BUILD_ID__';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Hash corto del build: rutas relativas ordenadas + hash del contenido de cada fichero de
 * `clientDir`, sin sw.js (lleva el propio id). Del sw.js entra su codigo ANTES del sellado
 * (con el placeholder), para que cambiar la logica del SW tambien cambie la cache.
 * Determinista: no depende del orden del disco, de fechas ni de la ruta absoluta.
 */
export function computeBuildId(clientDir, swSource) {
  const files = walk(clientDir)
    .map((f) => ({ f, rel: relative(clientDir, f).split(sep).join('/') }))
    .filter(({ rel }) => rel !== 'sw.js')
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash('sha256');
  for (const { f, rel } of files) {
    h.update(`${rel}\0${createHash('sha256').update(readFileSync(f)).digest('hex')}\n`);
  }
  h.update(`sw.js\0${createHash('sha256').update(swSource).digest('hex')}\n`);
  return h.digest('hex').slice(0, 10);
}

/** Sustituye __BUILD_ID__ en `<clientDir>/sw.js`. Devuelve el id, o null si no habia nada que sellar. */
export function stampServiceWorkerBuildId(clientDir) {
  const swPath = join(clientDir, 'sw.js');
  if (!existsSync(swPath)) {
    console.warn('[build-workers] dist/client/sw.js no existe; se omite el sellado');
    return null;
  }
  const source = readFileSync(swPath, 'utf-8');
  if (!source.includes(PLACEHOLDER)) {
    console.log('[build-workers] sw.js ya sin placeholder');
    return null;
  }
  const id = computeBuildId(clientDir, source);
  writeFileSync(swPath, source.replaceAll(PLACEHOLDER, id));
  console.log(`[build-workers] sw.js build id = ${id}`);
  return id;
}
