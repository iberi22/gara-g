/**
 * ronda3.test.ts — Pruebas unitarias de la Ronda 3 del motor 3D:
 * 1. Proyeccion de puntos (centro de pantalla, punto detras de camara -> visible false, fuera de pantalla).
 * 2. DimensionAnchors y projectSlot.
 * 3. onViewChange: no dispara mas de una vez por frame frente a multiples eventos.
 * 4. setTheme: conserva la instancia del vehiculo y la camara sin reconstruir.
 * 5. Tornamesa en reposo: no arranca cuando prefers-reduced-motion esta activo o sin (hover: hover).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { BuiltVehicle, VehicleSpec } from '../contracts';
import { createGarageEngine } from './index';
import { computeDimensionAnchors, projectPointToScreen, projectVehicleSlot } from './projection';
import { GarageSceneManager } from './scene';

describe('Ronda 3 — Proyeccion 3D a pantalla (ScreenPoint y DimensionAnchors)', () => {
  it('proyecta un punto conocido en el centro de la pantalla como visible', () => {
    const camera = new PerspectiveCamera(28, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    // El origen (0, 0, 0) esta justo en el centro del eje visual
    const pt = new Vector3(0, 0, 0);
    const screen = projectPointToScreen(pt, camera, 800, 600);

    expect(screen.visible).toBe(true);
    expect(screen.x).toBeCloseTo(400, 1);
    expect(screen.y).toBeCloseTo(300, 1);
  });

  it('marca visible = false para un punto ubicado detras de la camara', () => {
    const camera = new PerspectiveCamera(28, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    // (0, 0, 10) esta detras de la camara (que esta en z = 5 mirando a z = 0)
    const ptBehind = new Vector3(0, 0, 10);
    const screen = projectPointToScreen(ptBehind, camera, 800, 600);

    expect(screen.visible).toBe(false);
  });

  it('marca visible = false para un punto fuera del canvas en X o Y', () => {
    const camera = new PerspectiveCamera(28, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    // Punto muy alejado a la derecha
    const ptOffscreen = new Vector3(50, 0, 0);
    const screen = projectPointToScreen(ptOffscreen, camera, 800, 600);

    expect(screen.visible).toBe(false);
  });

  it('calcula los 8 puntos de DimensionAnchors de un vehiculo con valores numericos validos', () => {
    const camera = new PerspectiveCamera(28, 800 / 600, 0.1, 100);
    camera.position.set(2.5, 1.5, 2.5);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const root = new Group();
    root.name = 'vehicle:test-anchors';
    const mesh = new Mesh(new BoxGeometry(2.1, 1.1, 0.8), new MeshBasicNodeMaterial());
    mesh.position.set(0, 0.55, 0);
    root.add(mesh);

    const vehicle: BuiltVehicle = {
      root,
      parts: new Map([['engine', mesh]]),
      focusPoints: { engine: [0, 0.55, 0] },
      triangles: 12,
    };

    const spec: VehicleSpec = {
      family: 'moto',
      body: 'naked',
      dims: { lengthMm: 2100, widthMm: 800, heightMm: 1100, wheelbaseMm: 1440 },
      tireFront: { widthMm: 120, aspectPct: 70, rimIn: 17 },
      tireRear: { widthMm: 180, aspectPct: 55, rimIn: 17 },
      paint: { baseColor: '#38bdf8', finish: 'gloss' },
    };

    const anchors = computeDimensionAnchors(vehicle, spec, camera, 800, 600);

    // Verificar existencia de los 8 puntos requeridos por contracts.ts
    expect(anchors.frontTop).toBeDefined();
    expect(anchors.rearTop).toBeDefined();
    expect(anchors.frontGround).toBeDefined();
    expect(anchors.rearGround).toBeDefined();
    expect(anchors.top).toBeDefined();
    expect(anchors.topGround).toBeDefined();
    expect(anchors.axleFront).toBeDefined();
    expect(anchors.axleRear).toBeDefined();

    for (const key of Object.keys(anchors) as (keyof typeof anchors)[]) {
      const p = anchors[key];
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(typeof p.visible).toBe('boolean');
      expect(Number.isNaN(p.x)).toBe(false);
      expect(Number.isNaN(p.y)).toBe(false);
    }

    // projectVehicleSlot para pieza existente
    const slotScreen = projectVehicleSlot(vehicle, 'engine', camera, 800, 600);
    expect(slotScreen).not.toBeNull();
    expect(slotScreen?.visible).toBe(true);

    // projectVehicleSlot para pieza inexistente
    const nonExistent = projectVehicleSlot(vehicle, 'non_existent_slot', camera, 800, 600);
    expect(nonExistent).toBeNull();
  });
});

describe('Ronda 3 — Motor: onViewChange, setTheme y tornamesa en reposo', () => {
  const originalWindow = (globalThis as unknown as { window: unknown }).window;

  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = {
      matchMedia: vi.fn().mockImplementation((query: string) => {
        if (query.includes('hover: hover')) {
          return { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        }
        if (query.includes('prefers-reduced-motion')) {
          return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        }
        return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      }),
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('onViewChange no dispara mas de una vez por frame aunque ocurran multiples cambios', () => {
    const engine = createGarageEngine({ quality: 'low', forceWebGL: true });
    let calls = 0;

    const unsubscribe = engine.onViewChange(() => {
      calls++;
    });

    // Varios cambios sucesivos dentro del mismo ciclo
    engine.setTheme('garage');
    engine.resize();
    engine.setTheme('studio');
    engine.resize();

    // Ejecutar un frame
    engine.triggerFrame?.();
    expect(calls).toBe(1);

    // Siguiente frame sin cambios -> no dispara
    engine.triggerFrame?.();
    expect(calls).toBe(1);

    // Desuscribirse
    unsubscribe();
    engine.resize();
    engine.triggerFrame?.();
    expect(calls).toBe(1);

    engine.dispose();
  });

  it('setTheme conserva el vehiculo sin reconstruirlo ni recrear la raiz', () => {
    const sceneMgr = new GarageSceneManager();
    const root = new Group();
    root.name = 'vehicle:test-preservation';
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicNodeMaterial());
    root.add(mesh);

    // Montar vehiculo en la escena
    sceneMgr.scene.add(root);
    expect(sceneMgr.scene.children.includes(root)).toBe(true);
    expect(sceneMgr.getTheme()).toBe('studio');

    // Cambiar a garage
    sceneMgr.setTheme('garage');
    expect(sceneMgr.getTheme()).toBe('garage');
    // El vehiculo exacto sigue en la escena
    expect(sceneMgr.scene.children.includes(root)).toBe(true);

    // Cambiar de vuelta a studio
    sceneMgr.setTheme('studio');
    expect(sceneMgr.getTheme()).toBe('studio');
    expect(sceneMgr.scene.children.includes(root)).toBe(true);

    sceneMgr.dispose();
  });

  it('tornamesa no arranca cuando prefers-reduced-motion esta activo', () => {
    (globalThis as unknown as { window: { matchMedia: unknown } }).window.matchMedia = vi.fn().mockImplementation((query: string) => {
      if (query.includes('prefers-reduced-motion')) {
        return { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      }
      if (query.includes('hover: hover')) {
        return { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      }
      return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    });

    const engine = createGarageEngine({ quality: 'low', forceWebGL: true });
    expect(engine.canRunTurntable?.()).toBe(false);

    engine.dispose();
  });

  it('tornamesa no arranca en dispositivos sin (hover: hover) como pantallas tactiles puras', () => {
    (globalThis as unknown as { window: { matchMedia: unknown } }).window.matchMedia = vi.fn().mockImplementation((query: string) => {
      if (query.includes('prefers-reduced-motion')) {
        return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      }
      if (query.includes('hover: hover')) {
        return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      }
      return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    });

    const engine = createGarageEngine({ quality: 'low', forceWebGL: true });
    expect(engine.canRunTurntable?.()).toBe(false);

    engine.dispose();
  });
});
