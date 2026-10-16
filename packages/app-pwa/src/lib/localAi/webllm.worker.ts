/**
 * webllm.worker.ts — Hilo del motor WebLLM (tier 2).
 *
 * El motor real vive en un Web Worker (contrato `WebWorkerMLCEngineHandler` de la
 * biblioteca), no en el hilo principal: la decodificación no congela la interfaz y la
 * cancelación puede terminar el worker entero. La dependencia entra con `import()`
 * dinámico, igual que en el cliente (nada estático en `src`).
 *
 * Sin `await` en el nivel superior: el bundler emite el worker en formato `iife` por
 * defecto y el top-level await no existe ahí (el build rompe con
 * `[UNSUPPORTED_FEATURE] Top-level await ... 'iife'`). El handler se crea en una
 * función asíncrona y los mensajes que lleguen antes se encolan y se reenvían en orden.
 *
 * Este fichero no se importa nunca en SSR ni en los tests: solo lo instancia
 * `webllmClient.ts` con `new Worker(new URL(...))` cuando el usuario acepta la descarga.
 */
const pending: MessageEvent[] = [];
let deliver: ((event: MessageEvent) => void) | null = null;

self.onmessage = (event: MessageEvent) => {
  if (deliver) deliver(event);
  else pending.push(event);
};

void (async () => {
  const { WebWorkerMLCEngineHandler } = await import('@mlc-ai/web-llm');
  const handler = new WebWorkerMLCEngineHandler();
  deliver = (event: MessageEvent) => handler.onmessage(event);
  for (const event of pending.splice(0)) deliver(event);
})();

// `export {}` marca el fichero como módulo: sin ello, el `self.onmessage` de arriba
// seguiría siendo legal, pero el `import()` dinámico no se transformaría igual.
export {};
