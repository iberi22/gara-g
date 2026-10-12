<script lang="ts">
/**
 * PanelUpcoming.svelte — Panel de Próximos compromisos (mantenimientos y documentos).
 *
 * Lista las tareas pendientes y vencidas, con cálculo de kilómetros o días restantes,
 * badges de urgencia cromáticos y desglose de costo estimado.
 */
import type { Commitment } from '../../garage/contracts';
import { formatCOP, formatKm } from './formatters';

interface Props {
  commitments: Commitment[];
  /** Unidad de los km de los compromisos ('h' en maquinaria). */
  unit?: 'km' | 'h';
}

const { commitments, unit = 'km' }: Props = $props();

function getUrgencyBadge(urgency: Commitment['urgency']): { label: string; color: string; bg: string } {
  switch (urgency) {
    case 'overdue':
      return { label: 'VENCIDO', color: 'var(--swal-danger)', bg: 'var(--swal-danger-muted)' };
    case 'soon':
      return { label: 'PRÓXIMO', color: 'var(--swal-warning)', bg: 'var(--swal-warning-muted)' };
    case 'planned':
      return { label: 'PLANIFICADO', color: 'var(--swal-accent-text)', bg: 'var(--swal-accent-muted)' };
  }
}
</script>

<div class="panel-upcoming-root">
  {#if commitments.length === 0}
    <div class="empty-state">
      <span class="empty-icon">✅</span>
      <p class="empty-title">¡Al día!</p>
      <p class="empty-desc">No hay mantenimientos ni documentos vencidos o pendientes.</p>
    </div>
  {:else}
    <div class="commitments-list" role="list">
      {#each commitments as item (item.id)}
        {@const badge = getUrgencyBadge(item.urgency)}
        <div class="commitment-card swal-card-frame {item.urgency}" role="listitem">
         <div class="commitment-inner swal-card-inner">
          <div class="card-top">
            <span class="item-title">{item.title}</span>
            <span
              class="urgency-pill"
              style:color={badge.color}
              style:background={badge.bg}
            >
              {badge.label}
            </span>
          </div>

          <!-- Métricas de plazo -->
          <div class="deadline-row">
            {#if item.remainingKm !== undefined}
              <div class="deadline-metric">
                <span class="d-label">DISTANCIA //</span>
                <span class="d-val {item.remainingKm < 0 ? 'overdue' : ''}">
                  {item.remainingKm < 0 ? `Vencido por ${formatKm(Math.abs(item.remainingKm), unit)}` : `Faltan ${formatKm(item.remainingKm, unit)}`}
                </span>
              </div>
            {/if}

            {#if item.remainingDays !== undefined}
              <div class="deadline-metric">
                <span class="d-label">TIEMPO //</span>
                <span class="d-val {item.remainingDays < 0 ? 'overdue' : ''}">
                  {item.remainingDays < 0 ? `Vencido hace ${Math.abs(item.remainingDays)} días` : `En ${item.remainingDays} días`}
                </span>
              </div>
            {/if}
          </div>

          <!-- Pie con costo estimado y fuente -->
          <div class="card-bottom">
            <span class="source-tag">Origen: {item.source}</span>
            {#if item.estCostCOP}
              <span class="cost-tag">Est.: {formatCOP(item.estCostCOP)}</span>
            {/if}
          </div>
         </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel-upcoming-root {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .commitments-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* El marco (hairline) toma el color del estado: vencido = peligro, próximo = aviso. */
  :global(:root[data-theme^="taller"]) .commitment-card.overdue {
    background: var(--swal-danger);
  }
  :global(:root[data-theme^="taller"]) .commitment-card.soon {
    background: var(--swal-warning);
  }
  .commitment-inner {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .item-title {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--swal-text);
  }
  .urgency-pill {
    font-family: var(--swal-font-mono);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    padding: 0.2rem 0.5rem;
    border-radius: var(--swal-radius-xs);
    white-space: nowrap;
  }

  .deadline-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border);
    padding: 0.45rem 0.65rem;
  }
  .deadline-metric {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .d-label {
    font-family: var(--swal-font-mono);
    font-size: 0.62rem;
    color: var(--swal-text-muted);
    font-weight: 700;
    letter-spacing: 0.12em;
  }
  .d-val {
    font-family: var(--swal-font-mono);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--swal-accent-text);
  }
  .d-val.overdue {
    color: var(--swal-danger);
  }

  .card-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.7rem;
    color: var(--swal-text-secondary);
  }
  .source-tag {
    text-transform: capitalize;
  }
  .cost-tag {
    font-family: var(--swal-font-mono);
    font-weight: 700;
    color: var(--swal-warning);
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--swal-text-muted);
  }
  .empty-icon {
    font-size: 2.2rem;
    display: block;
    margin-bottom: 0.5rem;
  }
  .empty-title {
    font-weight: 700;
    color: var(--swal-success);
    font-size: 1.1rem;
    margin: 0;
  }
  .empty-desc {
    font-size: 0.78rem;
    margin: 0.3rem 0 0;
  }
</style>
