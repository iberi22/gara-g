<script lang="ts">
/**
 * PanelHistory.svelte — Panel de Historial de eventos del vehículo.
 *
 * Muestra la línea de tiempo de mantenimientos, cambio de repuestos, combustible
 * y trámites legales, con filtros por categoría y totales acumulados de costo.
 */
import type { HistoryEvent, HistoryKind } from '../../garage/contracts';
import { formatCOP, formatKm, formatTimeAgo } from './formatters';
import { MARKET } from '../../lib/market';

interface Props {
  events: HistoryEvent[];
  /** Unidad del km de cada evento ('h' en maquinaria). */
  unit?: 'km' | 'h';
}

const { events, unit = 'km' }: Props = $props();

let selectedFilter = $state<string>('all');

const filterOptions: { id: string; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'maintenance', label: 'Mantenimiento' },
  { id: 'part_change', label: 'Repuestos' },
  { id: 'fuel', label: 'Combustible' },
  { id: 'document', label: 'Documentos' },
  { id: 'alert', label: 'Alertas' },
];

const filteredEvents = $derived.by(() => {
  if (selectedFilter === 'all') return events;
  return events.filter((e) => e.kind === selectedFilter);
});

const totalCostCOP = $derived.by(() => {
  return filteredEvents.reduce((acc, curr) => acc + (curr.costCOP ?? 0), 0);
});

function getKindIcon(kind: HistoryKind): string {
  switch (kind) {
    case 'maintenance': return '🛠️';
    case 'part_change': return '⚙️';
    case 'fuel': return '⛽';
    case 'document': return '📄';
    case 'alert': return '⚠️';
    case 'dtc': return '⚡';
    default: return '📝';
  }
}
</script>

<div class="panel-history-root">
  <!-- Resumen de costos acumulados -->
  <div class="summary-card swal-card-frame is-active">
    <div class="summary-info swal-card-inner">
      <span class="summary-label swal-kicker"><span class="swal-tick" aria-hidden="true"></span> GASTO REGISTRADO // {filteredEvents.length} EVENTOS</span>
      <span class="summary-amount">{formatCOP(totalCostCOP)} {MARKET.currency}</span>
    </div>
  </div>

  <!-- Filtro por tipo -->
  <div class="filter-pills" role="tablist" aria-label="Filtro de historial">
    {#each filterOptions as opt}
      <button
        type="button"
        class="filter-chip {selectedFilter === opt.id ? 'active' : ''}"
        onclick={() => (selectedFilter = opt.id)}
      >
        {opt.label}
      </button>
    {/each}
  </div>

  <!-- Línea de tiempo -->
  {#if filteredEvents.length === 0}
    <div class="empty-state">
      <span class="empty-icon">📂</span>
      <p class="empty-title">Sin registros en este filtro</p>
      <p class="empty-desc">No se encontraron eventos asociados a esta categoría.</p>
    </div>
  {:else}
    <div class="timeline" role="list">
      {#each filteredEvents as evt (evt.id)}
        <div class="timeline-item" role="listitem">
          <div class="timeline-marker">
            <span class="marker-icon">{getKindIcon(evt.kind)}</span>
            <div class="marker-line"></div>
          </div>
          <div class="timeline-content swal-card-frame">
           <div class="timeline-inner swal-card-inner">
            <div class="item-header">
              <span class="item-title">{evt.title}</span>
              {#if evt.costCOP}
                <span class="item-cost">{formatCOP(evt.costCOP)}</span>
              {/if}
            </div>

            {#if evt.detail}
              <p class="item-detail">{evt.detail}</p>
            {/if}

            <div class="item-meta">
              <span class="item-time">{formatTimeAgo(evt.at)}</span>
              {#if evt.km !== undefined}
                <span class="item-km">· {formatKm(evt.km, unit)}</span>
              {/if}
            </div>
           </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel-history-root {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Total acumulado: tarjeta con marco naranja (is-active) y rótulo mono. */
  .summary-info {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.85rem 1rem;
  }
  .summary-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.65rem;
    font-weight: 700;
  }
  .summary-amount {
    font-family: var(--swal-font-mono);
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--swal-accent-text);
  }

  .filter-pills {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
    scrollbar-width: none;
  }
  .filter-pills::-webkit-scrollbar {
    display: none;
  }
  .filter-chip {
    white-space: nowrap;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
    color: var(--swal-text-secondary);
    padding: 0.3rem 0.65rem;
    border-radius: var(--swal-radius-sm);
    font-family: var(--swal-font-mono);
    font-size: 0.64rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .filter-chip:hover {
    color: var(--swal-text);
    background: var(--swal-surface-hover);
    border-color: var(--swal-accent);
  }
  .filter-chip:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }
  .filter-chip.active {
    background: var(--swal-accent);
    border-color: var(--swal-accent);
    color: var(--swal-accent-contrast);
    font-weight: 700;
  }

  .timeline {
    display: flex;
    flex-direction: column;
    padding-top: 0.5rem;
  }
  .timeline-item {
    display: flex;
    gap: 0.75rem;
    position: relative;
  }
  .timeline-marker {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 28px;
    flex-shrink: 0;
  }
  .marker-icon {
    font-size: 0.9rem;
    width: 24px;
    height: 24px;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
    border-radius: var(--swal-radius-sm);
    display: grid;
    place-items: center;
    z-index: 2;
  }
  .marker-line {
    flex: 1;
    width: 1px;
    background: var(--swal-line-blueprint);
    margin: 4px 0;
  }
  .timeline-item:last-child .marker-line {
    display: none;
  }

  .timeline-content {
    flex: 1;
    min-width: 0;
    margin-bottom: 0.75rem;
  }
  .timeline-inner {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .item-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .item-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--swal-text);
  }
  .item-cost {
    font-family: var(--swal-font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--swal-warning);
    white-space: nowrap;
  }
  .item-detail {
    font-size: 0.76rem;
    color: var(--swal-text-secondary);
    margin: 0;
    line-height: 1.35;
  }
  .item-meta {
    font-family: var(--swal-font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    color: var(--swal-text-muted);
    display: flex;
    gap: 0.3rem;
  }

  .empty-state {
    text-align: center;
    padding: 2.5rem 1rem;
    color: var(--swal-text-muted);
  }
  .empty-icon {
    font-size: 2rem;
    display: block;
    margin-bottom: 0.5rem;
  }
  .empty-title {
    font-weight: 600;
    color: var(--swal-text-secondary);
    margin: 0;
  }
  .empty-desc {
    font-size: 0.75rem;
    margin: 0.25rem 0 0;
  }
</style>
