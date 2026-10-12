<script lang="ts">
/**
 * HudNotifier.svelte — Notificador emergente de compromisos urgentes.
 *
 * Se despliega al cambiar de vehículo o cargar por primera vez con los compromisos más urgentes.
 * En escritorio se ubica como tarjeta compacta en la esquina superior derecha del escenario 3D
 * (para no tapar el vehículo). En móvil se ubica como banda inferior sobre el dock.
 * Se auto-descarta tras 6 segundos salvo si está en hover o foco; la campana de la cabecera
 * permite reabrirlo. Usa aria-live="polite".
 */
import type { Commitment } from '../../garage/contracts';
import { formatKm } from './formatters';

interface Props {
  commitments: Commitment[];
  open: boolean;
  /** Variante: 'desktop' en esquina superior derecha del escenario, 'mobile' como banda inferior sobre el dock */
  variant?: 'desktop' | 'mobile';
  onclose: () => void;
  onselectcommitment?: (c: Commitment) => void;
  /** Unidad de los km de los compromisos ('h' en maquinaria). */
  unit?: 'km' | 'h';
}

const { commitments, open, variant = 'desktop', onclose, onselectcommitment, unit = 'km' }: Props = $props();

let isHoveredOrFocused = $state(false);
let timerId: number | null = null;

$effect(() => {
  if (open && commitments.length > 0) {
    startDismissTimer();
  } else {
    clearDismissTimer();
  }
  return () => clearDismissTimer();
});

function startDismissTimer() {
  clearDismissTimer();
  if (!isHoveredOrFocused) {
    timerId = window.setTimeout(() => {
      onclose();
    }, 6000);
  }
}

function clearDismissTimer() {
  if (timerId !== null) {
    window.clearTimeout(timerId);
    timerId = null;
  }
}

function handleMouseEnter() {
  isHoveredOrFocused = true;
  clearDismissTimer();
}

function handleMouseLeave() {
  isHoveredOrFocused = false;
  startDismissTimer();
}

function handleFocusIn() {
  isHoveredOrFocused = true;
  clearDismissTimer();
}

function handleFocusOut() {
  isHoveredOrFocused = false;
  startDismissTimer();
}

function getUrgencyBadge(urgency: Commitment['urgency']) {
  switch (urgency) {
    case 'overdue':
      return { label: 'VENCIDO' };
    case 'soon':
      return { label: 'PRONTO' };
    default:
      return { label: 'PLAN' };
  }
}
</script>

{#if open && commitments.length > 0}
  <section
    class="hud-notifier-root variant-{variant}"
    aria-live="polite"
    aria-label="Notificaciones urgentes del vehículo"
    role="region"
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
    onfocusin={handleFocusIn}
    onfocusout={handleFocusOut}
  >
    <div class="notifier-card chamfer-sm">
      <header class="card-head">
        <span class="head-dot" aria-hidden="true"></span>
        <span class="head-title">COMPROMISOS ({commitments.length})</span>
        <button
          type="button"
          class="close-btn"
          aria-label="Ocultar notificador"
          onclick={onclose}
        >
          ✕
        </button>
      </header>

      <div class="items-list" role="list">
        {#each commitments as item (item.id)}
          {@const badge = getUrgencyBadge(item.urgency)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="notifier-item {item.urgency}"
            role="listitem"
            tabindex="0"
            onclick={() => onselectcommitment?.(item)}
          >
            <span class="item-name">{item.title}</span>
            <span class="item-sub">
              {#if item.remainingKm !== undefined}
                {item.remainingKm < 0
                  ? `Vencido (${formatKm(Math.abs(item.remainingKm), unit)})`
                  : `Faltan ${formatKm(item.remainingKm, unit)}`}
              {:else if item.remainingDays !== undefined}
                {item.remainingDays < 0
                  ? `Vencido (${Math.abs(item.remainingDays)} d)`
                  : `En ${item.remainingDays} días`}
              {/if}
            </span>
            <span class="urgency-tag">{badge.label}</span>
          </div>
        {/each}
      </div>
    </div>
  </section>
{/if}

<style>
  .hud-notifier-root {
    z-index: 35;
    pointer-events: auto;
  }

  /* Escritorio: tarjeta compacta en la esquina superior derecha del escenario */
  .variant-desktop {
    position: absolute;
    top: 10px;
    right: 10px;
    left: auto;
    transform: none;
    width: min(300px, calc(100% - 20px));
    animation: slideDown 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* Móvil: banda inferior sobre el dock */
  .variant-mobile {
    position: fixed;
    bottom: calc(52px + env(safe-area-inset-bottom, 8px) + 6px);
    left: 8px;
    right: 8px;
    width: auto;
    max-width: 100%;
    z-index: 50;
    animation: slideUp 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .chamfer-sm {
    clip-path: polygon(
      6px 0, 100% 0,
      100% calc(100% - 6px), calc(100% - 6px) 100%,
      0 100%, 0 6px
    );
  }

  .notifier-card {
    background: var(--g3-card);
    border: 1px solid var(--g3-line);
    box-shadow: var(--swal-shadow);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem 0.3rem;
    border-bottom: 1px solid var(--g3-line);
  }
  .head-dot {
    width: 5px;
    height: 5px;
    background: var(--g3-orange);
    flex: none;
  }
  .head-title {
    flex: 1;
    font-family: var(--g-font-mono);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--g3-ink);
  }
  .close-btn {
    background: transparent;
    border: none;
    color: var(--g3-ink-muted);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.1rem 0.25rem;
    line-height: 1;
    transition: color 120ms ease;
  }
  .close-btn:hover {
    color: var(--swal-accent-text);
  }

  .items-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0 0.5rem 0.45rem;
    max-height: 140px;
    overflow-y: auto;
  }
  .variant-mobile .items-list {
    max-height: 105px;
  }

  .notifier-item {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'name tag'
      'sub tag';
    align-items: center;
    column-gap: 0.4rem;
    padding: 0.25rem 0.35rem;
    background: var(--g3-strip-bg);
    border-left: 3px solid var(--swal-border-strong);
    cursor: pointer;
    transition: background-color 130ms ease;
  }
  .notifier-item:hover {
    background: var(--g3-icon-bg);
  }
  .notifier-item.overdue {
    border-left-color: var(--swal-danger);
  }
  .notifier-item.soon {
    border-left-color: var(--swal-warning);
  }
  .notifier-item.planned {
    border-left-color: var(--swal-border-strong);
  }

  .item-name {
    grid-area: name;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--g3-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-sub {
    grid-area: sub;
    font-family: var(--g-font-mono);
    font-size: 0.58rem;
    color: var(--g3-ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .urgency-tag {
    grid-area: tag;
    font-family: var(--g-font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--swal-accent-text);
    white-space: nowrap;
  }
  .notifier-item.overdue .urgency-tag {
    color: var(--swal-danger);
  }
  .notifier-item.soon .urgency-tag {
    color: var(--swal-warning);
  }
  .notifier-item.planned .urgency-tag {
    color: var(--g3-ink-muted);
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hud-notifier-root {
      animation: none !important;
    }
  }
</style>