<script lang="ts">
  /**
   * ReportDialog — formulario en linea para reportar una oferta (reemplaza a window.prompt).
   * Accesible: etiqueta por grupo de radios, el foco entra al abrir y vuelve al disparador al
   * cerrar, Escape cancela y todos los controles miden al menos 44 px (clases .mk-*).
   */
  import { onMount } from 'svelte';

  const REPORT_REASONS = [
    'Información falsa o engañosa',
    'Spam o publicidad repetida',
    'Precio o condiciones distintas a lo ofrecido',
    'Contenido ofensivo',
    'Otro motivo',
  ] as const;

  let {
    offerTitle = '',
    returnFocusTo = null,
    onsubmit,
    oncancel,
  }: {
    offerTitle?: string;
    /** Elemento que abrio el formulario; al cerrar recibe el foco si sigue en el documento. */
    returnFocusTo?: HTMLElement | null;
    onsubmit: (reason: string) => void;
    oncancel: () => void;
  } = $props();

  let choice = $state('');
  let detail = $state('');
  let error = $state('');
  let root: HTMLElement;

  onMount(() => {
    root.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
    return () => {
      // Al desmontar (enviar o cancelar) el foco vuelve a quien lo abrio.
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  });

  function submit(e: Event) {
    e.preventDefault();
    if (!choice) {
      error = 'Elige un motivo para enviar el reporte.';
      return;
    }
    const extra = detail.trim();
    onsubmit(extra ? `${choice}: ${extra}` : choice);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      oncancel();
    }
  }
</script>

<form
  bind:this={root}
  class="mk-card mk-report"
  role="dialog"
  aria-modal="false"
  aria-labelledby="report-t"
  data-testid="report-dialog"
  {onkeydown}
  onsubmit={submit}
>
  <h4 id="report-t">Reportar oferta{offerTitle ? `: ${offerTitle}` : ''}</h4>
  <p class="mk-muted">El reporte se queda en este dispositivo y oculta la oferta.</p>
  <fieldset class="mk-fieldset">
    <legend>¿Qué tiene mal esta oferta?</legend>
    {#each REPORT_REASONS as r}
      <label class="mk-chip">
        <input type="radio" name="report-reason" value={r} bind:group={choice} onchange={() => (error = '')} />
        {r}
      </label>
    {/each}
  </fieldset>
  <label class="mk-field"><span>Detalle (opcional)</span>
    <textarea bind:value={detail} maxlength="150" rows="3"></textarea>
  </label>
  {#if error}<p class="mk-err" role="alert">{error}</p>{/if}
  <div class="mk-row">
    <button class="mk-btn primary" type="submit">Enviar reporte</button>
    <button class="mk-btn" type="button" onclick={oncancel}>Cancelar</button>
  </div>
</form>

<style>
  .mk-fieldset { display: flex; flex-direction: column; gap: 0.4rem; margin: 0; padding: 0; border: 0; min-width: 0; }
  .mk-fieldset legend { padding: 0; margin-bottom: 0.4rem; font-weight: 600; color: var(--swal-text); }
</style>
