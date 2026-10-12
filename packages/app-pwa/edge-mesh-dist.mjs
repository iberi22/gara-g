// edge-mesh-dist.mjs — Where the `edge-mesh-dist` alias points (astro.config.mjs, vitest.config.ts).
//
// GARA-G imports a few browser-safe modules of @swal/edge-mesh by file (src/mesh/edgeMesh.ts):
// the package index re-exports Node-only code (relay server, tor, node-memory) that a browser
// bundle cannot take, and its `exports` map only publishes ".", "./web" and "./web/*". The
// alias resolves the INSTALLED npm package (no submodule, no local build) and points at its dist/.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

/** Absolute path of node_modules/@swal/edge-mesh/dist (the package main is dist/index.js). */
export const edgeMeshDist = dirname(require.resolve('@swal/edge-mesh'));
