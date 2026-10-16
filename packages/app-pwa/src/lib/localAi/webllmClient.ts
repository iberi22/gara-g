/**
 * webllmClient.ts — Cliente del motor WebLLM en un Web Worker (tier 2).
 *
 * Es el ÚNICO punto que instancia el motor real. Vive en un módulo aparte para que
 * `new Worker(new URL('./webllm.worker.ts', import.meta.url))` no se evalúe ni se
 * transforme en los tests (que inyectan su propia fábrica) ni en SSR: `webllmEngine.ts`
 * lo importa con `import()` dinámico solo cuando el usuario acepta la descarga.
 *
 * Contrato real del paquete instalado (`@mlc-ai/web-llm` 0.2.86):
 * - `CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback })`
 * - `chat.completions.create({ messages, stream: true })` NO acepta `signal`.
 * - La generación se corta con `engine.interruptGenerate()` y el worker con `terminate()`.
 */
import { abortError, type WebllmEngine, type WebllmProgress } from './webllmEngine';

/** Crea el motor real en un worker; la cancelación termina el worker y detiene la descarga. */
export async function createWorkerEngine(
  modelId: string,
  onProgress: (progress: WebllmProgress) => void,
  signal?: AbortSignal,
): Promise<WebllmEngine> {
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
  const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });

  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      worker.terminate();
      reject(abortError());
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        // Terminar el worker es lo único que detiene de verdad la descarga en curso.
        worker.terminate();
        reject(abortError());
      },
      { once: true },
    );
  });

  try {
    const engine = await Promise.race([
      CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report: { progress?: number; text?: string }) =>
          onProgress({ progress: report.progress ?? 0, text: report.text ?? '' }),
      }),
      cancelled,
    ]);
    // Frontera con la biblioteca de terceros: su tipo de chunk usa `content: string | null`
    // y el nuestro `string | undefined`; normalizamos aquí una sola vez.
    return {
      chat: engine.chat as unknown as WebllmEngine['chat'],
      interruptGenerate: () => {
        engine.interruptGenerate();
      },
      unload: () => engine.unload(),
      dispose: () => worker.terminate(),
    };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
