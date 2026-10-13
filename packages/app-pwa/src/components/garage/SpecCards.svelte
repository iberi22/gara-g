<script lang="ts">
/**
 * SpecCards.svelte — Columna derecha: cuatro tarjetas de especificacion con corte.
 *
 * Cada tarjeta tiene el icono en recuadro, la etiqueta en monoespaciada, el VALOR grande y
 * un chevron que abre el panel correspondiente (el mismo gesto que las spec cards del
 * configurador de referencia). Los valores salen de los indicadores que ya calcula el
 * dominio; aqui solo se elige cual va en cada tarjeta y se formatea.
 */
import type { GarageVehicle, MonitoringState } from '../../garage/contracts';
import { formatLinkFact } from './statusRow';
import { formatMoney } from '../../lib/market';
import type { ActivePanel } from './BottomDock.svelte';

interface Props {
  vehicle: GarageVehicle;
  monitoring: MonitoringState | null;
  /** Ultimo gasto del mes, en la moneda del mercado, si el dominio lo tiene. */
  monthlyCostCOP?: number | null;
  onopenpanel: (panel: ActivePanel) => void;
}

const { vehicle, monitoring, monthlyCostCOP = null, onopenpanel }: Props = $props();

function indicator(id: string): { value: string; unit?: string; hint?: string } {
  const all = [...(vehicle.indicators.left ?? []), ...(vehicle.indicators.right ?? [])];
  const found = all.find((i) => i.id === id);
  return { value: found?.value ?? '', unit: found?.unit, hint: found?.hint };
}

/**
 * El dominio usa "—" para "sin cargas registradas" / "sin datos". Poner ese guion como VALOR
 * grande de una tarjeta de especificacion la deja visualmente vacia, asi que se traduce a
 * "SIN DATOS" y el `hint` del indicador pasa al subtitulo, que es donde el usuario lee
 * por que no hay dato.
 */
function displayValue(value: string): string {
  const v = value.trim();
  return v === '' || v === '—' ? 'SIN DATOS' : v;
}

/** Consumo: "6,5 km/L" o "SIN DATOS". */
const consumption = $derived.by(() => {
  const ind = indicator('eff');
  const shown = displayValue(ind.value);
  if (shown === 'SIN DATOS') return shown;
  return ind.unit ? `${shown} ${ind.unit}` : shown;
});
const consumptionSub = $derived.by(() => {
  const ind = indicator('eff');
  return shownOrDefault(ind.hint, 'Rendimiento medio');
});

function shownOrDefault(hint: string | undefined, fallback: string): string {
  const h = (hint ?? '').trim();
  return h === '' || h === '—' ? fallback : h;
}

/** Gasto del mes, en la moneda del mercado; cae al indicador del dominio si no hay otro. */
const spend = $derived.by(() => {
  const ind = indicator('cost');
  if (monthlyCostCOP !== null && monthlyCostCOP !== undefined) {
    return formatMoney(Math.round(monthlyCostCOP));
  }
  return displayValue(ind.value);
});

const spendSub = $derived(monthlyCostCOP !== null && monthlyCostCOP !== undefined ? 'Acumulado del mes' : 'Detalle en historial');

/** Alertas: compromisos pendientes que no son solo planificados. */
const alerts = $derived.by(() => {
  const active = (vehicle.commitments ?? []).filter((c) => c.status !== 'done' && c.urgency !== 'planned');
  return String(active.length);
});

const alertsSub = $derived.by(() => {
  const overdue = (vehicle.commitments ?? []).filter((c) => c.status !== 'done' && c.urgency === 'overdue').length;
  return overdue > 0 ? `${overdue} vencida${overdue === 1 ? '' : 's'}` : 'Sin vencidos';
});

/** APK / monitoreo. */
const linkMain = $derived(formatLinkFact(monitoring));
const linkSub = $derived.by(() => {
  const latest = monitoring?.latest;
  if (!latest) return 'Sin muestras';
  const dtc = latest.dtc?.length ?? 0;
  return dtc > 0 ? `${dtc} código${dtc === 1 ? '' : 's'} DTC` : 'Sin códigos DTC';
});

const cards = $derived([
  { id: 'consumo', label: 'Consumo', value: consumption, sub: consumptionSub, icon: fuelIcon, panel: 'history' as ActivePanel },
  { id: 'gasto', label: 'Gasto del mes', value: spend, sub: spendSub, icon: weightIcon, panel: 'history' as ActivePanel },
  { id: 'alertas', label: 'Alertas', value: alerts, sub: alertsSub, icon: shieldIcon, panel: 'upcoming' as ActivePanel },
  { id: 'apk', label: 'APK / Monitoreo', value: linkMain, sub: linkSub, icon: signalIcon, panel: 'state' as ActivePanel },
]);
</script>

<!-- Iconos en linea (paths) para no depender de una libreria de iconos. -->
<script module lang="ts">
  const fuelIcon = 'M3 15.5A3.5 3.5 0 0 1 6.5 12H11V4H5.5A2.5 2.5 0 0 0 3 6.5V15.5ZM11 12V4h1.5A2.5 2.5 0 0 1 15 6.5v6a1.5 1.5 0 1 0 3 0V9h1.5';
  const weightIcon = 'M4 7L7 3H13L16 7L17.5 16.5H2.5L4 7ZM7 11.5H13';
  const shieldIcon = 'M10 2L3.5 4.8V9.8C3.5 13.9 6.3 17.4 10 18.5C13.7 17.4 16.5 13.9 16.5 9.8V4.8L10 2ZM10 2V18.5';
  const signalIcon = 'M10 2.5A7.5 7.5 0 1 0 17.5 10H15A5 5 0 1 1 10 5V2.5ZM10 7A3 3 0 1 0 13 10H10V7ZM19.5 3.2L17.8 1.5a9.6 9.6 0 0 1 2 2l-.3-.3Z';
</script>

<aside class="spec-cards" aria-label="Especificaciones y estado del vehículo">
  {#each cards as card (card.id)}
    <button
      type="button"
      class="spec-card swal-card-frame"
      onclick={() => onopenpanel(card.panel)}
      aria-label="{card.label}: {card.value}. Abrir panel"
    >
      <span class="swal-card-inner spec-inner">
        <span class="spec-icon-box swal-chamfer-sm" aria-hidden="true">
          <svg class="spec-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d={card.icon} />
          </svg>
        </span>
        <span class="spec-text">
          <span class="spec-label">{card.label}</span>
          <span class="spec-value">{card.value}</span>
          <span class="spec-sub">{card.sub}</span>
        </span>
        <svg class="spec-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M6 3.5L10.5 8L6 12.5" stroke-linecap="square" />
        </svg>
      </span>
    </button>
  {/each}
</aside>

<style>
  .spec-cards {
    display: flex;
    flex-direction: column;
    gap: clamp(0.25rem, 0.5vh, 0.5rem);
    pointer-events: auto;
    min-width: 0;
  }

  /* Marco, relleno y esquinas cortadas: .swal-card-frame / .swal-card-inner del tema.
     Aqui solo el boton (reset) y el hover (mas especifico que la regla del tema). */
  .spec-cards .spec-card {
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background-color 180ms ease, transform 180ms ease;
  }
  .spec-cards .spec-card:hover,
  .spec-cards .spec-card:focus-visible {
    background: var(--swal-accent);
    transform: translateY(-1px);
  }
  .spec-cards .spec-card:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }

  .spec-inner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: clamp(0.35rem, 0.6vh, 0.55rem) clamp(0.45rem, 0.7vw, 0.7rem);
  }

  .spec-icon-box {
    width: 26px;
    height: 26px;
    background: var(--g3-icon-bg);
    border: 1px solid var(--g3-line);
    display: grid;
    place-items: center;
    flex: none;
  }
  .spec-icon {
    width: 14px;
    height: 14px;
    color: var(--g3-ink-graphite);
  }

  .spec-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    gap: 0.05rem;
  }
  .spec-label {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: clamp(8px, 0.65vw, 9px);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--g3-ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spec-value {
    font-family: var(--g-font-display, 'Inter', sans-serif);
    font-size: clamp(13.5px, 1.05vw, 17px);
    font-weight: 800;
    color: var(--g3-ink);
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spec-sub {
    font-size: clamp(8.5px, 0.65vw, 9.5px);
    color: var(--g3-ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spec-chevron {
    width: 13px;
    height: 13px;
    color: var(--g3-stamp-ink);
    flex: none;
    transition: color 150ms ease, transform 150ms ease;
  }
  .spec-card:hover .spec-chevron {
    color: var(--swal-accent-text);
    transform: translateX(2px);
  }

  @media (max-width: 767px) {
    /* En movil las cuatro tarjetas se vuelven una fila de chips con scroll. */
    .spec-cards {
      flex-direction: row;
      gap: 0.4rem;
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 0.15rem;
    }
    .spec-cards::-webkit-scrollbar {
      display: none;
    }
    .spec-card {
      flex: none;
      min-width: 140px;
    }
    .spec-inner {
      padding: 0.45rem 0.55rem;
      gap: 0.45rem;
    }
    .spec-icon-box {
      width: 26px;
      height: 26px;
    }
    .spec-value {
      font-size: 15px;
    }
    .spec-sub,
    .spec-chevron {
      display: none;
    }
  }
</style>