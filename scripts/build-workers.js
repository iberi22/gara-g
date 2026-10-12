// scripts/build-workers.js — Stub builder + post-build cleanup para GARA-G SSR en Cloudflare Workers
// Resuelve:
//   1) @cloudflare/vite-plugin valida main en wrangler.toml ANTES de que el build genere dist/_worker.js/index.js
//      → crear el stub ANTES del build
//   2) El stub se borra con el build, pero dist/.assetsignore también
//      → re-crear .assetsignore para que wrangler deploy no rechace el _worker.js
//   3) wrangler deploy usa el entry real (dist/server/entry.mjs) — el stub es solo para validación
//   4) [ai] binding en wrangler.toml activa remote proxy mode en @cloudflare/vite-plugin durante astro build;
//      se comenta temporalmente en offline build y se restaura al finalizar.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stampServiceWorkerBuildId } from './sw-build-id.js';
import { wranglerToml } from './infra-config.mjs';

const rootDir = resolve(dirname(import.meta.url.replace('file://', '')), '..');
const appDir = resolve(rootDir, 'packages/app-pwa');
const stubPath = resolve(appDir, 'dist/_worker.js/index.js');
const assetsIgnorePath = resolve(appDir, 'dist/.assetsignore');
const clientDir = resolve(appDir, 'dist/client');
// wrangler.toml real (gitignored) -> private/infra/wrangler.toml -> wrangler.example.toml.
// Ver scripts/infra-config.mjs. Con la plantilla el build sale, pero el bundle NO es desplegable.
const wrangler = wranglerToml();
const wranglerPath = wrangler.path;

function ensureStub() {
  if (!existsSync(stubPath)) {
    mkdirSync(dirname(stubPath), { recursive: true });
    writeFileSync(stubPath, 'export default { fetch(request, env) { return fetch(request); } };\n');
    console.log('[build-workers] Created worker stub at dist/_worker.js/index.js');
  } else {
    console.log('[build-workers] Worker stub already exists');
  }
}

function ensureAssetsIgnore() {
  // _worker.js NO debe subirse como asset — wrangler deploy lo lee como entrypoint
  writeFileSync(assetsIgnorePath, '_worker.js\n', 'utf-8');
  console.log('[build-workers] Recreated dist/.assetsignore (excludes _worker.js)');
}

function runBuild() {
  ensureStub();

  let originalWranglerContent = null;
  if (existsSync(wranglerPath)) {
    originalWranglerContent = readFileSync(wranglerPath, 'utf-8');
    if (originalWranglerContent.includes('[ai]')) {
      const patched = originalWranglerContent
        .replace(/^\[ai\]/m, '# [ai]')
        .replace(/^binding = "AI"/m, '# binding = "AI"');
      writeFileSync(wranglerPath, patched, 'utf-8');
    }
  }

  try {
    console.log('[build-workers] Starting astro build...');
    const result = spawnSync('pnpm', ['exec', 'astro', 'build'], {
      cwd: appDir,
      stdio: 'inherit',
      shell: false,
    });

    if (result.status !== 0) {
      console.error('[build-workers] Build failed with exit code', result.status);
      process.exit(result.status ?? 1);
    }

    // Post-build: re-crear .assetsignore (astro lo borra)
    ensureAssetsIgnore();

    // Post-build: normalizar el bundle de deploy.
    //
    // astro build regenera dist/server/wrangler.json desde cero y lo deja sin
    // D1, sin R2, sin ENVIRONMENT y con name=gara-g-app-pwa. Ese fichero es lo
    // que lee `wrangler deploy`, asi que desplegarlo tal cual publica una app
    // sin base de datos y con los guards de admin abiertos.
    //
    // El orden importa: este paso va DESPUES del build, nunca antes, que lo
    // sobrescribe. El normalizador aborta con exit 1 si el bundle sale
    // incompleto, asi que si esto falla el deploy tampoco debe seguir.
    console.log('[build-workers] Normalizing deploy bundle...');
    if (wrangler.kind === 'example') {
      console.warn(
        '[build-workers] Sin wrangler.toml: se usa wrangler.example.toml (ids de ejemplo). ' +
          'El bundle sirve para probar, NO para desplegar.',
      );
    }
    const normalize = spawnSync(
      'node',
      [resolve(appDir, 'scripts/normalize-wrangler-config.mjs')],
      {
        cwd: rootDir,
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, WRANGLER_TOML_IN: process.env.WRANGLER_TOML_IN || wranglerPath },
      },
    );
    if (normalize.status !== 0) {
      console.error(
        '[build-workers] Deploy bundle is not deploy-safe. Refusing to continue. ' +
          'Do NOT run `wrangler deploy` against dist/server/wrangler.json.',
      );
      process.exit(normalize.status ?? 1);
    }

    // El service worker lleva un __BUILD_ID__ que hay que sustituir por el
    // hash del bundle: sin esto la caché se llamaria siempre igual y un
    // despliegue nuevo no purgaria nada, que es justo el bug que se arregla.
    stampServiceWorkerBuildId(clientDir);

    console.log('[build-workers] Build complete');
  } finally {
    if (originalWranglerContent !== null) {
      writeFileSync(wranglerPath, originalWranglerContent, 'utf-8');
    }
  }
}

runBuild();
