<script lang="ts">
/**
 * BlueprintBackdrop.svelte — Plano técnico de fondo DETRÁS del vehículo 3D.
 *
 * Reproduce el lenguaje del plano del configurador de referencia: cuadrícula fina, líneas de
 * referencia, trazos oblicuos de replanteo, cruces fiduciales y sellos de rótulo en monoespaciada.
 * Se eliminó la silueta genérica 2D para que no desentone con las proporciones del vehículo 3D real
 * (cuyas cotas dinámicas provienen de la proyección de anclas del motor).
 *
 * No intercepta punteros: el arrastre de órbita es del canvas.
 */
import type { VehicleSpec } from '../../garage/contracts';
import { buildBlueprintGeometry } from './dimensions';

interface Props {
  spec: VehicleSpec;
  /** Apaga el plano (boton BP: ON/OFF). */
  visible?: boolean;
}

const { spec, visible = true }: Props = $props();

const g = $derived(buildBlueprintGeometry(spec.dims, spec.tireFront, spec.tireRear));
const vb = $derived(`${g.viewBox.width} ${g.viewBox.height}`);

/** Cruz fiducial (marca de replanteo) en los cruces de las lineas de referencia. */
const fiducials = $derived([
  { x: g.rearAxleX, y: g.groundY },
  { x: g.frontAxleX, y: g.groundY },
  { x: g.centerX, y: g.groundY - (g.groundY - g.roofY) * 0.5 },
]);

/** Familia en el sello del plano, en espanol (el contrato usa ids en ingles). */
const FAMILY_STAMP: Record<string, string> = { moto: 'MOTO', car: 'CARRO', heavy: 'CAMION', machinery: 'MAQUINARIA' };
</script>

<svg
  class="blueprint-backdrop"
  class:hidden={!visible}
  viewBox={vb}
  preserveAspectRatio="xMidYMid meet"
  aria-hidden="true"
  data-testid="blueprint-backdrop"
>
  <defs>
    <pattern id="g3-minor-grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--g3-grid-minor)" stroke-width="0.6" />
    </pattern>
    <pattern id="g3-major-grid" width="240" height="240" patternUnits="userSpaceOnUse">
      <rect width="240" height="240" fill="url(#g3-minor-grid)" />
      <path d="M 240 0 L 0 0 0 240" fill="none" stroke="var(--g3-grid-major)" stroke-width="0.9" />
    </pattern>
  </defs>

  <rect width={g.viewBox.width} height={g.viewBox.height} fill="url(#g3-major-grid)" opacity="0.6" />

  <!-- Lineas de referencia: suelo, eje de ruedas y verticales de los ejes. -->
  <g stroke="var(--g3-guide-ink)" stroke-width="0.9">
    <line x1="0" y1={g.groundY} x2={g.viewBox.width} y2={g.groundY} stroke="var(--g3-datum-ink)" stroke-width="1.1" />
    <line x1={g.rearAxleX - 30} y1={g.groundY - 8} x2={g.frontAxleX + 30} y2={g.groundY - 8} stroke-dasharray="6 4" />
    <line x1={g.rearAxleX} y1={g.roofY - 30} x2={g.rearAxleX} y2={g.groundY + 22} stroke-dasharray="5 4" />
    <line x1={g.frontAxleX} y1={g.roofY - 30} x2={g.frontAxleX} y2={g.groundY + 22} stroke-dasharray="5 4" />
  </g>

  <!-- Trazos oblicuos de replanteo. -->
  <g stroke="var(--g3-grid-major)" stroke-width="0.8" opacity="0.8">
    <line x1="60" y1={g.viewBox.height} x2={g.centerX + 160} y2="0" />
    <line x1={g.viewBox.width - 200} y1={g.viewBox.height} x2={g.centerX - 120} y2="0" />
  </g>

  <!-- Cruces fiduciales. -->
  <g stroke="var(--g3-fiducial-ink)" stroke-width="1">
    {#each fiducials as f (f.x + ':' + f.y)}
      <path d={`M ${f.x - 5} ${f.y} L ${f.x + 5} ${f.y} M ${f.x} ${f.y - 5} L ${f.x} ${f.y + 5}`} />
    {/each}
  </g>

  <!-- Sellos de rotulo del plano (monoespaciada, discretos). -->
  <text x="24" y="30" class="stamp">PLANO // {FAMILY_STAMP[spec.family] ?? spec.family.toUpperCase()} // ESCALA 1:10 // UNIDAD: MM</text>
  <text x={g.viewBox.width - 24} y="30" text-anchor="end" class="stamp">
    GARA-G // GARAJE DE FAMILIA
  </text>
</svg>

<style>
  .blueprint-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    opacity: 1;
    transition: opacity 240ms ease-out;
  }
  .blueprint-backdrop.hidden {
    opacity: 0;
  }

  .stamp {
    fill: var(--swal-text-muted);
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    letter-spacing: 0.14em;
  }

  @media (prefers-reduced-motion: reduce) {
    .blueprint-backdrop {
      transition: none;
    }
  }
</style>