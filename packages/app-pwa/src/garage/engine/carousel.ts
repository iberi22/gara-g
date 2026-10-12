/**
 * carousel.ts — Transicion de carrusel entre vehiculos en el tornamesa.
 *
 * Mueve el vehiculo saliente deslizandolo y rotandolo hacia un lado mientras
 * el entrante entra por el lado opuesto (~450 ms, easeInOutCubic).
 * Respeta `prefers-reduced-motion` aplicando un corte directo sin animacion.
 * Al completar la transicion, libera las geometrias del vehiculo saliente
 * preservando el kit de materiales compartido.
 */
import type { Mesh, Object3D } from 'three/webgpu';

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface CarouselTransition {
  outgoing: Object3D;
  incoming: Object3D;
  direction: 1 | -1;
  duration: number; // ms
  elapsed: number;
  onComplete: () => void;
}

export function isReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function disposeVehicleGeometries(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.dispose();
    }
  });
}

export class CarouselManager {
  private active: CarouselTransition | null = null;

  public startTransition(
    outgoing: Object3D,
    incoming: Object3D,
    direction: 1 | -1 = 1,
    onComplete: () => void,
  ): void {
    // Terminar de inmediato cualquier transicion previa activa
    if (this.active) {
      this.finish();
    }

    const reduced = isReducedMotion();
    const duration = reduced ? 0 : 450;

    // Colocar el vehiculo entrante en su posicion de arranque
    if (duration > 0) {
      incoming.position.x = 4.0 * direction;
      incoming.rotation.y = 0.45 * direction;
    } else {
      incoming.position.set(0, 0, 0);
      incoming.rotation.set(0, 0, 0);
    }

    this.active = {
      outgoing,
      incoming,
      direction,
      duration,
      elapsed: 0,
      onComplete,
    };

    if (duration === 0) {
      this.finish();
    }
  }

  public update(deltaMs: number): boolean {
    if (!this.active) return false;

    this.active.elapsed += deltaMs;
    const progress = Math.min(1.0, this.active.elapsed / this.active.duration);
    const t = easeInOutCubic(progress);

    const dir = this.active.direction;

    // Saliente sale hacia -dir * 4.0
    this.active.outgoing.position.x = -4.0 * dir * t;
    this.active.outgoing.rotation.y = -0.45 * dir * t;

    // Entrante llega desde +dir * 4.0 a 0
    this.active.incoming.position.x = 4.0 * dir * (1.0 - t);
    this.active.incoming.rotation.y = 0.45 * dir * (1.0 - t);

    if (progress >= 1.0) {
      this.finish();
      return true;
    }

    return true;
  }

  public isTransitioning(): boolean {
    return this.active !== null;
  }

  public finish(): void {
    if (!this.active) return;
    const { incoming, onComplete } = this.active;
    incoming.position.set(0, 0, 0);
    incoming.rotation.set(0, 0, 0);
    this.active = null;
    onComplete();
  }

  public dispose(): void {
    this.active = null;
  }
}
