<script lang="ts">
/**
 * BottomDock.svelte — Muelle fijo inferior con los 6 paneles, con el estilo de tarjetas.
 *
 * Los paneles (Estado, Historial, Próximos, Wiki, Foro, Shop) conservan su funcion; lo que
 * cambia en esta ronda es el acabado: cada boton es una tarjeta con esquinas cortadas, como
 * la fila de "modos" del plano de referencia, con icono, etiqueta en mayusculas y una marca
 * naranja en la tarjeta activa. Objetivos tactiles >= 44 px y safe-area en movil.
 */
export type ActivePanel = 'state' | 'history' | 'upcoming' | 'wiki' | 'forum' | 'shop' | null;

interface Props {
  activePanel: ActivePanel;
  onselectpanel: (panel: ActivePanel) => void;
  /** Paneles a mostrar (preferencias del usuario). Por defecto, los seis. */
  panels?: Exclude<ActivePanel, null>[];
}

const { activePanel, onselectpanel, panels }: Props = $props();

const dockItems: { id: Exclude<ActivePanel, null>; label: string; sub: string }[] = [
  { id: 'state', label: 'Estado', sub: 'Salud de piezas' },
  { id: 'history', label: 'Historial', sub: 'Mantenimientos' },
  { id: 'upcoming', label: 'Próximos', sub: 'Compromisos' },
  { id: 'wiki', label: 'Wiki', sub: 'Ficha técnica' },
  { id: 'forum', label: 'Foro', sub: 'Comunidad' },
  { id: 'shop', label: 'Shop', sub: 'Repuestos' },
];

const visibleItems = $derived(panels ? dockItems.filter((i) => panels.includes(i.id)) : dockItems);
</script>

{#if visibleItems.length > 0}
<nav class="bottom-dock-root" aria-label="Navegación de paneles del Garage">
  <div class="dock-container">
    {#each visibleItems as item (item.id)}
      {@const isActive = activePanel === item.id}
      <button
        type="button"
        class="dock-btn card-frame chamfer-sm {isActive ? 'active' : ''}"
        aria-pressed={isActive}
        aria-label="Panel de {item.label}"
        onclick={() => onselectpanel(isActive ? null : item.id)}
      >
        <span class="card-inner chamfer-sm dock-inner">
          <span class="dock-label">
            {#if isActive}<span class="swal-tick" aria-hidden="true"></span>{/if}
            {item.label}
          </span>
          <span class="dock-sub">{item.sub}</span>
        </span>
      </button>
    {/each}
  </div>
</nav>
{/if}

<style>
  .bottom-dock-root {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 0.35rem 0 0;
    pointer-events: auto;
  }

  .dock-container {
    display: flex;
    align-items: stretch;
    gap: 0.35rem;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .dock-container::-webkit-scrollbar {
    display: none;
  }

  .card-frame {
    background: var(--g3-line);
    padding: 1px;
    border: none;
    cursor: pointer;
    transition: background-color 160ms ease, transform 160ms ease;
  }
  .card-frame:hover {
    background: var(--g3-ink-graphite);
    transform: translateY(-1px);
  }
  .card-frame.active {
    background: var(--g3-orange);
  }
  .card-inner {
    background: var(--g3-card);
    display: block;
  }
  .chamfer-sm {
    clip-path: polygon(
      5px 0, 100% 0,
      100% calc(100% - 5px), calc(100% - 5px) 100%,
      0 100%, 0 5px
    );
  }

  .dock-btn {
    flex: none;
    min-width: 96px;
    min-height: 40px;
  }
  .dock-inner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.05rem;
    padding: 0.3rem 0.5rem;
    height: 100%;
  }

  .dock-label {
    font-family: var(--g-font-condensed, 'Inter', sans-serif);
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--g3-ink);
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .dock-sub {
    font-size: 9px;
    color: var(--g3-ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .dock-btn.active .dock-sub {
    color: color-mix(in oklab, var(--g3-ink) 70%, transparent);
  }

  @media (max-width: 767px) {
    .bottom-dock-root {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 45;
      background: var(--g3-sheet);
      padding: 0.35rem 0.5rem calc(0.35rem + env(safe-area-inset-bottom, 8px));
      border-top: 1px solid var(--g3-line);
      box-shadow: var(--swal-shadow-sm);
    }
    .dock-container {
      width: 100%;
      justify-content: space-around;
      gap: 0.25rem;
    }
    .dock-btn {
      flex: 1;
      min-width: 0;
      max-width: 58px;
      min-height: 40px;
    }
    .dock-sub {
      display: none;
    }
    .dock-inner {
      align-items: center;
      padding: 0.3rem 0.15rem;
    }
    .dock-label .swal-tick {
      display: none;
    }
    .dock-label {
      font-size: 9.5px;
      letter-spacing: 0.02em;
    }
  }
</style>