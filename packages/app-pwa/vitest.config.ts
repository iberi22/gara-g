import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';
import { cloudOverlay } from './cloud-overlay.mjs';
import { edgeMeshDist } from './edge-mesh-dist.mjs';

// Modulo cloud opcional (privado): ver cloud-overlay.mjs.
const overlay = cloudOverlay();

// Compila los .svelte que importan los tests de componentes (src/lib/swal-prefs/*.test.ts,
// en jsdom). Es el compilador de Svelte a pelo: basta para montar con `mount`.
const svelteForTests = {
  name: 'svelte-for-tests',
  transform(code: string, id: string) {
    // Modulos con runas (`*.svelte.js`, p. ej. el store de toasts de @swal/ui).
    if (/\.svelte\.js$/.test(id)) {
      const mod = compileModule(code, { filename: id, generate: 'client' });
      return { code: mod.js.code, map: mod.js.map as any };
    }
    if (!id.endsWith('.svelte')) return null;
    const out = compile(code, { filename: id, generate: 'client', css: 'injected' });
    return { code: out.js.code, map: out.js.map as any };
  },
};

export default defineConfig({
  plugins: [svelteForTests],
  test: {
    server: { deps: { inline: [/svelte/] } },
    include: ['tests/**/*.test.ts', 'src/lib/**/*.test.ts', 'src/garage/**/*.test.ts', 'src/components/garage/**/*.test.ts', 'src/components/garage-dossier/**/*.test.ts', 'src/mesh/**/*.test.ts', ...overlay.privateTests],
    globals: true,
  },
  resolve: {
    // yjs y svelte desde este paquete aunque los importe codigo de private/ (fuera de la raiz).
    dedupe: ['yjs', 'svelte'],
    conditions: ['browser'],
    alias: {
      ...overlay.alias,
      // dist/ del paquete npm @swal/edge-mesh (ver src/mesh/edgeMesh.ts y edge-mesh-dist.mjs)
      'edge-mesh-dist': edgeMeshDist,
      // `cloudflare:workers` es un modulo virtual de Workers. El mock exporta un `env`
      // mutable: los tests pueden asignarle SESSION/KV/ENVIRONMENT y el codigo lo ve.
      'cloudflare:workers': fileURLToPath(new URL('./tests/mocks/cloudflare-workers.ts', import.meta.url)),
      // Modulo virtual de Astro: no existe fuera del pipeline, asi que se sustituye
      // por una identidad. Permite testear src/middleware.ts (auth, RBAC, redirects).
      'astro:middleware': fileURLToPath(new URL('./tests/mocks/astro-middleware.ts', import.meta.url)),
    },
  },
});

