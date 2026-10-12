<script lang="ts">
/**
 * PartCallouts.svelte — Llamadas flotantes con linea guia hacia las piezas mas urgentes.
 *
 * En el configurador de referencia hay dos llamadas con linea guia y punto naranja sobre una
 * pieza ("WAYNETECH TACTICAL PURSUIT VEHICLE"). Aqui esas dos llamadas son las dos piezas con
 * menor salud del vehiculo, y su texto es el dato que obliga a actuar ("ACEITE · VENCIDO",
 * "FRENOS · 31 %"). La posicion en pantalla la proyecta el motor con `projectSlot()`; sin
 * motor, la llamada se queda en una esquina para no mentir sobre la posicion. Al pulsar una
 * se abre el panel Estado en esa pieza.
 *
 * La linea guia se dibuja en un SVG superpuesto (no con un borde CSS) porque tiene que ir del
 * borde de la etiqueta hasta el punto exacto de la pieza y marcarse con el punto naranja; asi
 * se sabe a que parte apunta cada llamada, que es justo lo que hacia la referencia.
 */
import type { ScreenPoint } from '../../garage/contracts';

export interface CalloutTarget {
  slotId: string;
  label: string;
  value: string;
  urgent: boolean;
  point: ScreenPoint | null;
}

interface Props {
  targets: CalloutTarget[];
  onselect: (slotId: string) => void;
}

const { targets, onselect }: Props = $props();

/** Posicion del punto guia (la pieza) o null si el motor no proyecta. */
function pointOf(target: CalloutTarget): ScreenPoint | null {
  const p = target.point;
  return p && p.visible ? p : null;
}

/**
 * Posicion de la CAJA de la llamada. Se apoya en el punto proyectado pero se separa hacia
 * arriba (indice par) o abajo (impar) para que las dos llamadas no se solapen y la linea
 * guia siempre tenga recorrido.
 */
function boxStyle(target: CalloutTarget, index: number): string {
  const p = pointOf(target);
  if (p) {
    const above = index % 2 === 0;
    const offsetY = above ? -64 : 40;
    const x = Math.max(56, p.x);
    return `left:${x}px;top:${p.y + offsetY}px;`;
  }
  // Sin proyeccion: esquina superior derecha, siempre visible.
  return index === 0 ? 'right:16px;top:16px;' : 'right:16px;top:58px;';
}

/**
 * Punto de anclaje de la linea guia: el borde de la caja mas cercano al punto de la pieza.
 * La caja esta centrada en su posicion (`translate(-50%,-50%)`), asi que el borde del que
 * sale la linea es el inferior si la etiqueta esta encima, o el superior si esta debajo.
 */
function leaderEnd(target: CalloutTarget, index: number): { x: number; y: number } | null {
  const p = pointOf(target);
  if (!p) return null;
  const above = index % 2 === 0;
  // La caja mide ~26 px de alto; el borde sale de ahi hacia el punto.
  const edge = above ? 13 : -13;
  const x = Math.max(56, p.x);
  return { x, y: p.y + (above ? -64 + edge : 40 - edge) };
}

/** Punto donde la linea toca la pieza. */
function leaderStart(target: CalloutTarget): { x: number; y: number } | null {
  const p = pointOf(target);
  return p ? { x: p.x, y: p.y } : null;
}

/** Linea guia de una llamada, o string vacio si no hay punto proyectado. */
function leaderPath(target: CalloutTarget, index: number): string {
  const a = leaderEnd(target, index);
  const b = leaderStart(target);
  if (!a || !b) return '';
  // Linea quebrada: baja (o sube) en vertical y luego entra en horizontal hacia la pieza,
  // el estilo de las guias del plano tecnico de referencia.
  const elbowY = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} L ${a.x} ${elbowY} L ${b.x} ${b.y}`;
}
</script>

<div class="part-callouts-root" aria-label="Llamadas de las piezas mas urgentes">
  {#if targets.some((t) => pointOf(t))}
    <svg class="leader-layer" aria-hidden="true">
      {#each targets as target, index (target.slotId)}
        {@const path = leaderPath(target, index)}
        {@const tip = leaderStart(target)}
        {#if path && tip}
          <path d={path} class="leader" />
          <circle cx={tip.x} cy={tip.y} r="3.5" class="leader-tip" />
        {/if}
      {/each}
    </svg>
  {/if}

  {#each targets as target, index (target.slotId)}
    <button
      type="button"
      class="callout {target.urgent ? 'urgent' : ''} {target.point ? '' : 'anchored'}"
      style={boxStyle(target, index)}
      onclick={() => onselect(target.slotId)}
      aria-label="Ver estado de {target.label}: {target.value}"
    >
      <span class="callout-dot" aria-hidden="true"></span>
      <span class="callout-label">{target.label}</span>
      <span class="callout-sep" aria-hidden="true">·</span>
      <span class="callout-value">{target.value}</span>
    </button>
  {/each}
</div>

<style>
  .part-callouts-root {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 12;
  }

  /* Capa de lineas guia: por debajo de las etiquetas (que son botones) y sobre el canvas. */
  .leader-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .leader {
    fill: none;
    stroke: var(--g3-orange);
    stroke-width: 1.1;
    /* Guias del plano: linea discontinua fina que no compite con el modelo. */
    stroke-dasharray: 4 3;
    opacity: 0.75;
  }
  .leader-tip {
    fill: var(--g3-orange);
    stroke: var(--g3-card);
    stroke-width: 1.4;
  }

  .callout {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    background: var(--g3-card);
    border: 1px solid var(--g3-line);
    box-shadow: var(--swal-shadow-sm);
    color: var(--g3-ink);
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    /* Esquinas cortadas, como las tarjetas del plano. */
    clip-path: polygon(
      6px 0, 100% 0,
      100% calc(100% - 6px), calc(100% - 6px) 100%,
      0 100%, 0 6px
    );
    transition: transform 150ms ease, border-color 150ms ease;
    white-space: nowrap;
  }
  .callout:hover {
    transform: translate(-50%, -50%) translateY(-1px);
    border-color: var(--g3-orange);
  }
  .callout.urgent {
    border-color: var(--g3-orange);
  }
  .callout.anchored {
    transform: translate(0, -50%);
  }
  .callout.anchored:hover {
    transform: translate(0, -50%) translateY(-1px);
  }

  .callout-dot {
    width: 6px;
    height: 6px;
    background: var(--g3-orange);
    flex: none;
  }
  .callout-sep {
    color: var(--swal-text-muted);
  }
  .callout-value {
    color: var(--swal-accent-text);
    font-weight: 700;
  }
  .callout:not(.urgent) .callout-value {
    color: var(--swal-text-secondary);
  }

  @media (prefers-reduced-motion: reduce) {
    .callout {
      transition: none;
    }
  }
</style>