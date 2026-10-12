<script lang="ts">
/**
 * DrawerContainer.svelte — Contenedor responsive para los paneles del HUD.
 *
 * En escritorio (≥ 1024px) se abre como cajón lateral derecho (420px).
 * En móvil (< 768px) actúa como una hoja inferior (bottom sheet) con puntos de anclaje
 * (35%, 70%, 95%), soporte de arrastre/cierre y trampa de foco accesible (Esc para cerrar).
 */
import { onMount, type Snippet } from 'svelte';

interface Props {
  open: boolean;
  title: string;
  badge?: string;
  onclose: () => void;
  children: Snippet;
}

const { open, title, badge, onclose, children }: Props = $props();

let dialogEl = $state<HTMLElement | null>(null);
let mobileSnap = $state<'min' | 'mid' | 'max'>('mid'); // 35%, 70%, 95%
let touchStartY = 0;
let currentTranslateY = $state(0);
let isDragging = $state(false);

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open) {
    event.stopPropagation();
    onclose();
  }
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    onclose();
  }
}

function handleTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0].clientY;
  isDragging = true;
}

function handleTouchMove(e: TouchEvent) {
  if (!isDragging) return;
  const currentY = e.touches[0].clientY;
  const diffY = currentY - touchStartY;
  if (diffY > 0) {
    currentTranslateY = diffY;
  }
}

function handleTouchEnd() {
  if (!isDragging) return;
  isDragging = false;
  if (currentTranslateY > 120) {
    onclose();
  } else if (currentTranslateY > 60) {
    mobileSnap = mobileSnap === 'max' ? 'mid' : 'min';
  } else if (currentTranslateY < -60) {
    mobileSnap = mobileSnap === 'min' ? 'mid' : 'max';
  }
  currentTranslateY = 0;
}

$effect(() => {
  if (open) {
    mobileSnap = 'mid';
    currentTranslateY = 0;
    // Enfocar el diálogo para accesibilidad
    setTimeout(() => {
      dialogEl?.focus();
    }, 50);
  }
});
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
  <!-- Telón de fondo (token de overlay del tema) -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="drawer-backdrop"
    onclick={handleBackdropClick}
    role="presentation"
  >
    <section
      bind:this={dialogEl}
      class="drawer-content snap-{mobileSnap}"
      style:transform={currentTranslateY > 0 ? `translateY(${currentTranslateY}px)` : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
    >
      <!-- Tirador táctil en móvil -->
      <div
        class="drag-handle-bar"
        ontouchstart={handleTouchStart}
        ontouchmove={handleTouchMove}
        ontouchend={handleTouchEnd}
        role="presentation"
      >
        <span class="drag-pill"></span>
      </div>

      <!-- Cabecera del panel -->
      <header class="drawer-header">
        <div class="header-titles">
          <span class="swal-tick" aria-hidden="true"></span>
          <h2 class="drawer-title">{title}</h2>
          {#if badge}
            <span class="drawer-badge">{badge}</span>
          {/if}
        </div>
        <div class="header-actions">
          <!-- Botón de snap en móvil -->
          <button
            class="snap-toggle-btn"
            type="button"
            aria-label="Cambiar tamaño de panel"
            onclick={() => {
              mobileSnap = mobileSnap === 'max' ? 'mid' : mobileSnap === 'mid' ? 'min' : 'max';
            }}
          >
            {mobileSnap === 'max' ? '▼' : mobileSnap === 'mid' ? '▲' : '◼'}
          </button>
          <button
            class="drawer-close-btn"
            type="button"
            aria-label="Cerrar panel"
            onclick={onclose}
          >
            ✕
          </button>
        </div>
      </header>

      <!-- Cuerpo deslizable -->
      <div class="drawer-body">
        {@render children()}
      </div>
    </section>
  </div>
{/if}

<style>
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: var(--swal-overlay);
    z-index: 60;
    display: flex;
    justify-content: flex-end;
    align-items: stretch;
    animation: fadeIn 180ms ease-out;
  }

  /* Hoja de plano: superficie opaca, hairline y sombra de papel (sin blur ni brillo). */
  .drawer-content {
    background: var(--swal-bg-surface);
    border-left: 1px solid var(--swal-border-strong);
    box-shadow: var(--swal-shadow-lg);
    display: flex;
    flex-direction: column;
    outline: none;
    color: var(--swal-text);
    font-family: var(--g-font-sans, system-ui, sans-serif);
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), height 200ms ease-out;
  }

  /* Desktop (≥ 1024px): cajón lateral derecho de 420px */
  @media (min-width: 1024px) {
    .drawer-content {
      width: 420px;
      height: 100svh;
      animation: slideInRight 200ms ease-out;
    }
    .drag-handle-bar {
      display: none;
    }
    .snap-toggle-btn {
      display: none;
    }
  }

  /* Móvil / Tablet (< 1024px): bottom sheet */
  @media (max-width: 1023px) {
    .drawer-backdrop {
      align-items: flex-end;
    }
    .drawer-content {
      width: 100%;
      border-left: none;
      border-top: 1px solid var(--swal-border-strong);
      animation: slideInUp 220ms ease-out;
      padding-bottom: env(safe-area-inset-bottom, 16px);
    }
    .drawer-content.snap-min {
      height: 38svh;
    }
    .drawer-content.snap-mid {
      height: 70svh;
    }
    .drawer-content.snap-max {
      height: 94svh;
    }
  }

  .drag-handle-bar {
    width: 100%;
    padding: 10px 0 4px;
    display: flex;
    justify-content: center;
    cursor: grab;
    touch-action: none;
  }
  .drag-pill {
    width: 44px;
    height: 4px;
    background: var(--swal-border-strong);
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.25rem;
    border-bottom: 1px solid var(--swal-border);
    background: var(--swal-surface);
  }

  .header-titles {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* Rótulo técnico: mono, mayúsculas, espaciado. */
  .drawer-title {
    font-family: var(--swal-font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--swal-text);
    margin: 0;
  }

  .drawer-badge {
    font-family: var(--swal-font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    background: var(--swal-accent-muted);
    color: var(--swal-accent-text);
    padding: 0.12rem 0.5rem;
    border: 1px solid var(--swal-accent);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .snap-toggle-btn,
  .drawer-close-btn {
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
    color: var(--swal-text-secondary);
    width: 34px;
    height: 34px;
    border-radius: var(--swal-radius-sm);
    display: grid;
    place-items: center;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  }
  .snap-toggle-btn:hover,
  .drawer-close-btn:hover {
    background: var(--swal-surface-hover);
    border-color: var(--swal-accent);
    color: var(--swal-text);
  }
  .snap-toggle-btn:focus-visible,
  .drawer-close-btn:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem 2rem;
    -webkit-overflow-scrolling: touch;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideInRight {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  @keyframes slideInUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .drawer-backdrop,
    .drawer-content {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
