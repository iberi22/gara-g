<script lang="ts">
/**
 * PanelState.svelte — Panel de Estado del vehículo (salud de piezas por ranura).
 *
 * Sincronizado bidireccionalmente con el 3D:
 * - Muestra la lista de piezas con porcentaje de salud y barra de color.
 * - Permite cambiar el modo de vista (Belleza ◐, Salud ▣, Rayos X ✚).
 * - Enfoca la pieza en el motor 3D al hacer clic en ella.
 * - Sirve anuncio contextual patrocinado si una pieza presenta advertencia o desgaste crítico.
 */
import type { PartCategory, PartSlotId, PartState, ServedAd, ViewMode } from '../../garage/contracts';
import { adTracker } from './ads';
import { garageApi } from './api';
import { formatCOP, formatKm } from './formatters';

interface Props {
  parts: PartState[];
  selectedPartId: PartSlotId | null;
  currentViewMode: ViewMode;
  onfocuspart: (slotId: PartSlotId | null) => void;
  onsetviewmode: (mode: ViewMode) => void;
  /** Unidad de los km de las piezas ('h' en maquinaria). */
  unit?: 'km' | 'h';
}

const { parts, selectedPartId, currentViewMode, onfocuspart, onsetviewmode, unit = 'km' }: Props = $props();

let selectedCategory = $state<string>('all');
let contextualAds = $state<ServedAd[]>([]);
let adElements = new Map<string, HTMLElement>();

const categories = $derived.by(() => {
  const cats = new Set<string>();
  for (const p of parts) cats.add(p.category);
  return ['all', ...Array.from(cats)];
});

const filteredParts = $derived.by(() => {
  if (selectedCategory === 'all') return parts;
  return parts.filter((p) => p.category === selectedCategory);
});

function getStatusBadge(status: PartState['status']): { label: string; color: string; bg: string } {
  switch (status) {
    case 'ok':
      return { label: 'Óptimo', color: 'var(--swal-success)', bg: 'var(--swal-success-muted)' };
    case 'warn':
      return { label: 'Atención', color: 'var(--swal-warning)', bg: 'var(--swal-warning-muted)' };
    case 'critical':
      return { label: 'Crítico', color: 'var(--swal-danger)', bg: 'var(--swal-danger-muted)' };
    case 'overdue':
      // Vencido es el estado mas grave: relleno solido, no tinte.
      return { label: 'Vencido', color: 'var(--swal-on-danger)', bg: 'var(--swal-danger)' };
    default:
      return { label: 'Sin datos', color: 'var(--g3-ink-muted)', bg: 'var(--swal-hover-bg)' };
  }
}

function getHealthColor(healthPct: number | null): string {
  if (healthPct === null) return 'var(--g3-ink-muted)';
  if (healthPct >= 65) return 'var(--swal-success)';
  if (healthPct >= 35) return 'var(--swal-warning)';
  return 'var(--swal-danger)';
}

$effect(() => {
  // Cargar anuncio contextual para piezas en advertencia/crítico
  const hasWornParts = parts.some((p) => p.status === 'warn' || p.status === 'critical' || p.status === 'overdue');
  if (hasWornParts) {
    void garageApi.serveAd({ slot: 'part_context' }).then((ads) => {
      contextualAds = ads;
    });
  }
});

function registerAdRef(el: HTMLElement | null, token: string) {
  if (el) {
    adElements.set(token, el);
    adTracker.observe(el, token);
  }
}
</script>

<div class="panel-state-root">
  <!-- Selector de modo de visualización 3D -->
  <div class="viewmode-bar swal-card-frame">
    <div class="viewmode-inner swal-card-inner">
    <span class="bar-label swal-kicker">Modo 3D</span>
    <div class="viewmode-pills" role="radiogroup" aria-label="Modo de renderizado">
      <button
        type="button"
        class="mode-btn {currentViewMode === 'beauty' ? 'active' : ''}"
        role="radio"
        aria-checked={currentViewMode === 'beauty'}
        onclick={() => onsetviewmode('beauty')}
      >
        <span class="icon">◐</span> Belleza
      </button>
      <button
        type="button"
        class="mode-btn {currentViewMode === 'health' ? 'active' : ''}"
        role="radio"
        aria-checked={currentViewMode === 'health'}
        onclick={() => onsetviewmode('health')}
      >
        <span class="icon">▣</span> Salud
      </button>
      <button
        type="button"
        class="mode-btn {currentViewMode === 'xray' ? 'active' : ''}"
        role="radio"
        aria-checked={currentViewMode === 'xray'}
        onclick={() => onsetviewmode('xray')}
      >
        <span class="icon">✚</span> Rayos X
      </button>
    </div>
    </div>
  </div>

  <!-- Filtro por categoría -->
  <div class="category-scroll" role="tablist" aria-label="Filtro de piezas">
    {#each categories as cat}
      <button
        type="button"
        class="cat-chip {selectedCategory === cat ? 'active' : ''}"
        onclick={() => (selectedCategory = cat)}
      >
        {cat === 'all' ? 'Todas las piezas' : cat.toUpperCase()}
      </button>
    {/each}
  </div>

  <!-- Lista de piezas -->
  <div class="parts-list" role="list">
    {#each filteredParts as part (part.slotId)}
      {@const badge = getStatusBadge(part.status)}
      {@const isSelected = selectedPartId === part.slotId}
      {@const healthColor = getHealthColor(part.healthPct)}

      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="part-frame swal-card-frame {isSelected ? 'is-active selected' : ''}"
        role="listitem"
        tabindex="0"
        onclick={() => onfocuspart(isSelected ? null : part.slotId)}
      >
       <div class="part-card swal-card-inner">
        <div class="card-header">
          <div class="part-main">
            <span class="part-title">{part.label}</span>
            <span class="part-category-tag">{part.category}</span>
          </div>
          <span
            class="status-pill"
            style:color={badge.color}
            style:background={badge.bg}
          >
            {badge.label}
          </span>
        </div>

        <!-- Indicador de barra de salud -->
        <div class="health-row">
          <div class="health-meta">
            <span class="meta-label swal-kicker">SALUD RESTANTE</span>
            <span class="health-val" style:color={healthColor}>
              {part.healthPct !== null ? `${part.healthPct}%` : 'N/D'}
            </span>
          </div>
          <div class="health-track">
            <div
              class="health-fill"
              style:width="{part.healthPct ?? 0}%"
              style:background={healthColor}
            ></div>
          </div>
        </div>

        <!-- Métricas complementarias -->
        {#if part.nextDueKm || part.kmSinceService || part.estCostCOP}
          <div class="part-metrics">
            {#if part.kmSinceService !== undefined}
              <div class="metric">
                <span class="m-lbl">Uso:</span>
                <span class="m-val">{formatKm(part.kmSinceService, unit)}</span>
              </div>
            {/if}
            {#if part.nextDueKm !== undefined}
              <div class="metric">
                <span class="m-lbl">Cambio en:</span>
                <span class="m-val">{formatKm(part.nextDueKm, unit)}</span>
              </div>
            {/if}
            {#if part.estCostCOP !== undefined}
              <div class="metric cost">
                <span class="m-lbl">Costo est.:</span>
                <span class="m-val">{formatCOP(part.estCostCOP)}</span>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Anuncio patrocinado contextual para piezas desgastadas -->
        {#if (part.status === 'warn' || part.status === 'critical' || part.status === 'overdue') && contextualAds.length > 0}
          {@const ad = contextualAds[0]}
          <div
            class="contextual-ad-box"
            use:registerAdRef={ad.token}
          >
            <div class="ad-top">
              <span class="sponsored-badge">Patrocinado</span>
              <span class="advertiser-name">{ad.creative.advertiserName}</span>
            </div>
            <p class="ad-title">{ad.creative.title}</p>
            <p class="ad-body">{ad.creative.body}</p>
            <a
              href={garageApi.getAdClickUrl(ad.token)}
              target="_blank"
              rel="noopener noreferrer"
              class="ad-cta-btn"
              onclick={(e) => e.stopPropagation()}
            >
              {ad.creative.ctaLabel}
            </a>
          </div>
        {/if}
       </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .panel-state-root {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Barra de modo 3D: tarjeta de plano con esquinas cortadas (marco = borde de 1px). */
  .viewmode-inner {
    padding: 0.5rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .bar-label {
    font-size: 10.5px;
    letter-spacing: 0.14em;
  }
  .viewmode-pills {
    display: flex;
    gap: 0.25rem;
  }
  .mode-btn {
    background: transparent;
    border: 1px solid var(--g3-line);
    color: var(--g3-ink-muted);
    padding: 0.35rem 0.65rem;
    font-family: var(--g-font-mono, monospace);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
  }
  .mode-btn:hover {
    color: var(--g3-ink);
    border-color: var(--swal-border-strong);
    background: var(--swal-hover-bg);
  }
  .mode-btn.active {
    background: var(--swal-accent);
    border-color: var(--swal-accent);
    color: var(--swal-accent-contrast);
  }

  /* Chips de categorías */
  .category-scroll {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
    scrollbar-width: none;
  }
  .category-scroll::-webkit-scrollbar {
    display: none;
  }
  .cat-chip {
    white-space: nowrap;
    background: var(--g3-chip-bg);
    border: 1px solid var(--g3-line);
    color: var(--g3-ink-muted);
    padding: 0.3rem 0.7rem;
    font-family: var(--g-font-mono, monospace);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
  }
  .cat-chip:hover {
    color: var(--g3-ink);
    border-color: var(--swal-border-strong);
  }
  .cat-chip.active {
    background: var(--swal-accent);
    border-color: var(--swal-accent);
    color: var(--swal-accent-contrast);
  }

  /* Lista de tarjetas de piezas: marco de 1px + interior (clip-path de .swal-card-frame). */
  .parts-list {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .part-frame {
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .parts-list .part-frame:hover:not(.is-active) {
    background: var(--swal-border-strong);
  }
  .part-frame:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }
  .part-card {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .part-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .part-title {
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--g3-ink);
  }
  .part-category-tag {
    font-family: var(--g-font-mono, monospace);
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--g3-stamp-ink);
  }
  .status-pill {
    flex: none;
    font-family: var(--g-font-mono, monospace);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.2rem 0.55rem;
  }

  /* Fila de salud y barra */
  .health-row {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .health-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .meta-label {
    font-size: 10px;
    letter-spacing: 0.12em;
  }
  .health-val {
    font-family: var(--g-font-mono, monospace);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .health-track {
    width: 100%;
    height: 6px;
    background: var(--swal-surface-active);
    border: 1px solid var(--g3-line);
    box-sizing: border-box;
    overflow: hidden;
  }
  .health-fill {
    height: 100%;
    transition: width 240ms ease-out;
  }

  /* Métricas */
  .part-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--g3-line);
  }
  .metric {
    display: flex;
    gap: 0.3rem;
    font-size: 0.72rem;
  }
  .m-lbl {
    color: var(--g3-ink-muted);
  }
  .m-val {
    font-family: var(--g-font-mono, monospace);
    color: var(--g3-ink-soft);
    font-weight: 600;
  }

  /* Anuncio contextual */
  .contextual-ad-box {
    margin-top: 0.4rem;
    background: var(--swal-accent-muted);
    border: 1px dashed var(--swal-border-strong);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .ad-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .sponsored-badge {
    font-family: var(--g-font-mono, monospace);
    text-transform: uppercase;
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 0.1rem 0.4rem;
  }
  .advertiser-name {
    font-size: 0.68rem;
    color: var(--g3-ink-muted);
  }
  .ad-title {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--swal-accent-text);
    margin: 0;
  }
  .ad-body {
    font-size: 0.74rem;
    color: var(--g3-ink-soft);
    margin: 0;
    line-height: 1.35;
  }
  .ad-cta-btn {
    align-self: flex-start;
    display: inline-block;
    background: transparent;
    border: 1px solid var(--swal-accent);
    color: var(--swal-accent-text);
    text-decoration: none;
    font-family: var(--g-font-mono, monospace);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.3rem 0.75rem;
    margin-top: 0.2rem;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .ad-cta-btn:hover {
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
  }
</style>
