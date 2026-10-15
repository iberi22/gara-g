import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudOverlay } from './cloud-overlay.mjs';
import { edgeMeshDist } from './edge-mesh-dist.mjs';
import { cspConfig } from './src/lib/csp';

// Modulo cloud opcional (facturacion, pagos, anclaje): solo con GARA_CLOUD=1 y private/ presente.
// Sin el, la app es local-first completa y las rutas cloud responden 404 "cloud disabled".
const overlay = cloudOverlay();
if (overlay.enabled) console.log('[cloud-overlay] GARA_CLOUD=1: modulo cloud privado activo');

// Vite plugin: recrea stub de worker antes de que @cloudflare/vite-plugin valide wrangler.toml
// Sin esto, el build falla porque dist/_worker.js/index.js se limpia entre runs
function cloudflareWorkerStub() {
  return {
    name: 'cloudflare-worker-stub',
    apply: 'build',
    config() {
      const stubPath = resolve('./dist/_worker.js/index.js');
      if (!existsSync(stubPath)) {
        mkdirSync(dirname(stubPath), { recursive: true });
        writeFileSync(stubPath, 'export default { fetch(request, env) { return fetch(request); } };\n');
        console.log('[cloudflare-worker-stub] Created worker stub');
      }
    },
  };
}

// https://astro.build/config — Astro 7.2.10 + @astrojs/cloudflare 14.2.6
// output: 'server' — habilitado para Workers.dev con SSR runtime (D1, R2, KV, AI bindings)
// Antes: output: 'static' (gara-g.pages.dev, HTML pre-renderizado, sin APIs runtime)
// Trade-off: Pages.dev = UI estatica; Workers.dev = backend completo (REST APIs + DB)
export default defineConfig({
  output: 'server',
  // CSP (F12): Astro emite la cabecera `content-security-policy` en cada ruta SSR con los
  // hashes SHA-256 de los scripts/estilos inline de la app (ver src/lib/csp.ts). Sin
  // `'unsafe-inline'` en `script-src` y sin `'unsafe-eval'` en ninguna directiva: un XSS
  // inyectado no ejecuta. La lista de hashes es GLOBAL a proposito, porque el ClientRouter
  // re-ejecuta los scripts de la pagina nueva dentro del documento actual.
  security: { csp: cspConfig() },
  site: 'https://gara-g.swal.network',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  integrations: [svelte()],
  // Barra dev de Astro fuera en e2e: su lazy-load de chunks internos
  // (audit-*) mete ruido y falla con context offline. Solo dev.
  devToolbar: { enabled: false },
  vite: {
    server: {
      // Los e2e escriben test-results/ al fallar; sin esto el watcher
      // invalida el module graph a mitad del run y envenena las rutas
      // siguientes ("component instance", "Unable to resolve"). Solo dev.
      watch: { ignored: ['**/test-results/**', '**/playwright-report/**'] },
    },
    plugins: [
      cloudflareWorkerStub(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false, // Use public/manifest.json explicitly
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/gara-g\.pages\.dev\/api\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'gara-g-api-cache',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 86400,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
    build: {
      target: 'esnext',
    },
    ssr: {
      noExternal: ['astro'],
    },
    optimizeDeps: {
      exclude: ['astro', '@astrojs/svelte'],
    },
    resolve: {
      extensions: ['.ts', '.js', '.astro', '.svelte', '.mjs', '.json'],
      // yjs y svelte desde este paquete aunque los importe codigo de private/ (fuera de la raiz).
      dedupe: ['yjs', 'svelte'],
      alias: {
        ...overlay.alias,
        // dist/ del paquete npm @swal/edge-mesh (ver src/mesh/edgeMesh.ts y edge-mesh-dist.mjs): rutas sueltas en vez del
        // indice del paquete, que arrastra modulos solo-Node (tor, relay-server).
        'edge-mesh-dist': edgeMeshDist,
      },
    },
  },
});
