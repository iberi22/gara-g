<script lang="ts">
  /**
   * RadarView — El radar virtual: el propio vehiculo al centro, rumbo hacia arriba, y cada
   * vecino como un triangulo que apunta hacia donde va, coloreado por riesgo. Los peligros
   * (bache, choque...) son rombos. SVG puro: sin canvas ni librerias, y los colores salen de
   * los tokens del tema TALLER (el fondo oscuro se mantiene en claro y en oscuro para que se
   * lea a pleno sol).
   */
  import type { HazardView, NeighborView } from '../../mesh/v2v/v2vNode';
  import type { RiskLevel } from '../../mesh/v2v/risk';

  let {
    neighbors,
    hazards,
    headingDeg,
    rangeM = 200,
    active,
  }: { neighbors: NeighborView[]; hazards: HazardView[]; headingDeg: number; rangeM?: number; active: boolean } = $props();

  const R = 90; // radio del dibujo en unidades del viewBox
  const rad = (d: number) => (d * Math.PI) / 180;

  /** Rumbo arriba: se gira el mundo por -rumbo propio. */
  function project(e: number, n: number) {
    const h = rad(headingDeg);
    const x = e * Math.cos(h) - n * Math.sin(h);
    const y = e * Math.sin(h) + n * Math.cos(h);
    const dist = Math.hypot(x, y);
    const k = dist > rangeM ? rangeM / dist : 1; // lo que queda fuera se pega al borde
    return { x: ((x * k) / rangeM) * R, y: (-(y * k) / rangeM) * R, clipped: dist > rangeM };
  }

  const colorOf = (l: RiskLevel) =>
    l === 'peligro' ? 'var(--swal-danger, #C8352B)' : l === 'aviso' ? 'var(--swal-accent, #FF6A13)' : 'var(--swal-neon-green, #1F9D55)';

  const rings = [0.25, 0.5, 1];
  const kindLabel = (l: RiskLevel) => (l === 'peligro' ? 'peligro' : l === 'aviso' ? 'aviso' : 'sin riesgo');
</script>

<svg
  class="radar-svg"
  viewBox="-100 -100 200 200"
  role="img"
  aria-label="Radar virtual de vehículos cercanos"
  data-testid="radar-view"
  data-active={active}
>
  <rect x="-100" y="-100" width="200" height="200" class="bg" />
  {#each rings as r}
    <circle cx="0" cy="0" r={R * r} class="ring" />
    <text x="2" y={-R * r + 5} class="ring-label">{Math.round(rangeM * r)} m</text>
  {/each}
  <line x1="0" y1={-R} x2="0" y2={R} class="axis" />
  <line x1={-R} y1="0" x2={R} y2="0" class="axis" />
  <text x="0" y="-93" class="north" text-anchor="middle">{Math.round(headingDeg)}°</text>

  {#each hazards as h (h.key)}
    {@const p = project(h.e, h.n)}
    <g transform={`translate(${p.x} ${p.y})`} data-testid="radar-hazard" data-level={h.level} opacity={p.clipped ? 0.6 : 1}>
      <polygon points="0,-6 6,0 0,6 -6,0" fill={colorOf(h.level === 'none' ? 'aviso' : h.level)} class="hz" />
      <text y="2.5" text-anchor="middle" class="hz-mark">!</text>
    </g>
  {/each}

  {#each neighbors as nb (nb.id)}
    {@const p = project(nb.e, nb.n)}
    <g
      transform={`translate(${p.x} ${p.y}) rotate(${nb.headingDeg - headingDeg})`}
      data-testid="radar-neighbor"
      data-level={nb.level}
      opacity={p.clipped ? 0.55 : 1}
    >
      <title>{nb.vehicleClass}, {Math.round(nb.speedMps * 3.6)} km/h, {kindLabel(nb.level)}</title>
      {#if nb.vehicleClass === 'moto'}
        <polygon points="0,-6 3.5,5 -3.5,5" fill={colorOf(nb.level)} class="nb" />
      {:else}
        <polygon points="0,-7 5.5,6 -5.5,6" fill={colorOf(nb.level)} class="nb" />
      {/if}
    </g>
  {/each}

  <!-- Propio vehiculo: siempre al centro, mirando arriba -->
  <g class="own" data-testid="radar-own">
    <polygon points="0,-8 6,7 0,4 -6,7" />
  </g>
</svg>

<style>
  .radar-svg {
    width: 100%;
    height: auto;
    max-width: min(92vw, 62vh);
    aspect-ratio: 1;
    display: block;
    margin: 0 auto;
  }
  .bg { fill: var(--hud-bg, var(--swal-void)); }
  .ring { fill: none; stroke: var(--swal-border-strong); stroke-width: 0.5; }
  .axis { stroke: var(--swal-border-strong); stroke-width: 0.3; stroke-dasharray: 2 3; }
  .ring-label { fill: var(--hud-muted, var(--swal-text-muted)); font-size: 6.5px; font-family: var(--swal-font-mono); }
  .north { fill: var(--hud-fg, var(--swal-text)); font-size: 6px; font-family: var(--swal-font-mono); }
  .nb, .hz { stroke: var(--hud-bg, var(--swal-void)); stroke-width: 0.8; }
  .hz-mark { fill: var(--hud-bg, var(--swal-void)); font-size: 8px; font-weight: 700; }
  .own polygon { fill: var(--hud-fg, var(--swal-text)); stroke: var(--swal-accent); stroke-width: 1.2; }
</style>
