/**
 * webllm.worker.ts — Hilo del motor WebLLM (tier 2).
 *
 * El motor real vive en un Web Worker (contrato `WebWorkerMLCEngineHandler` de la
 * biblioteca), no en el hilo principal: la decodificación no congela la interfaz y la
 * cancelación puede terminar el worker entero. La dependencia entra con `import()`
 * dinámico, igual que en el cliente (nada estático en `src`).
 *
 * Este fichero no se importa nunca en SSR ni en los tests: solo lo instancia
 * `webllmClient.ts` con `new Worker(new URL(...))` cuando el usuario acepta la descarga.
 */
const { WebWorkerMLCEngineHandler } = await import('@mlc-ai/web-llm');

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};

// `export {}` marca el fichero como módulo: sin ello, el `await` de arriba (que espera al
// handler antes de aceptar mensajes) no sería legal en el nivel superior.
export {};
