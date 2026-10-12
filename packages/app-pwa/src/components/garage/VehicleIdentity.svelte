<script lang="ts">
/**
 * VehicleIdentity.svelte — Columna izquierda del configurador.
 *
 * Traslada el bloque de título de la referencia: ceja "MARCA // VERSIÓN" con punto naranja,
 * titular del vehículo en mayúsculas con font-size fluido (clamp) sin truncar, subtítulo
 * condensado (placa · año · odómetro), tres datos con etiquetas claras y sin elipsis ("SALUD",
 * "ODÓM.", "PRÓXIMO"), pista de controles de órbita y tarjeta "ACABADO Y COLOR" colapsable en
 * móvil para reservar espacio al escenario 3D.
 *
 * La pintura se persiste por vehículo en localStorage (`garage:paint:<vehicleId>`) y se
 * reporta al padre, que la aplica al motor con `setPaint`.
 */
import type { GarageVehicle, PaintFinish } from '../../garage/contracts';
import { GUEST_BLOCKED_PATH, getClientMode } from '../../lib/appMode';
import { PAINT_OPTIONS, PAINT_SAMPLES, finishLabel, normalizeHex } from './paint';

interface Props {
  vehicle: GarageVehicle;
  /** Muestra activa (hex sin #). */
  activeHex: string;
  /** Acabado activo. */
  finish: PaintFinish;
  onpickpaint: (hex: string, finish: PaintFinish) => void;
  /** Muestra de odometro ya formateada (la aporta la fila de estado). */
  odometerText: string;
  /** Proximo cambio ya formateado ("-350 km", "en 4.400 km"). */
  nextChangeText: string;
  /** Salud global ya formateada ("71 %"). */
  healthText: string;
}

const {
  vehicle,
  activeHex,
  finish,
  onpickpaint,
  odometerText,
  nextChangeText,
  healthText,
} = $props();

/** Sin cuenta, el expediente (manuales, ficha en el servidor, asistente IA) no esta disponible. */
const guest = getClientMode() === 'guest';

const currentHex = $derived(normalizeHex(vehicle.spec.paint.baseColor) ?? '14171C');
const activeOption = $derived(PAINT_OPTIONS.find((o) => o.finish === finish));
let isFinishOpen = $state(false);

/**
 * Reparte el nombre del vehiculo en hasta 4 lineas de una o dos palabras, como el titular de
 * cuatro renglones de la referencia ("GOTHAM / MOVES / FASTER IN / DARKNESS"). El nombre
 * puede venir largo del usuario, asi que se parte por palabras y se limita el ancho de linea
 * para que ninguna se corte a mitad. Una sola palabra muy larga cae sola en su linea y se
 * recorta con puntos suspensivos via CSS.
 */
const headlineLines = $derived.by(() => {
  const words = vehicle.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['VEHICULO'];
  const maxLines = 4;
  const maxWordsPerLine = 2;
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
    } else if (current.split(/\s+/).length < maxWordsPerLine && lines.length < maxLines - 1) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
});
/** Parte "64.210 km" en numero y unidad para que la unidad se pueda encoger al vuelo. */
function splitUnit(text: string): { number: string; unit: string } {
  const m = /^([^\s]+)\s*(.*)$/.exec(text.trim());
  return m ? { number: m[1], unit: m[2] ?? '' } : { number: text, unit: '' };
}
</script>

<section class="vehicle-identity" aria-label="Identificación del vehículo">
  <!-- Ceja de marca y versión -->
  <div class="eyebrow">
    <span class="eyebrow-dot" aria-hidden="true"></span>
    <p class="eyebrow-text">
      {vehicle.make ?? vehicle.version.make ?? 'MARCA'}
      <span class="slash">//</span>
      {vehicle.version.label}
    </p>
  </div>

  <!-- Titular: nombre en mayusculas. El nombre del usuario puede traer espacios, asi que se
       parte en un maximo de 4 lineas para no desbordar la columna. -->
  <h1 class="headline">
    {#each headlineLines as line, i (i)}
      <span class="headline-line">{line}</span>
    {/each}
  </h1>

  <!-- Subtitulo condensado: placa · ano · odometro -->
  <p class="subline">
    {[vehicle.plate, vehicle.year, odometerText].filter(Boolean).join(' · ')}
  </p>

  <!-- Tres datos con reglas verticales -->
  <div class="stats">
    <div class="stat">
      <span class="stat-label">SALUD</span>
      <span class="stat-value">{splitUnit(healthText).number}{#if splitUnit(healthText).unit}<span class="unit">{splitUnit(healthText).unit}</span>{/if}</span>
    </div>
    <div class="stat">
      <span class="stat-label">{vehicle.usageUnit === 'h' ? 'HORÓM.' : 'ODÓM.'}</span>
      <span class="stat-value">{splitUnit(odometerText).number}{#if splitUnit(odometerText).unit}<span class="unit">{splitUnit(odometerText).unit}</span>{/if}</span>
    </div>
    <div class="stat">
      <span class="stat-label">PRÓXIMO</span>
      <span class="stat-value">{splitUnit(nextChangeText).number}{#if splitUnit(nextChangeText).unit}<span class="unit">{splitUnit(nextChangeText).unit}</span>{/if}</span>
    </div>
  </div>

  <!-- Expediente: manuales, ficha, mecanica y asistente de IA del vehiculo -->
  <a class="dossier-link swal-chamfer-sm" href={guest ? GUEST_BLOCKED_PATH : `/fleet/garage/expediente/${encodeURIComponent(vehicle.id)}`}>
    <span class="dossier-link-label">EXPEDIENTE</span>
    <span class="dossier-link-sub">{guest ? 'Disponible con cuenta' : 'Manuales · ficha · asistente IA'}</span>
    <span class="dossier-link-arrow" aria-hidden="true">→</span>
  </a>

  <!-- Pista de controles del canvas -->
  <div class="orbit-hint">
    <svg class="hint-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <ellipse cx="10" cy="10" rx="8" ry="4.2" />
      <path d="M10 2C12.5 2 14.5 5.6 14.5 10C14.5 14.4 12.5 18 10 18C7.5 18 5.5 14.4 5.5 10C5.5 5.6 7.5 2 10 2Z" stroke-dasharray="2 2" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
    </svg>
    <span class="hint-text">Arrastra para orbitar · rueda para zoom · doble clic para reset</span>
  </div>

  <!-- Tarjeta ACABADO Y COLOR (colapsable en móvil) -->
  <div class="finish-card swal-card-frame" class:collapsed-mobile={!isFinishOpen}>
    <div class="finish-inner swal-card-inner">
      <button
        type="button"
        class="finish-head-btn"
        onclick={() => (isFinishOpen = !isFinishOpen)}
        aria-expanded={isFinishOpen}
        aria-label="Alternar panel de acabado y color"
      >
        <div class="finish-head-left">
          <span class="finish-swatch-pip swal-chamfer-sm" style:background={`#${activeHex}`} aria-hidden="true"></span>
          <span class="finish-title">ACABADO Y COLOR</span>
        </div>
        <div class="finish-head-right">
          <span class="finish-code">{activeOption?.label ?? finishLabel(finish)}</span>
          <span class="collapse-chevron" aria-hidden="true">{isFinishOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      <div class="finish-body" class:is-collapsed={!isFinishOpen}>
        <div class="swatches" role="radiogroup" aria-label="Color de la carrocería">
          {#each PAINT_SAMPLES as sample (sample.hex)}
            {@const isActive = sample.hex === activeHex}
            {@const isVehicleColor = sample.hex === currentHex}
            <button
              type="button"
              class="swatch-box swal-chamfer-sm {isActive ? 'active' : ''}"
              role="radio"
              aria-checked={isActive}
              aria-label={sample.label}
              title={sample.label}
              onclick={() => onpickpaint(sample.hex, finish)}
            >
              <span class="swatch-fill swal-chamfer-sm" style:background={`#${sample.hex}`}>
                {#if isVehicleColor && !isActive}
                  <span class="swatch-current" aria-hidden="true"></span>
                {/if}
              </span>
            </button>
          {/each}
        </div>

        <div class="finish-foot">
          <div class="finish-selects" role="radiogroup" aria-label="Tipo de acabado">
            {#each PAINT_OPTIONS as option (option.finish)}
              <button
                type="button"
                class="finish-chip {option.finish === finish ? 'active' : ''}"
                role="radio"
                aria-checked={option.finish === finish}
                aria-label={option.hint}
                title={option.hint}
                onclick={() => onpickpaint(activeHex, option.finish)}
              >
                {option.label}
              </button>
            {/each}
          </div>
          <span class="finish-name">{activeOption?.label ?? finishLabel(finish)}</span>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .vehicle-identity {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    pointer-events: auto;
    min-width: 0;
  }

  /* Ceja */
  .eyebrow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .eyebrow-dot {
    width: 6px;
    height: 6px;
    background: var(--g3-orange);
    flex: none;
  }
  .eyebrow-text {
    margin: 0;
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--g3-ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slash {
    color: var(--swal-accent-text);
    font-weight: 600;
  }

  /* Titular */
  .headline {
    margin: 0;
    font-family: var(--g-font-display, 'Inter', sans-serif);
    font-weight: 800;
    text-transform: uppercase;
    color: var(--g3-ink);
    line-height: 0.95;
    letter-spacing: -0.01em;
    /* Titular con font-size fluido (clamp) sin truncar */
    font-size: clamp(1.15rem, 1.8vw + 0.35vh, 2rem);
  }
  .headline-line {
    display: block;
    white-space: nowrap;
    overflow: visible;
  }
  .headline-line:last-child::after {
    content: '/';
    color: var(--swal-accent-text);
    margin-left: 0.15em;
  }

  .subline {
    margin: 0;
    font-family: var(--g-font-condensed, 'Inter', sans-serif);
    font-weight: 700;
    font-size: clamp(10px, 0.8vw, 11.5px);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--g3-ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Tres datos con reglas verticales */
  .dossier-link {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 10px;
    margin-top: 12px;
    padding: 9px 12px;
    background: var(--swal-text);
    color: var(--swal-text-inverse);
    text-decoration: none;
    transition: background-color 0.15s ease, color 0.15s ease;
  }
  .dossier-link:hover,
  .dossier-link:focus-visible {
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
  }
  .dossier-link-label {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
  }
  .dossier-link-sub {
    grid-row: 2;
    font-size: 11px;
    opacity: 0.75;
  }
  .dossier-link-arrow {
    grid-row: 1 / span 2;
    grid-column: 2;
    font-size: 18px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--g3-line);
    border-bottom: 1px solid var(--g3-line);
  }
  .stat {
    padding: 0.35rem 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .stat + .stat {
    border-left: 1px solid var(--g3-line);
    padding-left: 0.4rem;
  }
  .stat-label {
    font-size: clamp(8px, 0.68vw, 9.5px);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--g3-ink-muted);
    white-space: nowrap;
    overflow: visible;
  }
  .stat-value {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: clamp(11.5px, 0.95vw, 13px);
    font-weight: 700;
    color: var(--g3-ink);
    line-height: 1.15;
    white-space: nowrap;
    overflow: visible;
  }
  /* La unidad va en un span propio para poder encogerla sin tocar el numero. */
  .stat-value :global(.unit) {
    font-size: 9.5px;
    font-weight: 600;
    color: var(--g3-ink-muted);
    margin-left: 0.15em;
  }
  .stat:last-child .stat-value {
    color: var(--swal-accent-text);
  }

  /* Pista de controles */
  .orbit-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--g3-ink-muted);
  }
  .hint-icon {
    width: 14px;
    height: 14px;
    color: var(--swal-accent-text);
    flex: none;
  }
  .hint-text {
    font-size: 9.5px;
    letter-spacing: 0.01em;
    line-height: 1.25;
  }

  /* Tarjeta de acabado: marco/relleno/esquinas vienen de .swal-card-frame del tema. */
  .finish-inner {
    padding: 0.45rem 0.6rem;
  }

  .finish-card {
    margin-top: auto;
  }
  .finish-head-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
    margin-bottom: 0.35rem;
  }
  .finish-head-left {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .finish-swatch-pip {
    width: 10px;
    height: 10px;
    display: inline-block;
    border: 1px solid var(--g3-line);
  }
  .finish-head-right {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .finish-title {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--g3-ink-muted);
  }
  .finish-code {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 8.5px;
    color: var(--g3-stamp-ink);
  }
  .collapse-chevron {
    display: none;
    font-size: 8px;
    color: var(--swal-accent-text);
  }

  .finish-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .swatches {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .swatch-box {
    width: clamp(26px, 2.2vw, 32px);
    height: clamp(22px, 1.8vw, 26px);
    padding: 2px;
    background: var(--g3-swatch-frame);
    border: none;
    cursor: pointer;
    transition: background-color 160ms ease;
  }
  .swatch-box.active {
    background: var(--swal-accent);
  }
  .swatch-fill {
    display: block;
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }
  .swatch-current {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 5px;
    height: 5px;
    background: var(--swal-accent);
  }

  .finish-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    margin-top: 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--g3-line-soft);
  }
  .finish-selects {
    display: flex;
    gap: 0.2rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .finish-chip {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--g3-ink-soft);
    background: var(--g3-chip-bg);
    border: 1px solid var(--g3-line);
    padding: 0.15rem 0.26rem;
    cursor: pointer;
    transition: all 140ms ease;
  }
  .finish-chip.active {
    background: var(--swal-accent);
    border-color: var(--swal-accent);
    color: var(--swal-accent-contrast);
  }
  .finish-chip:hover:not(.active) {
    border-color: var(--g3-ink);
  }
  .finish-name {
    font-size: 10px;
    font-weight: 600;
    color: var(--g3-ink);
    white-space: nowrap;
  }

  @media (max-width: 767px) {
    .vehicle-identity {
      gap: 0.4rem;
    }
    .headline {
      font-size: clamp(1.15rem, 5.5vw, 1.45rem);
    }
    .finish-card {
      margin-top: 0;
    }
    .finish-head-btn {
      cursor: pointer;
      margin-bottom: 0;
    }
    .collapse-chevron {
      display: inline-block;
    }
    .finish-body.is-collapsed {
      display: none;
    }
    .finish-inner {
      padding: 0.4rem 0.55rem;
    }
    .orbit-hint {
      display: none;
    }
  }
</style>