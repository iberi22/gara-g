import { describe, expect, it } from 'vitest';
import { Group, BoxGeometry, Mesh, MeshBasicNodeMaterial, PerspectiveCamera } from 'three/webgpu';
import { fitDistance, GarageCameraManager } from './camera';
import type { BuiltVehicle } from '../contracts';

describe('Camera Fit and Distance Calculations', () => {
  it('fitDistance calcula la distancia exacta para aspect 1:1 con fov 60 deg', () => {
    // fov = 60 deg -> half angle = 30 deg -> sin(30) = 0.5 -> dist = radius / 0.5 = 2 * radius
    const dist = fitDistance(1, 60, 1);
    expect(dist).toBeCloseTo(2.0, 4);
  });

  it('fitDistance se aleja en pantallas verticales (aspect < 1) para que quepa en el ancho', () => {
    const radius = 1.5;
    const vfov = 32;
    const landscapeDist = fitDistance(radius, vfov, 16 / 9);
    const portraitDist = fitDistance(radius, vfov, 390 / 844);

    // En vertical (movil 390x844), la distancia debe ser significativamente mayor que en horizontal
    expect(portraitDist).toBeGreaterThan(landscapeDist * 1.8);
    // Para 32 deg y aspect ~0.462, dist ~ 1.5 / sin(7.55 deg) ~ 11.41
    expect(portraitDist).toBeCloseTo(11.41, 1);
  });

  it('fitDistance maneja entradas invalidas retornando 0', () => {
    expect(fitDistance(0, 32, 1)).toBe(0);
    expect(fitDistance(-1, 32, 1)).toBe(0);
    expect(fitDistance(1, 0, 1)).toBe(0);
    expect(fitDistance(1, 32, 0)).toBe(0);
  });

  it('fitToVehicle centra los bounds en (0, y, 0) aunque el vehiculo este desplazado en x = 4', () => {
    const mockCanvas = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      getRootNode: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
      style: {},
      ownerDocument: {
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    } as unknown as HTMLCanvasElement;

    const camMgr = new GarageCameraManager(mockCanvas);

    const root = new Group();
    root.name = 'vehicle:test';
    const mesh = new Mesh(new BoxGeometry(2, 1, 1), new MeshBasicNodeMaterial());
    root.add(mesh);

    // Simular que el carrusel desplazo el vehiculo a x = 4.0
    root.position.x = 4.0;
    root.updateMatrixWorld(true);

    const vehicle: BuiltVehicle = {
      root,
      parts: new Map(),
      focusPoints: {},
      triangles: 12,
    };

    camMgr.fitToVehicle(vehicle, true);

    const bounds = camMgr.getBounds();
    // El centro debe estar cerca de x = 0 (posicion final del vehiculo), NO en x = 4
    expect(bounds.center.x).toBeCloseTo(0, 2);
    // Y el vehiculo no debe quedar alterado permanentemente
    expect(root.position.x).toBe(4.0);
  });
});

