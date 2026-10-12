/**
 * engine/index.ts — Motor 3D del Garage GARA-G (WebGPU con caida a WebGL2, 60 fps).
 *
 * Implementa la interfaz completa `GarageEngineApi` de contracts.ts:
 * 1. WebGPURenderer (caida a WebGL2 o forzado con forceWebGL / ?gl=1), init() asincrono, tone mapping ACES.
 *    Soporta fondo transparente (`alpha: true`) para temas como 'studio'.
 * 2. Escenario configurable con setTheme('studio' | 'garage'), por defecto 'studio':
 *    - studio: fondo transparente, sombra de contacto suave escalada al bbox, sombra real de luz clave,
 *      entorno equirectangular con softboxes, luces de producto y exposicion 1.15.
 *    - garage: escena oscura con piso de concreto, tornamesa y tiras emisivas.
 *    - Cambiar de tema no reconstruye el vehiculo ni pierde la camara.
 * 3. Camara de producto: teleobjetivo FOV 28 con encuadre que respeta el aspecto.
 * 4. Tornamesa en reposo: tras 6 s sin interaccion, el vehiculo gira lento (~6°/s) solo en dispositivos
 *    con (hover: hover), sin reduced motion y con pestaña visible; cualquier interaccion la detiene.
 * 5. Proyeccion de cotas y piezas: projectAnchors() y projectSlot() con funciones puras testeables.
 * 6. Notificacion de cambios de vista: onViewChange(cb) avisa como maximo una vez por frame.
 * 7. Modos de vista: beauty, health, xray.
 * 8. Picking: Raycaster unico con navegacion por padres, ignorado de arrastres > 6 px.
 * 9. Bucle a demanda: corre mientras hay movimiento y se detiene tras ~1.5 s de inactividad.
 * 10. Governor de calidad adaptativo: EMA de tiempo de frame, histeresis de 2 s, ajuste dpr/sombras/tier.
 * 11. Seguro para SSR (sin window/document a nivel de modulo).
 */
import { ACESFilmicToneMapping, WebGPURenderer } from 'three/webgpu';
import type {
  BuiltVehicle,
  DimensionAnchors,
  EngineStats,
  GarageEngineApi,
  PaintSpec,
  PartSlotId,
  PartState,
  QualityTier,
  RenderBackend,
  ScreenPoint,
  StageTheme,
  VehicleSpec,
  ViewMode,
} from '../contracts';
import { createMaterialKit } from '../templates/common/materials';
import { getTemplate } from '../templates/registry';
import { QualityGovernor } from './governor';
import { applyViewMode, createViewModeMaterials, type ViewModeMaterials } from './materials';
import { GarageSceneManager } from './scene';
import { GarageCameraManager } from './camera';
import { CarouselManager, disposeVehicleGeometries } from './carousel';
import { PickingManager } from './picking';
import { computeDimensionAnchors, getVehicleLocalBox, projectVehicleSlot } from './projection';

export interface GarageEngineOptions {
  quality?: 'auto' | 'high' | 'medium' | 'low';
  forceWebGL?: boolean;
}

export interface GarageEngineInternalApi extends GarageEngineApi {
  getVehiclesInScene?: () => number;
  isTransitioning?: () => boolean;
  isTurntableActive?: () => boolean;
  canRunTurntable?: () => boolean;
  getTheme?: () => StageTheme;
  triggerFrame?: () => void;
}

const IDLE_TURNTABLE_DELAY_MS = 6000;
const TURNTABLE_SPEED_RAD_PER_SEC = (6 * Math.PI) / 180; // ~6°/s (0.1047 rad/s)

/** Tiempo maximo para que el navegador entregue un adaptador WebGPU. */
export const WEBGPU_PROBE_MS = 2500;

/**
 * true si hay un adaptador WebGPU dentro del plazo. Nunca lanza ni se queda colgado:
 * sin `navigator.gpu`, con adaptador null, con error o con timeout devuelve false.
 */
export async function probeWebGPU(timeoutMs: number, gpu: { requestAdapter(): Promise<unknown> } | undefined = (globalThis.navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu): Promise<boolean> {
  if (!gpu) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return adapter != null;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createGarageEngine(opts: GarageEngineOptions = {}): GarageEngineInternalApi {
  let renderer: WebGPURenderer | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let backend: RenderBackend = 'webgl2';

  const sceneMgr = new GarageSceneManager();
  let cameraMgr: GarageCameraManager | null = null;
  const carouselMgr = new CarouselManager();
  const pickingMgr = new PickingManager();
  const kit = createMaterialKit();
  const viewModeMaterials: ViewModeMaterials = createViewModeMaterials();

  const isTouchDevice =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

  const governor = new QualityGovernor({
    initialTier: opts.quality ?? 'auto',
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    isTouch: isTouchDevice,
  });

  let currentTheme: StageTheme = 'studio';
  let currentVehicle: BuiltVehicle | null = null;
  let currentSpec: VehicleSpec | null = null;
  let currentViewMode: ViewMode = 'beauty';
  let vehicleSeq = 0;
  const partStatesMap = new Map<PartSlotId, PartState>();
  let hasOverduePart = false;

  let resizeObserver: ResizeObserver | null = null;
  let isLoopRunning = false;
  let lastActivityTime = 0;
  let lastFrameTime = 0;
  let measuredFrameMs = 16.6;
  let measuredFps = 60;
  let frameCount = 0;
  let fpsTimer = 0;
  let lastDrawCalls = 0;

  // Estado de la tornamesa en reposo
  let lastUserInteractionTime = typeof performance !== 'undefined' ? performance.now() : 0;
  let isTurntableActive = false;
  let turntableTimer: ReturnType<typeof setTimeout> | null = null;

  // Suscriptores de onViewChange
  const viewChangeListeners = new Set<() => void>();
  let viewChangedThisFrame = false;

  function canRunTurntable(): boolean {
    if (typeof window === 'undefined') return false;
    const hoverMatch = window.matchMedia?.('(hover: hover)')?.matches ?? false;
    if (!hoverMatch) return false;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    if (reducedMotion) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    return true;
  }

  function scheduleTurntableActivation(): void {
    if (turntableTimer) {
      clearTimeout(turntableTimer);
      turntableTimer = null;
    }
    if (!canRunTurntable()) return;

    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const elapsed = now - lastUserInteractionTime;
    const remaining = Math.max(0, IDLE_TURNTABLE_DELAY_MS - elapsed);

    turntableTimer = setTimeout(() => {
      if (canRunTurntable() && performance.now() - lastUserInteractionTime >= IDLE_TURNTABLE_DELAY_MS) {
        isTurntableActive = true;
        wakeLoop();
      }
    }, remaining);
  }

  function onUserInteract(): void {
    lastUserInteractionTime = typeof performance !== 'undefined' ? performance.now() : 0;
    isTurntableActive = false;
    scheduleTurntableActivation();
    wakeLoop();
  }

  function markViewChanged(): void {
    viewChangedThisFrame = true;
    wakeLoop();
  }

  function notifyViewChangeIfNeeded(): void {
    if (viewChangedThisFrame) {
      viewChangedThisFrame = false;
      for (const cb of viewChangeListeners) {
        try {
          cb();
        } catch (e) {
          console.error('Error in onViewChange listener:', e);
        }
      }
    }
  }

  function wakeLoop(): void {
    lastActivityTime = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!isLoopRunning && renderer) {
      isLoopRunning = true;
      lastFrameTime = performance.now();
      renderer.setAnimationLoop(onFrame);
    }
  }

  function onFrame(_timestamp: number): void {
    if (!renderer || !cameraMgr || !canvasEl) return;
    const now = performance.now();
    const deltaMs = Math.min(now - lastFrameTime, 100);
    lastFrameTime = now;

    // Calculo y muestreo de FPS / FrameMs
    frameCount++;
    if (now - fpsTimer >= 500) {
      measuredFps = Math.round((frameCount * 1000) / (now - fpsTimer));
      frameCount = 0;
      fpsTimer = now;
    }
    measuredFrameMs = measuredFrameMs * 0.88 + deltaMs * 0.12;

    // Actualizacion del governor adaptativo
    const governorChanged = governor.recordFrame(deltaMs, now);
    if (governorChanged) {
      renderer.setPixelRatio(governor.getDpr());
      sceneMgr.applyTier(governor.getTier(), governor.getShadowMapSize(), governor.getShadowsEnabled());
      renderer.shadowMap.enabled = governor.getShadowsEnabled();
    }

    // Actualizacion de camara y carrusel
    const cameraMoving = cameraMgr.update(deltaMs);
    const carouselMoving = carouselMgr.update(deltaMs);

    // Actualizacion de tornamesa en reposo
    if (!canRunTurntable()) {
      isTurntableActive = false;
    } else if (now - lastUserInteractionTime >= IDLE_TURNTABLE_DELAY_MS) {
      isTurntableActive = true;
    }

    if (isTurntableActive && currentVehicle && !carouselMoving) {
      const deltaRad = TURNTABLE_SPEED_RAD_PER_SEC * (deltaMs / 1000);
      currentVehicle.root.rotation.y += deltaRad;
      currentVehicle.root.updateMatrixWorld(true);
      sceneMgr.updateContactShadowRotation(currentVehicle.root.rotation.y);
      sceneMgr.requestShadowUpdate();
      viewChangedThisFrame = true;
    }

    if (carouselMoving || cameraMoving || isTurntableActive) {
      sceneMgr.requestShadowUpdate();
      lastActivityTime = now;
      viewChangedThisFrame = true;
    }

    // Renderizado del frame
    renderer.render(sceneMgr.scene, cameraMgr.camera);

    const renderInfo = (renderer.info.render ?? {}) as {
      drawCalls?: number;
      calls?: number;
    };
    const currentCalls = renderInfo.drawCalls ?? renderInfo.calls ?? 0;
    if (currentCalls > 0) {
      lastDrawCalls = currentCalls;
    }

    // En modo health con piezas vencidas (overdue), el pulso emisivo necesita render continuo
    const isOverduePulsing = currentViewMode === 'health' && hasOverduePart;

    // Criterio de parada del bucle a demanda (~1.5 s sin actividad)
    const isMoving =
      cameraMoving ||
      carouselMoving ||
      cameraMgr.isTweening() ||
      isTurntableActive ||
      isOverduePulsing;

    if (isMoving) {
      lastActivityTime = now;
    }

    const isIdle = !isMoving && now - lastActivityTime > 1500;
    if (isIdle) {
      renderer.setAnimationLoop(null);
      isLoopRunning = false;
    }

    // Notificar a los oyentes de vista al final del frame
    notifyViewChangeIfNeeded();
  }

  const api: GarageEngineInternalApi = {
    setTheme(theme: StageTheme): void {
      currentTheme = theme;
      sceneMgr.setTheme(theme, renderer);
      markViewChanged();
      wakeLoop();
    },

    projectAnchors(): DimensionAnchors | null {
      if (!currentVehicle || !currentSpec || !canvasEl || !cameraMgr) return null;
      const w = canvasEl.clientWidth || 1;
      const h = canvasEl.clientHeight || 1;
      return computeDimensionAnchors(currentVehicle, currentSpec, cameraMgr.camera, w, h);
    },

    projectSlot(slotId: PartSlotId): ScreenPoint | null {
      if (!currentVehicle || !canvasEl || !cameraMgr) return null;
      const w = canvasEl.clientWidth || 1;
      const h = canvasEl.clientHeight || 1;
      return projectVehicleSlot(currentVehicle, slotId, cameraMgr.camera, w, h);
    },

    onViewChange(cb: () => void): () => void {
      viewChangeListeners.add(cb);
      return () => {
        viewChangeListeners.delete(cb);
      };
    },

    async mount(canvas: HTMLCanvasElement): Promise<{ backend: RenderBackend }> {
      canvasEl = canvas;

      // Si el navegador anuncia WebGPU pero requestAdapter() no responde (pasa en Chromium
      // headless y en algunos drivers), WebGPURenderer.init() se queda esperando para
      // siempre y el garage no carga. Se sondea antes con tiempo limite: sin adaptador a
      // tiempo, se crea el renderer directamente en WebGL2 (el canvas aun no tiene contexto).
      const webgpuOk = opts.forceWebGL === true ? false : await probeWebGPU(WEBGPU_PROBE_MS);
      renderer = new WebGPURenderer({
        canvas,
        antialias: true,
        alpha: true,
        forceWebGL: !webgpuOk,
      });

      renderer.setPixelRatio(governor.getDpr());
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.shadowMap.enabled = governor.getShadowsEnabled();

      // Obligatorio en three 0.186.1 antes del primer render
      await renderer.init();

      backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

      // Inicializar entornos PMREM y aplicar tema por defecto (studio)
      sceneMgr.initEnvironment(renderer);
      sceneMgr.setTheme(currentTheme, renderer);
      sceneMgr.applyTier(governor.getTier(), governor.getShadowMapSize(), governor.getShadowsEnabled());

      // Camara y controles con damping
      cameraMgr = new GarageCameraManager(canvas);

      // Picking y eventos
      pickingMgr.attach(canvas, cameraMgr.camera, wakeLoop, () => {
        cameraMgr?.focusPart(null, currentVehicle);
        markViewChanged();
      });

      // Deteccion de redimensionamiento
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => api.resize());
        resizeObserver.observe(canvas);
      }

      // Interacciones que reinician la tornamesa en reposo y reactivan el bucle
      canvas.addEventListener('wheel', onUserInteract, { passive: true });
      canvas.addEventListener('pointerdown', onUserInteract, { passive: true });
      canvas.addEventListener('touchstart', onUserInteract, { passive: true });

      cameraMgr.controls.addEventListener('start', onUserInteract);
      cameraMgr.controls.addEventListener('change', () => {
        if (cameraMgr?.isUserInteracted()) {
          onUserInteract();
        }
      });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            isTurntableActive = false;
          } else {
            scheduleTurntableActivation();
          }
        });
      }

      scheduleTurntableActivation();
      api.resize();
      wakeLoop();

      return { backend };
    },

    async showVehicle(spec: VehicleSpec, transitionOpts?: { direction?: 1 | -1 }): Promise<void> {
      const seq = ++vehicleSeq;
      const tpl = getTemplate(spec.body, spec.family);
      const lod = governor.getTier() === 'low' ? 'low' : 'high';

      // 1. Construir el nuevo modelo
      const nextVehicle = tpl.build(spec, { materials: kit, lod });
      nextVehicle.root.userData.isVehicle = true;

      // Calcular y guardar bbox local para sombras y cotas
      const localBox = getVehicleLocalBox(nextVehicle);

      // Aplicar el modo de vista actual al nuevo vehiculo
      applyViewMode(nextVehicle, currentViewMode, partStatesMap, viewModeMaterials);

      // Compilar con el modelo invisible para no superponerlo al actual durante el await
      nextVehicle.root.visible = false;
      sceneMgr.scene.add(nextVehicle.root);

      // 2. Precompilacion de shaders si el renderer lo soporta
      if (renderer && 'compileAsync' in renderer && cameraMgr) {
        try {
          await (renderer as unknown as { compileAsync: (s: unknown, c: unknown) => Promise<void> }).compileAsync(
            sceneMgr.scene,
            cameraMgr.camera,
          );
        } catch {
          // Ignorar si el backend no lo soporta
        }
      } else {
        await Promise.resolve();
      }

      // Si al volver del await ya hay una llamada mas nueva, descartar este vehiculo
      if (seq !== vehicleSeq) {
        sceneMgr.scene.remove(nextVehicle.root);
        disposeVehicleGeometries(nextVehicle.root);
        return;
      }

      // Restaurar visibilidad para montaje o transicion
      nextVehicle.root.visible = true;
      currentSpec = spec;

      const prevVehicle = currentVehicle;
      currentVehicle = nextVehicle;
      pickingMgr.setVehicle(nextVehicle);

      // Actualizar sombra de contacto al bbox del nuevo vehiculo
      sceneMgr.updateContactShadow(localBox, nextVehicle.root.rotation.y);

      // Medir los bounds antes de desplazar el vehiculo por la transicion
      cameraMgr?.fitToVehicle(nextVehicle, prevVehicle ? false : true);

      if (prevVehicle) {
        // 3. Transicion de carrusel (~450 ms)
        carouselMgr.startTransition(
          prevVehicle.root,
          nextVehicle.root,
          transitionOpts?.direction ?? 1,
          () => {
            sceneMgr.scene.remove(prevVehicle.root);
            disposeVehicleGeometries(prevVehicle.root);
            sceneMgr.requestShadowUpdate();
            markViewChanged();
          },
        );
      }

      sceneMgr.requestShadowUpdate();
      markViewChanged();
      scheduleTurntableActivation();
      wakeLoop();
    },

    setPartStates(states: PartState[]): void {
      partStatesMap.clear();
      for (const s of states) {
        partStatesMap.set(s.slotId, s);
      }
      hasOverduePart = states.some((s) => s.status === 'overdue');

      if (currentVehicle) {
        applyViewMode(currentVehicle, currentViewMode, partStatesMap, viewModeMaterials);
      }
      wakeLoop();
    },

    setViewMode(mode: ViewMode): void {
      currentViewMode = mode;
      if (currentVehicle) {
        applyViewMode(currentVehicle, currentViewMode, partStatesMap, viewModeMaterials);
      }
      wakeLoop();
    },

    focusPart(slotId: PartSlotId | null): void {
      cameraMgr?.focusPart(slotId, currentVehicle);
      pickingMgr.setSelectedSlot(slotId);
      markViewChanged();
      wakeLoop();
    },

    onPartSelected(cb: (slotId: PartSlotId | null) => void): () => void {
      return pickingMgr.onPartSelected(cb);
    },

    setPaint(paint: PaintSpec): void {
      if (!currentSpec || !currentVehicle) return;
      currentSpec = { ...currentSpec, paint };
      ++vehicleSeq;

      const tpl = getTemplate(currentSpec.body, currentSpec.family);
      const lod = governor.getTier() === 'low' ? 'low' : 'high';
      const nextVehicle = tpl.build(currentSpec, { materials: kit, lod });
      nextVehicle.root.userData.isVehicle = true;

      const localBox = getVehicleLocalBox(nextVehicle);

      applyViewMode(nextVehicle, currentViewMode, partStatesMap, viewModeMaterials);

      const oldVehicle = currentVehicle;
      sceneMgr.scene.remove(oldVehicle.root);
      disposeVehicleGeometries(oldVehicle.root);

      sceneMgr.scene.add(nextVehicle.root);
      currentVehicle = nextVehicle;
      pickingMgr.setVehicle(nextVehicle);

      sceneMgr.updateContactShadow(localBox, nextVehicle.root.rotation.y);

      // Conservar camara: immediate = false refresca bounds internos sin moverla
      cameraMgr?.fitToVehicle(nextVehicle, false);

      sceneMgr.requestShadowUpdate();
      markViewChanged();
      scheduleTurntableActivation();
      wakeLoop();
    },

    resize(): void {
      if (!renderer || !canvasEl || !cameraMgr) return;
      const w = canvasEl.clientWidth || 1;
      const h = canvasEl.clientHeight || 1;
      renderer.setSize(w, h, false);
      cameraMgr.resize(w, h);
      markViewChanged();
      wakeLoop();
    },

    getStats(): EngineStats {
      const renderInfo = (renderer?.info.render ?? {}) as {
        drawCalls?: number;
        calls?: number;
        triangles?: number;
      };
      const drawCalls = renderInfo.drawCalls ?? renderInfo.calls ?? lastDrawCalls;
      const triangles = currentVehicle?.triangles ?? renderInfo.triangles ?? 0;

      return {
        backend,
        fps: measuredFps,
        frameMs: Math.round(measuredFrameMs * 10) / 10,
        drawCalls: drawCalls || lastDrawCalls,
        triangles,
        dpr: renderer?.getPixelRatio() ?? governor.getDpr(),
        tier: governor.getTier(),
      };
    },

    getVehiclesInScene(): number {
      let count = 0;
      for (const child of sceneMgr.scene.children) {
        if (child.name.startsWith('vehicle:') || child.userData.isVehicle === true) {
          count++;
        }
      }
      return count;
    },

    isTransitioning(): boolean {
      return carouselMgr.isTransitioning();
    },

    isTurntableActive(): boolean {
      return isTurntableActive;
    },

    canRunTurntable(): boolean {
      return canRunTurntable();
    },

    getTheme(): StageTheme {
      return currentTheme;
    },

    triggerFrame(): void {
      if (renderer && cameraMgr && canvasEl) {
        onFrame(performance.now());
      } else {
        notifyViewChangeIfNeeded();
      }
    },

    dispose(): void {
      if (turntableTimer) {
        clearTimeout(turntableTimer);
        turntableTimer = null;
      }

      viewChangeListeners.clear();

      renderer?.setAnimationLoop(null);
      isLoopRunning = false;

      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }

      pickingMgr.dispose();
      cameraMgr?.dispose();
      carouselMgr.dispose();
      sceneMgr.dispose();

      if (currentVehicle) {
        sceneMgr.scene.remove(currentVehicle.root);
        disposeVehicleGeometries(currentVehicle.root);
        currentVehicle = null;
      }

      viewModeMaterials.dispose();
      kit.dispose();
      renderer?.dispose();
      renderer = null;
      canvasEl = null;
    },
  };

  return api;
}
