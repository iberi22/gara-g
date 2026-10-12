<script lang="ts">
/**
 * Canvas3D.svelte — Anfitrión del lienzo Three.js / WebGPU y puente con el motor.
 *
 * Importa dinámicamente el motor con `await import('../../garage/engine')` dentro de
 * `onMount`, asegurando aislamiento total de Three en SSR. Ademas de mostrar el vehiculo,
 * este componente es el PUENTE entre el motor y el resto del HUD:
 *   - expone `setPaint`, `setTheme` y la proyeccion (`anchors`, `slotPoints`) como estado,
 *     para que las cotas, las llamadas y la escena se actualicen sin que el padre hable
 *     directamente con three;
 *   - avisa cuando cambia camara o tamano con `onViewChange` y con un rAF, que es lo que
 *     redibuja las cotas del plano tecnico;
 *   - expone `window.__garage` y `document.body.dataset.ready = '1'` para capturas y e2e.
 *
 * `setTheme`, `projectAnchors`, `projectSlot` y `onViewChange` los implementa el motor en
 * paralelo. aqui se llaman PROTEGIDOS (`typeof fn === 'function'`): si faltan, el HUD
 * funciona igual, con la disposicion sintetica de cotas y sin tema de estudio.
 */
import { onDestroy, onMount } from 'svelte';
import type {
  DimensionAnchors,
  EngineStats,
  GarageEngineApi,
  GarageVehicle,
  PartSlotId,
  ScreenPoint,
  StageTheme,
  ViewMode,
} from '../../garage/contracts';
import { detectSwipe } from './swipe';

interface Props {
  /** null mientras no hay vehiculo: se dibuja el estado de carga, no un carrusel a medias. */
  vehicle: GarageVehicle | null;
  viewMode: ViewMode;
  selectedPartId: PartSlotId | null;
  direction?: 1 | -1;
  theme?: StageTheme;
  onselectpart: (slotId: PartSlotId | null) => void;
  onprev: () => void;
  onnext: () => void;
  /** Avisa cuando el motor queda listo (o cuando falla, con `error`). */
  onready?: (info: { vehicleId: string | null; stats?: EngineStats; error?: string }) => void;
  /**
   * Publica la geometria que el resto del HUD necesita dibujar sobre el lienzo: las anclas de
   * las cotas, la posicion en pantalla de cada pieza y el tamano del lienzo. Se llama desde el
   * rAF de proyecciones, asi que llega una vez por frame como maximo.
   */
  onprojection?: (next: {
    anchors: DimensionAnchors | null;
    slotPoints: Record<string, ScreenPoint>;
    width: number;
    height: number;
  }) => void;
}

const {
  vehicle,
  viewMode,
  selectedPartId,
  direction = 1,
  theme = 'studio',
  onselectpart,
  onprev,
  onnext,
  onready,
  onprojection,
}: Props = $props();

let canvasEl: HTMLCanvasElement | null = null;
let wrapperEl: HTMLDivElement | null = null;
let engine: GarageEngineApi | null = null;
let unsubscribePartSelected: (() => void) | null = null;
let unsubscribeViewChange: (() => void) | null = null;
let isEngineReady = $state(false);
let engineError = $state<string | null>(null);
let lastShownVehicleId: string | null = null;
let lastPartsJson = '';

/** Puntos del vehiculo en pantalla para las cotas del plano; null si el motor no proyecta. */
let anchors = $state<DimensionAnchors | null>(null);
/** Posicion en pantalla de cada pieza, para las llamadas flotantes. */
let slotPoints = $state<Record<string, ScreenPoint>>({});
/** Tamano medido del contenedor del lienzo en px CSS (lo usan las cotas en SVG). */
let viewportSize = $state({ width: 0, height: 0 });
/** Ultimo tamaño publicado al padre (para no re-renderizar si no cambio). */
let canvasSize = $state({ width: 0, height: 0 });

// Control tactil para swipe
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

/**
 * Metodos del motor que aun pueden no existir. Se consultan de forma segura para que el HUD
 * funcione con el motor completo y con el que aun no los tenga.
 */
function engineSetTheme(eng: GarageEngineApi, next: StageTheme): void {
  if (typeof eng.setTheme === 'function') {
    try {
      eng.setTheme(next);
    } catch {
      // Un motor sin escenario de estudio no debe tumbar la vista.
    }
  }
}

function engineProjectAnchors(eng: GarageEngineApi): DimensionAnchors | null {
  if (typeof eng.projectAnchors !== 'function') return null;
  try {
    return eng.projectAnchors();
  } catch {
    return null;
  }
}

function engineProjectSlot(eng: GarageEngineApi, slotId: string): ScreenPoint | null {
  if (typeof eng.projectSlot !== 'function') return null;
  try {
    return eng.projectSlot(slotId);
  } catch {
    return null;
  }
}

/** Refresca las proyecciones publicadas. Es barato y se llama desde un rAF. */
function refreshProjections(): void {
  if (!engine || !isEngineReady) return;
  const nextAnchors = engineProjectAnchors(engine);

  const current = vehicle;
  const next: Record<string, ScreenPoint> = {};
  if (current) {
    for (const part of current.parts) {
      const point = engineProjectSlot(engine, part.slotId);
      if (point) next[part.slotId] = point;
    }
  }

  // Solo se publica si algo cambio: el padre vuelve a renderizar el HUD en cada aviso.
  const sizeChanged = canvasSize.width !== viewportSize.width || canvasSize.height !== viewportSize.height;
  const anchorsChanged = !samePoint(anchors, nextAnchors);
  const slotsChanged = JSON.stringify(slotPoints) !== JSON.stringify(next);
  if (!sizeChanged && !anchorsChanged && !slotsChanged) return;

  anchors = nextAnchors;
  slotPoints = next;
  canvasSize = { width: viewportSize.width, height: viewportSize.height };
  onprojection?.({ anchors: nextAnchors, slotPoints: next, width: viewportSize.width, height: viewportSize.height });
}

/** Comparacion barata de dos conjuntos de anclas (campo a campo). */
function samePoint(a: DimensionAnchors | null, b: DimensionAnchors | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys: (keyof DimensionAnchors)[] = ['frontTop', 'rearTop', 'frontGround', 'rearGround', 'top', 'topGround', 'axleFront', 'axleRear'];
  return keys.every((k) => {
    const p = a[k];
    const q = b[k];
    return p.x === q.x && p.y === q.y && p.visible === q.visible;
  });
}

onMount(() => {
  let isDisposed = false;
  let rafId: number | null = null;

  async function init() {
    if (!canvasEl) return;
    try {
      const { createGarageEngine } = await import('../../garage/engine');
      if (isDisposed) return;

      // ?gl=1 fuerza WebGL2: escape para equipos con WebGPU inestable y para las capturas
      // headless (swiftshader pierde la instancia de WebGPU y el lienzo queda en blanco).
      const eng = createGarageEngine({ forceWebGL: new URLSearchParams(window.location.search).get('gl') === '1' });
      engine = eng;

      await eng.mount(canvasEl);
      if (isDisposed) {
        eng.dispose();
        engine = null;
        return;
      }

      unsubscribePartSelected = eng.onPartSelected((slotId) => {
        onselectpart(slotId);
      });

      // Aviso de cambios de camara/tamano: redibuja cotas y llamadas.
      if (typeof eng.onViewChange === 'function') {
        unsubscribeViewChange = eng.onViewChange(() => {
          scheduleFrame();
        });
      }

      const first = vehicle;
      if (first) {
        await eng.showVehicle(first.spec, { direction });
        if (isDisposed) {
          eng.dispose();
          engine = null;
          return;
        }
        eng.setPartStates(first.parts);
        eng.setViewMode(viewMode);
        engineSetTheme(eng, theme);
        if (selectedPartId) eng.focusPart(selectedPartId);

        lastShownVehicleId = first.id;
        lastPartsJson = JSON.stringify(first.parts);
        publishReadyState(first.id, eng.getStats());
        onready?.({ vehicleId: first.id, stats: eng.getStats() });
      } else {
        // Sin vehiculo todavia (cargando): se marca listo para que las capturas no se queden
        // esperando, pero sin inventar un id.
        publishReadyState(null, eng.getStats());
        onready?.({ vehicleId: null });
      }

      isEngineReady = true;

      window.addEventListener('resize', handleResize);
      if (wrapperEl) {
        measureWrapper();
        const ro = new ResizeObserver(() => {
          measureWrapper();
          engine?.resize();
        });
        ro.observe(wrapperEl);
        viewObserver = ro;
      }

      // rAF de proyecciones: sigue al giro de camara con el bucle a demanda del motor.
      const tick = () => {
        if (isDisposed) return;
        refreshProjections();
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    } catch (err) {
      if (isDisposed) return;
      engineError = String(err);
      // console.error para que aparezca en las capturas de verificacion.
      console.error('Error inicializando motor 3D del Garage:', err);
      if (typeof document !== 'undefined') {
        document.body.dataset.ready = '1';
      }
      if (typeof window !== 'undefined') {
        (window as unknown as { __garage: unknown }).__garage = { ready: true, vehicleId: null, error: String(err) };
      }
      onready?.({ vehicleId: null, error: String(err) });
    }
  }

  void init();

  return () => {
    isDisposed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', handleResize);
    unsubscribePartSelected?.();
    unsubscribePartSelected = null;
    unsubscribeViewChange?.();
    unsubscribeViewChange = null;
    viewObserver?.disconnect();
    viewObserver = null;
    if (engine) {
      engine.dispose();
      engine = null;
    }
  };
});

let viewObserver: ResizeObserver | null = null;

/** Un rAF mas: redibuja las cotas en cuanto el motor avise de un cambio de vista. */
function scheduleFrame(): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => refreshProjections());
}

function measureWrapper(): void {
  if (!wrapperEl) return;
  const w = wrapperEl.clientWidth;
  const h = wrapperEl.clientHeight;
  if (w > 0 && h > 0 && (w !== viewportSize.width || h !== viewportSize.height)) {
    viewportSize = { width: w, height: h };
  }
}

function publishReadyState(vehicleId: string | null, stats?: EngineStats) {
  if (typeof window !== 'undefined') {
    (window as unknown as { __garage: unknown }).__garage = {
      ready: true,
      vehicleId,
      stats: stats ?? engine?.getStats(),
    };
  }
  if (typeof document !== 'undefined') {
    document.body.dataset.ready = '1';
  }
}

function handleResize() {
  measureWrapper();
  engine?.resize();
}

// Reactividad ante cambios de vehiculo: solo invocar showVehicle si cambio el ID
$effect(() => {
  if (!isEngineReady || !engine) return;
  const current = vehicle;
  if (!current) {
    lastShownVehicleId = null;
    return;
  }
  if (current.id !== lastShownVehicleId) {
    lastShownVehicleId = current.id;
    void engine.showVehicle(current.spec, { direction }).then(() => {
      engine?.setPartStates(current.parts);
      lastPartsJson = JSON.stringify(current.parts);
      engine?.setViewMode(viewMode);
      engineSetTheme(engine, theme);
      publishReadyState(current.id);
      refreshProjections();
    });
  }
});

// Reactividad ante cambios de modo (beauty, health, xray)
$effect(() => {
  if (isEngineReady && engine) {
    engine.setViewMode(viewMode);
  }
});

// Reactividad ante cambios de pieza enfocada
$effect(() => {
  if (isEngineReady && engine) {
    engine.focusPart(selectedPartId);
  }
});

// Reactividad de salud de piezas: solo actualizar cuando cambian los datos
$effect(() => {
  if (!isEngineReady || !engine || !vehicle) return;
  const currentJson = JSON.stringify(vehicle.parts);
  if (currentJson !== lastPartsJson) {
    lastPartsJson = currentJson;
    engine.setPartStates(vehicle.parts);
    refreshProjections();
  }
});

// Reactividad del tema de escenario (claro / garaje)
$effect(() => {
  if (isEngineReady && engine) {
    engineSetTheme(engine, theme);
    scheduleFrame();
  }
});

// Manejo de teclado (← / →)
function handleKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    onprev();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    onnext();
  }
}

// Manejo de gestos tactiles (Swipe)
function handleTouchStart(e: TouchEvent) {
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }
}

function handleTouchEnd(e: TouchEvent) {
  if (e.changedTouches.length === 1) {
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const elapsed = Date.now() - touchStartTime;

    if (elapsed < 600) {
      const swipe = detectSwipe(touchStartX, touchStartY, endX, endY, 60);
      if (swipe.isSwipe) {
        if (swipe.direction === 1) {
          onnext();
        } else {
          onprev();
        }
      }
    }
  }
}

export function setPaint(paint: Parameters<GarageEngineApi['setPaint']>[0]): void {
  engine?.setPaint(paint);
}

export function setTheme(next: StageTheme): void {
  if (engine) engineSetTheme(engine, next);
}

export function resetProjection(): void {
  anchors = null;
  slotPoints = {};
}
</script>

<svelte:window onkeydown={handleKeyDown} />

<div
  bind:this={wrapperEl}
  class="canvas-wrapper"
  ontouchstart={handleTouchStart}
  ontouchend={handleTouchEnd}
  role="region"
  aria-label={vehicle
    ? `Escenario 3D interactivo para ${vehicle.name}`
    : 'Escenario 3D interactivo cargando vehículo'}
>
  <canvas
    bind:this={canvasEl}
    class="garage-canvas"
    aria-label={vehicle
      ? `Modelo 3D interactivo de ${vehicle.name} con salud global del ${vehicle.overallHealthPct ?? 'desconocida'}%`
      : 'Modelo 3D interactivo del vehículo (cargando)'}
    role="img"
    tabindex="0"
  ></canvas>
  {#if engineError}
    <p class="engine-error" role="status">
      No se pudo iniciar el visor 3D. Los datos del vehículo siguen disponibles en los paneles.
    </p>
  {/if}
</div>

<style>
  .canvas-wrapper {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    touch-action: pan-y;
  }

  .garage-canvas {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
  }

  .engine-error {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.4rem 0.7rem;
    background: var(--g3-strip-bg);
    border: 1px solid var(--g3-orange);
    color: var(--g3-ink);
    font-size: 11px;
  }
</style>