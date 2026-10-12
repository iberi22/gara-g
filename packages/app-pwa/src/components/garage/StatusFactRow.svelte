<script lang="ts">
/**
 * StatusFactRow.svelte — Fila de estado bajo el vehiculo, con puntos naranjas.
 *
 * Es la tira de datos del plano de referencia ("Ride height +55 mm", "Cannons Safed"), pero
 * con lo que el dominio ya calcula. En el centro va el selector de flota "◀ 2/4 ▶" con el
 * nombre del vehiculo entre barras ("// TOYOTA COROLLA //"); a los lados, los hechos. En
 * movil la fila hace scroll horizontal para no romper el lienzo.
 */
import type { ViewMode } from '../../garage/contracts';
import type { StatusFact } from './statusRow';

interface Props {
  facts: StatusFact[];
  fleetCounter: string;
  /** Nombre centrado entre barras (p. ej. "TOYOTA COROLLA"). */
  vehicleName: string;
  viewMode: ViewMode;
  onprev: () => void;
  onnext: () => void;
  onsetviewmode: (mode: ViewMode) => void;
}

const { facts, fleetCounter, vehicleName, viewMode, onprev, onnext, onsetviewmode }: Props = $props();
</script>

<div class="status-fact-row">
  <!-- Hechos a la izquierda -->
  <div class="fact-group" role="list" aria-label="Resumen de estado">
    {#each facts as fact (fact.id)}
      <span
        class="fact {fact.urgent ? 'urgent' : ''} {fact.muted ? 'muted' : ''}"
        role="listitem"
      >
        <span class="fact-dot" aria-hidden="true"></span>
        <span class="fact-label">{fact.label}</span>
        <span class="fact-value">{fact.value}</span>
      </span>
    {/each}
  </div>

  <!-- Selector de flota centrado con el nombre del vehiculo -->
  <div class="fleet-selector">
    <button
      type="button"
      class="fleet-arrow"
      aria-label="Vehículo anterior"
      onclick={onprev}
    >
      ◀
    </button>
    <div class="fleet-center">
      <span class="fleet-counter">{fleetCounter}</span>
      <span class="fleet-name">
        <span class="rule" aria-hidden="true"></span>
        {`// ${vehicleName.toUpperCase()} //`}
        <span class="rule" aria-hidden="true"></span>
      </span>
    </div>
    <button
      type="button"
      class="fleet-arrow"
      aria-label="Siguiente vehículo"
      onclick={onnext}
    >
      ▶
    </button>
  </div>

  <!-- Selector de modo 3D a la derecha -->
  <div class="mode-group" role="radiogroup" aria-label="Modo de visualización 3D">
    <button
      type="button"
      class="mode-btn {viewMode === 'beauty' ? 'active' : ''}"
      role="radio"
      aria-checked={viewMode === 'beauty'}
      aria-label="Modo estético"
      title="Modo estético"
      onclick={() => onsetviewmode('beauty')}
    >◐</button>
    <button
      type="button"
      class="mode-btn {viewMode === 'health' ? 'active' : ''}"
      role="radio"
      aria-checked={viewMode === 'health'}
      aria-label="Modo salud"
      title="Modo salud"
      onclick={() => onsetviewmode('health')}
    >▣</button>
    <button
      type="button"
      class="mode-btn {viewMode === 'xray' ? 'active' : ''}"
      role="radio"
      aria-checked={viewMode === 'xray'}
      aria-label="Modo rayos X"
      title="Modo rayos X"
      onclick={() => onsetviewmode('xray')}
    >✚</button>
  </div>
</div>

<style>
  .status-fact-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.3rem 0.6rem;
    background: var(--g3-strip-bg);
    border-top: 1px solid var(--g3-line);
    border-bottom: 1px solid var(--g3-line);
    pointer-events: auto;
    min-width: 0;
  }

  /* Hechos */
  .fact-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .fact {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 10px;
    white-space: nowrap;
  }
  .fact-dot {
    width: 5px;
    height: 5px;
    background: var(--g3-orange);
    flex: none;
  }
  .fact.muted .fact-dot {
    background: var(--g3-stamp-ink);
  }
  .fact-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 500;
    color: var(--g3-ink-muted);
  }
  .fact-value {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-weight: 700;
    color: var(--g3-ink);
  }
  .fact.urgent .fact-value {
    color: var(--swal-accent-text);
  }
  .fact.muted .fact-value {
    color: var(--g3-ink-soft);
  }

  /* Selector de flota */
  .fleet-selector {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: none;
  }
  .fleet-arrow {
    background: var(--g3-arrow-bg);
    border: 1px solid var(--g3-line);
    color: var(--g3-ink-soft);
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    cursor: pointer;
    font-size: 8.5px;
    transition: all 140ms ease;
  }
  .fleet-arrow:hover {
    border-color: var(--swal-accent);
    color: var(--swal-accent-text);
  }
  .fleet-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
    min-width: 0;
  }
  .fleet-counter {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--g3-ink-muted);
  }
  .fleet-name {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--g3-ink-muted);
    white-space: nowrap;
  }
  .rule {
    height: 1px;
    width: 16px;
    background: var(--g3-line);
  }

  /* Modo 3D */
  .mode-group {
    display: flex;
    gap: 0.2rem;
    flex: none;
  }
  .mode-btn {
    background: var(--g3-arrow-bg);
    border: 1px solid var(--g3-line);
    color: var(--g3-ink-muted);
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    cursor: pointer;
    font-size: 10px;
    transition: all 140ms ease;
  }
  .mode-btn:hover {
    border-color: var(--g3-ink);
    color: var(--g3-ink);
  }
  .mode-btn.active {
    background: var(--swal-accent);
    border-color: var(--swal-accent);
    color: var(--swal-accent-contrast);
  }

  @media (max-width: 767px) {
    .status-fact-row {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.6rem;
      padding: 0.35rem 0.5rem;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      white-space: nowrap;
      flex: none;
      width: 100%;
    }
    .status-fact-row::-webkit-scrollbar {
      display: none;
    }
    .fleet-selector {
      flex: none;
      order: 1;
    }
    .fact-group {
      flex: none;
      display: flex;
      gap: 0.6rem;
      overflow: visible;
      order: 2;
    }
    .mode-group {
      flex: none;
      order: 3;
    }
    .fleet-name {
      display: none;
    }
  }
</style>