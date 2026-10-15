<script lang="ts">
/**
 * LocalAiConsent — Tarjeta de consentimiento para el tier 2 (WebGPU + WebLLM).
 *
 * Se muestra SOLO cuando el navegador tiene WebGPU. La descarga es opt-in explícito: nada
 * se descarga al montar; solo el botón llama a `loadWebllmEngine`. Antes de ofrecerla se
 * consulta `navigator.storage.estimate()` y se pide almacenamiento persistente para que el
 * navegador no borre los pesos.
 *
 * Si el usuario ya autorizó un modelo (consentimiento persistido), la tarjeta lo dice y el
 * botón vuelve a activarlo desde la caché del navegador, sin volver a preguntar. "Ahora no"
 * SIGUE ACTIVO durante la descarga: cancela de verdad (aborta la carga, termina el worker y
 * libera la GPU).
 */
import { untrack } from 'svelte';
import {
  DEFAULT_LOCAL_MODEL,
  DOWNLOAD_NOTICE_MB,
  LOCAL_MODELS,
  MIN_FREE_STORAGE_MB,
} from '../../lib/localAi/config';
import { authorisedModelId, saveConsent } from '../../lib/localAi/consent';
import {
  disposeWebllmEngine,
  hasEnoughStorage,
  loadWebllmEngine,
  requestPersistentStorage,
  storageStatus,
  type WebllmProgress,
} from '../../lib/localAi/webllmEngine';

interface Props {
  onAccept?: (modelId: string) => void;
  onCancel?: () => void;
}

const { onAccept, onCancel }: Props = $props();

const alreadyAuthorised = authorisedModelId();

let modelId = $state<string>(alreadyAuthorised ?? DEFAULT_LOCAL_MODEL);
let availableMb = $state<number | null>(null);
let persisted = $state(false);
let checking = $state(true);
let downloading = $state(false);
let progress = $state(0);
let status = $state('');
let error = $state('');
let controller: AbortController | null = null;

$effect(() => {
  untrack(() => {
    void checkStorage();
  });
});

async function checkStorage(): Promise<void> {
  checking = true;
  const info = await storageStatus();
  availableMb = info.availableMb;
  persisted = info.persisted;
  checking = false;
}

const enough = $derived(hasEnoughStorage(availableMb));
const actionLabel = $derived(
  downloading ? 'Descargando…' : alreadyAuthorised ? 'Activar modelo autorizado' : 'Descargar modelo',
);

async function download(): Promise<void> {
  if (downloading || !enough) return;
  error = '';
  downloading = true;
  progress = 0;
  status = alreadyAuthorised ? 'Activando el modelo autorizado…' : 'Preparando la descarga…';
  controller = new AbortController();
  try {
    await requestPersistentStorage();
    await loadWebllmEngine({
      modelId,
      signal: controller.signal,
      onProgress: (p: WebllmProgress) => {
        progress = Math.round((p.progress ?? 0) * 100);
        if (p.text) status = p.text;
      },
    });
    // La autorización se persiste SOLO cuando el motor quedó cargado: una consulta
    // posterior puede reutilizarlo sin volver a descargar nada.
    saveConsent(modelId);
    downloading = false;
    onAccept?.(modelId);
  } catch (err) {
    downloading = false;
    if (controller?.signal.aborted) {
      status = '';
      progress = 0;
      return;
    }
    error = err instanceof Error ? err.message : 'No se pudo cargar el modelo local.';
  } finally {
    controller = null;
  }
}

/** Cancela la descarga en curso y libera lo que se hubiera cargado. */
function cancel(): void {
  if (downloading) {
    controller?.abort();
    void disposeWebllmEngine();
  }
  onCancel?.();
}
</script>

<section class="consent" aria-label="IA local opcional" data-testid="local-ai-consent">
  <h3>Activar la IA local (opcional)</h3>
  <p>
    El asistente y la AUI pueden funcionar con un modelo que corre en tu navegador, sin
    enviar nada a la nube. La primera vez hay que descargarlo: ocupa alrededor de
    {DOWNLOAD_NOTICE_MB} MB y queda guardado en este dispositivo. No se descarga nada
    hasta que pulses el botón.
  </p>

  {#if alreadyAuthorised}
    <p class="authorised" data-testid="local-ai-authorised">
      Ya autorizaste un modelo en este dispositivo; puedes volver a activarlo sin autorizar
      otra descarga.
    </p>
  {/if}

  <fieldset class="models" disabled={downloading}>
    <legend>Tamaño del modelo</legend>
    {#each LOCAL_MODELS as model (model.id)}
      <label class="model">
        <input type="radio" name="local-model" value={model.id} bind:group={modelId} />
        <span>
          <strong>{model.label}</strong>
          <span class="muted">{model.vramMb} MB</span>
        </span>
      </label>
    {/each}
  </fieldset>

  <p class="storage" data-testid="local-ai-storage">
    {#if checking}
      Comprobando el espacio disponible…
    {:else if availableMb === null}
      No se pudo comprobar el espacio disponible en este navegador.
    {:else}
      Espacio libre: {availableMb} MB. Se recomiendan al menos {MIN_FREE_STORAGE_MB} MB.
      {#if persisted}La descarga queda como almacenamiento persistente.{/if}
    {/if}
  </p>

  {#if !enough}
    <p class="warn" role="status">
      No hay espacio suficiente para descargar el modelo. Libera espacio o usa el navegador
      sin IA local: el asistente seguirá respondiendo con los fragmentos del manual.
    </p>
  {/if}

  {#if downloading}
    <div class="progress" role="status" aria-live="polite">
      <progress max="100" value={progress}></progress>
      <span>{progress}% · {status}</span>
    </div>
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <div class="actions">
    <button type="button" class="primary" disabled={downloading || !enough} onclick={download}>
      {actionLabel}
    </button>
    <button type="button" class="ghost" onclick={cancel}>
      {downloading ? 'Cancelar' : 'Ahora no'}
    </button>
  </div>
</section>

<style>
  .consent {
    border: 1px solid var(--d-line);
    background: var(--d-sheet);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0;
    font-size: 15px;
  }
  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--d-ink);
  }
  .muted {
    color: var(--d-muted);
    margin-left: 6px;
    font-size: 12px;
  }
  .authorised {
    color: var(--d-muted);
    font-size: 12px;
  }
  .models {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  legend {
    font-size: 12px;
    color: var(--d-muted);
    padding: 0;
  }
  .model {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .storage {
    font-size: 12px;
    color: var(--d-muted);
  }
  .warn {
    color: var(--d-critical);
  }
  .error {
    color: var(--d-critical);
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--d-muted);
  }
  .progress progress {
    flex: 1;
    max-width: 240px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  button {
    font: inherit;
    font-size: 13px;
    padding: 8px 14px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .primary {
    border: 0;
    background: var(--d-accent);
    color: var(--swal-accent-contrast);
    font-weight: 700;
  }
  .ghost {
    border: 1px solid var(--d-line);
    background: transparent;
    color: var(--d-ink);
  }
</style>
