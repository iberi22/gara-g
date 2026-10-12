import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { disposeVehicleGeometries, easeInOutCubic, CarouselManager } from './carousel';

describe('Carousel Animation Math', () => {
  it('evalua easeInOutCubic en los extremos y punto medio', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });

  it('produce aceleracion suave al inicio y frenado suave al final', () => {
    // Pendiente suave cerca de 0
    const t01 = easeInOutCubic(0.1);
    expect(t01).toBeCloseTo(0.004, 3);

    // Pendiente suave cerca de 1
    const t09 = easeInOutCubic(0.9);
    expect(t09).toBeCloseTo(0.996, 3);
  });

  it('libera geometrias correctamente con disposeVehicleGeometries', () => {
    const geo = new BoxGeometry(1, 1, 1);
    let disposed = false;
    geo.dispose = () => {
      disposed = true;
    };

    const mesh = new Mesh(geo, new MeshBasicNodeMaterial());
    disposeVehicleGeometries(mesh);

    expect(disposed).toBe(true);
  });

  it('termina de inmediato la transicion previa si llega una nueva solapada', () => {
    const mgr = new CarouselManager();
    const v1 = new Mesh();
    const v2 = new Mesh();
    const v3 = new Mesh();

    let v1Finished = false;
    let v2Finished = false;

    // Iniciar transicion 1 (v1 -> v2)
    mgr.startTransition(v1, v2, 1, () => {
      v1Finished = true;
    });

    // Simular que avanza la mitad
    mgr.update(200);
    expect(mgr.isTransitioning()).toBe(true);
    expect(v1Finished).toBe(false);

    // Iniciar transicion 2 (v2 -> v3) mientras transicion 1 sigue activa
    mgr.startTransition(v2, v3, -1, () => {
      v2Finished = true;
    });

    // La transicion 1 debio completarse inmediatamente
    expect(v1Finished).toBe(true);
    expect(v2.position.x).toBe(0);
    expect(v2.position.y).toBe(0);
    expect(v2.position.z).toBe(0);
    expect(v2.rotation.y).toBe(0);

    // La transicion 2 debe estar activa
    expect(mgr.isTransitioning()).toBe(true);

    // Avanzar transicion 2 hasta el final
    mgr.update(500);
    expect(v2Finished).toBe(true);
    expect(v3.position.x).toBe(0);
    expect(mgr.isTransitioning()).toBe(false);
  });
});

