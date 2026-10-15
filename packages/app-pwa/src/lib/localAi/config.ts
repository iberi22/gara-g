/**
 * config.ts — Constantes de la IA local del navegador (G3).
 *
 * Tres niveles, de mejor a peor, sin cuota, sin cuenta y sin inferencia en la nube:
 *  1. `prompt-api`: Chrome Prompt API (Gemini Nano). Lo gestiona el navegador; no
 *     descargamos nada desde nuestro origen.
 *  2. `webgpu`: WebGPU + WebLLM. Los pesos los descarga el usuario con un clic (tier
 *     opcional, ver LocalAiConsent.svelte). `MODEL_SOURCE` decide de dónde salen.
 *  3. `rules`: reglas deterministas, siempre disponibles, sin descarga ni GPU.
 *
 * La app funciona entera sin ninguno de los tres. La IA es mejora progresiva.
 */

/**
 * Origen de los pesos de WebLLM. Hoy son los hosts públicos por defecto de la librería
 * (Hugging Face para los pesos, GitHub raw para la librería compilada), así que no
 * mantenemos infraestructura. Pasar a un origen propio (R2 detrás de un dominio SWAL) es
 * cambiar esta constante y añadir su host a `WEBLLM_CONNECT_HOSTS`.
 */
export const MODEL_SOURCE = 'mlc-public' as const;

export interface LocalModelInfo {
  /** Id tal cual aparece en `prebuiltAppConfig.model_list` de la versión instalada. */
  id: string;
  label: string;
  /** VRAM que exige el motor (`vram_required_MB` de WebLLM). */
  vramMb: number;
}

/**
 * Ids verificados en el `prebuiltAppConfig` del `@mlc-ai/web-llm` instalado (0.2.86):
 * no se inventa ninguno. El primero es el modelo por defecto del spec; el segundo, la
 * alternativa de poca memoria.
 */
export const LOCAL_MODELS: readonly LocalModelInfo[] = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', vramMb: 879 },
  { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', label: 'SmolLM2 360M (poca memoria)', vramMb: 376 },
] as const;

export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0].id;
export const LOW_MEMORY_LOCAL_MODEL = LOCAL_MODELS[1].id;

/**
 * Aviso de tamaño que se muestra ANTES de descargar: el modelo por defecto exige unos
 * 879 MB de VRAM/almacenamiento, más la caché del motor. Se redondea hacia arriba.
 */
export const DOWNLOAD_NOTICE_MB = 900;

/** Espacio libre mínimo que se exige antes de descargar (pesos + caché del motor). */
export const MIN_FREE_STORAGE_MB = 1200;

/**
 * Hosts que el CSP debe permitir en `connect-src` SOLO si el tier 2 se activa. GARA-G no
 * fija CSP propia todavía (más allá del `sandbox` de `/r2/*`): la rama de cabeceras de
 * seguridad decide. Ver el informe de la tarea, sección CSP.
 */
export const WEBLLM_CONNECT_HOSTS = [
  'https://huggingface.co',
  'https://cdn-lfs.huggingface.co',
  'https://raw.githubusercontent.com',
] as const;

/** Directiva extra que exige el wasm de WebGPU en `script-src`. */
export const WEBLLM_SCRIPT_DIRECTIVE = "'wasm-unsafe-eval'";
