<script lang="ts">
/**
 * LocalAiConsent — Tarjeta de consentimiento para el tier 2 (WebGPU + WebLLM).
 *
 * Se muestra SOLO cuando el navegador tiene WebGPU pero el motor todavía no está cargado.
 * La descarga es opt-in explícito: nada se descarga al montar; solo el botón llama a
 * `loadWebllmEngine`. Antes de ofrecerla se consulta `navigator.storage.estimate()` y se
 * pide almacenamiento persistente para que el navegador no borre los pesos.
 */
import { untrack } from 'svelte';
import {
  DEFAULT_LOCAL_MODEL,
  DOWNLOAD_NOTICE_MB,
  LOCAL_MODELS,
  MIN_FREE_STORAGE_MB,
} from '../../lib/localAi/config';
import {
  hasEnoughStorage,
  loadWebllmEngine,
  requestPersistentStorage,
  storageStatus,
  type WebllmProgress,
} from '../../lib/localAi/webllmEngine';

interface Props {
  onAccept?: () => void;
  onCancel?: () => void;
}

const { onAccept, onCancel }: Props = $props();

let modelId = $state<string>(DEFAULT_LOCAL_MODEL);
let availableMb = $state<number | null>(null);
let persisted = $state(false);
let checking = $state(true);
let downloading = $state(false);
let progress = $state(0);
let status = $state('');
let error = $state('');

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

async function download(): Promise<void> {
  if (downloading || !enough) return;
  error = '';
  downloading = true;
  progress = 0;
  status = 'Preparando la descarga…';
  try {
    await requestPersistentStorage();
    await loadWebllmEngine((p: WebllmProgress) => {
      progress = Math.round((p.progress ?? 0) * 100);
      if (p.text) status = p.text;
    }, modelId);
    downloading = false;
    onAccept?.();
  } catch (err) {
    downloading = false;
    error = err instanceof Error ? err.message : 'No se pudo cargar el modelo local.';
  }
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
      {downloading ? 'Descargando…' : 'Descargar modelo'}
    </button>
    <button type="button" class="ghost" disabled={downloading} onclick={() => onCancel?.()}>
      Ahora no
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
