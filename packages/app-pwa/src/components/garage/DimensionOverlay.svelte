<script lang="ts">
/**
 * DimensionOverlay.svelte — Cotas de plano tecnico dibujadas ENCIMA del escenario 3D.
 *
 * El valor de cada cota sale de la ficha tecnica (spec.dims, en mm) y se dibuja con flechas
 * y lineas guia como en el plano del configurador de referencia: largo arriba, alto a la
 * izquierda y entre ejes abajo. La geometria (extremos, techo, ejes) la proyecta el motor con
 * `projectAnchors()`; si el metodo todavia no existe (o el anclaje sale del lienzo) se usa una
 * disposicion sintetica centrada, de modo que el HUD se ve completo con y sin el motor.
 *
 * Clave del dibujo: la caja del VALOR va ONDE ESTA EL TRAZO (a `pad` del borde en el eje de la
 * cota, en el punto medio del otro eje), nunca en el punto proyectado. Asi el texto queda
 * asociado a su flecha y no flotando encima de la pieza.
 */
import type { DimensionAnchors, ScreenPoint, VehicleDimensions } from '../../garage/contracts';
import {
  anchorPair,
  buildDimensionCotas,
  fallbackAnchor,
  type DimensionId,
} from './dimensions';

interface Props {
  dims: VehicleDimensions;
  anchors: DimensionAnchors | null;
  /** Ancho y alto en px CSS del lienzo; las cotas se dibujan en este sistema. */
  width: number;
  height: number;
  /** En movil solo se muestra el largo (ver layout). */
  compact?: boolean;
}

const { dims, anchors, width, height, compact = false }: Props = $props();

/** Cotas visibles: las tres en escritorio, solo el largo en compacto. */
const visibleCotas = $derived(compact ? buildDimensionCotas(dims).slice(0, 1) : buildDimensionCotas(dims));

/** Relleno del fondo de la caja del valor, igual que el plano (rompe la linea de cota). */
const LABEL_BG = 'var(--g3-label-bg)';
/** Alto de la caja del valor. */
const LABEL_H = 20;
/** Ancho de la caja del valor. */
const LABEL_W = 96;

function usable(point: ScreenPoint): boolean {
  return (
    point.visible &&
    point.x > -60 &&
    point.x < width + 60 &&
    point.y > -60 &&
    point.y < height + 60
  );
}

/** Margen del trazo respecto al borde del lienzo (px). */
function pad(): number {
  return Math.max(16, Math.min(width, height) * 0.045);
}

/** Par de extremos del trazo, o null si el motor no proyecta. */
function endsOf(id: DimensionId): { a: ScreenPoint; b: ScreenPoint } | null {
  const pair = anchorPair(anchors, id);
  if (pair && usable(pair.a) && usable(pair.b)) return pair;
  return null;
}

/**
 * Punto medio de la caja del VALOR de una cota. El trazo de "length" y "wheelbase" corre
 * horizontal, asi que su caja va a `pad` en Y y en el punto medio en X; el de "height" corre
 * vertical, con la caja a `pad` en X y en el punto medio en Y. Sin proyeccion se usa la
 * disposicion sintetica centrada.
 */
function labelPoint(id: DimensionId): { x: number; y: number } {
  const raw = rawLabelPoint(id);
  // Con el plano proyectado la caja puede caer cerca del borde (movil, 360 px): se mantiene
  // entera dentro del lienzo para que el LARGO no quede recortado.
  const half = LABEL_W / 2 + 4;
  const maxX = Math.max(half, width - half);
  return { x: Math.min(Math.max(raw.x, half), maxX), y: raw.y };
}

function rawLabelPoint(id: DimensionId): { x: number; y: number } {
  const p = pad();
  const pair = endsOf(id);
  if (!pair) {
    const synth = fallbackAnchor(id, width, height);
    if (id === 'height') return { x: synth.x, y: synth.y };
    return { x: synth.x, y: id === 'length' ? p + LABEL_H : height - p - LABEL_H };
  }
  const midX = (pair.a.x + pair.b.x) / 2;
  const midY = (pair.a.y + pair.b.y) / 2;
  if (id === 'height') {
    // La caja queda a la izquierda del trazo vertical, centrada en la altura.
    return { x: Math.max(LABEL_W / 2 + 4, p - 14), y: midY };
  }
  if (id === 'length') {
    // Centrada sobre el trazo horizontal superior.
    return { x: midX, y: p + LABEL_H };
  }
  // Centrada sobre el trazo horizontal inferior.
  return { x: midX, y: height - p - LABEL_H };
}
</script>

<!--
  Cotas en SVG superpuestas. Pointer-events off: es decoracion tecnica y no debe
  robarle el arrastre de orbita al canvas.
-->
<svg
  class="dimension-overlay"
  class:compact
  viewBox="0 0 {Math.max(1, width)} {Math.max(1, height)}"
  preserveAspectRatio="none"
  aria-hidden="true"
  data-testid="dimension-overlay"
>
  <defs>
    <marker id="g3-dim-arrow-start" markerWidth="7" markerHeight="7" refX="0" refY="3.5" orient="auto">
      <path d="M7,0 L0,3.5 L7,7" fill="none" stroke="var(--swal-text-muted)" stroke-width="1.2" />
    </marker>
    <marker id="g3-dim-arrow-end" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7" fill="none" stroke="var(--swal-text-muted)" stroke-width="1.2" />
    </marker>
  </defs>

  {#each visibleCotas as cota (cota.id)}
    {@const ends = endsOf(cota.id)}
    {@const label = labelPoint(cota.id)}
    {@const p = pad()}
    <g class="cota cota-{cota.id}">
      {#if ends}
        {#if cota.id === 'height'}
          <!-- Alto: guias horizontales desde el suelo y el techo, trazo vertical a la izquierda. -->
          <line x1={ends.a.x} y1={ends.a.y} x2={p} y2={ends.a.y} class="guide" />
          <line x1={ends.b.x} y1={ends.b.y} x2={p} y2={ends.b.y} class="guide" />
          <line
            x1={p} y1={ends.a.y}
            x2={p} y2={ends.b.y}
            class="dim"
            marker-start="url(#g3-dim-arrow-start)"
            marker-end="url(#g3-dim-arrow-end)"
          />
        {:else if cota.id === 'length'}
          <!-- Largo: guias verticales desde el techo, trazo horizontal arriba. -->
          <line x1={ends.a.x} y1={ends.a.y} x2={ends.a.x} y2={p} class="guide" />
          <line x1={ends.b.x} y1={ends.b.y} x2={ends.b.x} y2={p} class="guide" />
          <line
            x1={ends.a.x} y1={p}
            x2={ends.b.x} y2={p}
            class="dim"
            marker-start="url(#g3-dim-arrow-start)"
            marker-end="url(#g3-dim-arrow-end)"
          />
        {:else}
          <!-- Entre ejes: guias verticales desde cada eje, trazo horizontal abajo. -->
          <line x1={ends.a.x} y1={ends.a.y} x2={ends.a.x} y2={height - p} class="guide" />
          <line x1={ends.b.x} y1={ends.b.y} x2={ends.b.x} y2={height - p} class="guide" />
          <line
            x1={ends.a.x} y1={height - p}
            x2={ends.b.x} y2={height - p}
            class="dim"
            marker-start="url(#g3-dim-arrow-start)"
            marker-end="url(#g3-dim-arrow-end)"
          />
        {/if}
      {/if}

      <!-- Caja del valor: fondo opaco para que el trazo no atraviese el texto. -->
      <rect
        x={label.x - LABEL_W / 2} y={label.y - LABEL_H / 2} width={LABEL_W} height={LABEL_H}
        fill={LABEL_BG} rx="2" class="label-bg"
      />
      <text x={label.x} y={label.y + 4} text-anchor="middle" class="dim-value">{cota.text}</text>
      <text x={label.x} y={label.y - LABEL_H / 2 - 3} text-anchor="middle" class="dim-label">{cota.label}</text>
    </g>
  {/each}
</svg>

<style>
  .dimension-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 8;
  }

  /* El trazo de cota es la unica linea que el usuario tiene que interpretar como medicion,
     asi que va mas oscuro que la cuadricula del plano: con un gris claro el trazo del LARGO
     se perdia contra el fondo y la etiqueta quedaba sin flecha a la que pertenecer. */
  .dim {
    stroke: var(--swal-text-muted);
    stroke-width: 1.4;
  }
  .guide {
    stroke: var(--g3-guide-ink);
    stroke-width: 1;
    stroke-dasharray: 4 3;
    opacity: 0.9;
  }
  .label-bg {
    stroke: var(--g3-dim-muted);
    stroke-width: 0.6;
  }
  .dim-value {
    fill: var(--g3-ink);
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 11.5px;
    font-weight: 700;
  }
  .dim-label {
    fill: var(--g3-dim-muted);
    font-family: var(--g-font-sans, 'Inter', sans-serif);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.14em;
  }

  @media (prefers-reduced-motion: reduce) {
    .dimension-overlay {
      transition: none !important;
    }
  }
</style>