/**
 * edgeMesh.ts — Las piezas de edge-mesh que usa GARA-G, importadas por ruta del dist/ del
 * paquete npm `@swal/edge-mesh` (alias `edge-mesh-dist`, ver edge-mesh-dist.mjs,
 * astro.config.mjs y vitest.config.ts) y no por el indice del paquete.
 *
 * Por que: el indice de edge-mesh re-exporta TODO (relay-server, tor, node-memory, chat...) y
 * parte de eso usa `node:http`, `node:fs`, `node:child_process`. Un bundler de navegador no
 * puede empaquetarlo, y el mapa `exports` del paquete solo publica ".", "./web" y "./web/*".
 * Estas rutas son el dist/ publicado (version fijada en package.json); si el paquete
 * reorganiza su dist/, se rompe aqui y el build lo dice.
 */
export { createEnvelope, signEnvelope, verifyEnvelopeSignature } from 'edge-mesh-dist/protocol/index.js';
export {
  createPostQuantumIdentity,
  deserializeKeypair,
  generateKeypair,
  serializeKeypair,
} from 'edge-mesh-dist/identity/index.js';
export type { PostQuantumIdentity } from 'edge-mesh-dist/identity/index.js';
export { MemoryTransport } from 'edge-mesh-dist/transport/memory.js';
export { PeerJSTransport } from 'edge-mesh-dist/transport/peerjs.js';
export type { ITransport } from 'edge-mesh-dist/transport/types.js';
export { TIPO_MENSAJE } from 'edge-mesh-dist/types/index.js';
