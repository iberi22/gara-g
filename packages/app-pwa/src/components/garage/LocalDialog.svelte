<script lang="ts">
/**
 * LocalDialog.svelte — Dialogo modal accesible del garage en modo invitado.
 *
 * role="dialog" + aria-modal, titulo enlazado con aria-labelledby, foco atrapado (Tab y
 * Shift+Tab ciclan dentro), Esc y clic en el telon lo cierran, y al cerrar el foco vuelve al
 * boton que lo abrio. Colores solo con tokens --swal-*.
 */
import { onMount, type Snippet } from 'svelte';

interface Props {
  title: string;
  onclose: () => void;
  children: Snippet;
  /** Etiqueta corta sobre el titulo (por ejemplo, "MODO LOCAL"). */
  kicker?: string;
}

const { title, onclose, children, kicker }: Props = $props();

let panelEl = $state<HTMLElement | null>(null);
const titleId = `local-dialog-title-${Math.random().toString(36).slice(2, 8)}`;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  return panelEl ? [...panelEl.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null) : [];
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onclose();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables();
  if (items.length === 0) {
    event.preventDefault();
    panelEl?.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panelEl)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (!panelEl?.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

onMount(() => {
  const opener = document.activeElement as HTMLElement | null;
  // El primer campo del formulario; si no hay, el propio dialogo.
  const first = panelEl?.querySelector<HTMLElement>('input, select, textarea') ?? focusables()[0] ?? panelEl;
  first?.focus();
  return () => {
    if (opener && document.contains(opener)) opener.focus();
  };
});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="ld-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div
    bind:this={panelEl}
    class="ld-panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    data-testid="local-dialog"
  >
    <header class="ld-head">
      <div class="ld-titles">
        {#if kicker}<span class="ld-kicker"><span class="swal-tick" aria-hidden="true"></span> {kicker}</span>{/if}
        <h2 id={titleId} class="ld-title">{title}</h2>
      </div>
      <button type="button" class="ld-close" aria-label="Cerrar" onclick={onclose}>✕</button>
    </header>
    <div class="ld-body">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .ld-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.75rem;
    background: var(--swal-overlay);
  }
  .ld-panel {
    width: min(30rem, 100%);
    max-height: calc(100dvh - 1.5rem);
    display: flex;
    flex-direction: column;
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border-strong);
    box-shadow: var(--swal-shadow-lg);
    color: var(--swal-text);
    font-family: var(--g-font-sans, system-ui, sans-serif);
    outline: none;
  }
  .ld-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--swal-border);
    background: var(--swal-surface);
  }
  .ld-titles {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .ld-kicker {
    font-family: var(--swal-font-mono);
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--swal-text-muted);
  }
  .ld-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--swal-text);
  }
  .ld-close {
    flex: none;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
    border-radius: var(--swal-radius-sm);
    color: var(--swal-text-secondary);
    cursor: pointer;
  }
  .ld-close:hover {
    border-color: var(--swal-accent);
    color: var(--swal-text);
  }
  .ld-close:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }
  .ld-body {
    overflow-y: auto;
    padding: 1rem 1.1rem 1.1rem;
  }
</style>
