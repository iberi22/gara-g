/**
 * camera.ts — Manejo de la camara, OrbitControls y animaciones de encuadre (focusPart).
 *
 * Limita el angulo polar para no atravesar el suelo (maxPolarAngle = 0.48 * PI) y acota
 * la distancia minima y maxima al tamaño del vehiculo. Interpola suavemente con
 * easeInOutCubic hacia el punto de foco de una ranura o vuelve a la vista general si slotId es null.
 */
import { Box3, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BuiltVehicle, PartSlotId } from '../contracts';

export interface CameraBounds {
  center: Vector3;
  size: Vector3;
  radius: number;
  overviewDist: number;
  overviewPos: Vector3;
}

/**
 * Calcula la distancia de camara necesaria para que un objeto con radio `radius`
 * quepa completamente dentro del frustum, considerando tanto el FOV vertical
 * como el FOV horizontal (hfov = 2·atan(tan(vfov/2)·aspect)).
 * Utiliza el menor de los dos angulos efectivos para evitar que el vehiculo
 * se corte en pantallas verticales (ej. moviles en portrait).
 */
export function fitDistance(radius: number, vfovDeg: number, aspect: number): number {
  if (radius <= 0 || vfovDeg <= 0 || aspect <= 0) return 0;
  const vfovRad = (vfovDeg * Math.PI) / 180;
  const hfovRad = 2 * Math.atan(Math.tan(vfovRad / 2) * aspect);
  const minFovRad = Math.min(vfovRad, hfovRad);
  return radius / Math.sin(minFovRad / 2);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class GarageCameraManager {
  public readonly camera: PerspectiveCamera;
  public readonly controls: OrbitControls;

  private bounds: CameraBounds = {
    center: new Vector3(0, 0.5, 0),
    size: new Vector3(2, 1, 1),
    radius: 1.5,
    overviewDist: 3.5,
    overviewPos: new Vector3(2.5, 1.4, 2.3),
  };

  private userInteracted = false;

  // Estado del tween de transicion de camara
  private tweenActive = false;
  /** La animacion en curso va a la vista general: su destino sigue al encuadre vigente. */
  private tweenToOverview = false;
  /** Pieza enfocada (null = vista general). */
  private focusedSlot: PartSlotId | null = null;
  private tweenProgress = 0;
  private tweenDuration = 420; // ms
  private tweenStartPos = new Vector3();
  private tweenEndPos = new Vector3();
  private tweenStartTarget = new Vector3();
  private tweenEndTarget = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new PerspectiveCamera(28, 1, 0.05, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;

    // Detectar cuando el usuario toma el control manual
    this.controls.addEventListener('start', () => {
      this.userInteracted = true;
    });

    // No atravesar el suelo
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minPolarAngle = Math.PI * 0.04;
  }

  public getBounds(): CameraBounds {
    return {
      center: this.bounds.center.clone(),
      size: this.bounds.size.clone(),
      radius: this.bounds.radius,
      overviewDist: this.bounds.overviewDist,
      overviewPos: this.bounds.overviewPos.clone(),
    };
  }

  public isUserInteracted(): boolean {
    return this.userInteracted;
  }

  public fitToVehicle(vehicle: BuiltVehicle, immediate = true): void {
    // Para no medir bounds con el vehiculo desplazado (ej. durante transiciones de carrusel en x = ±4),
    // medimos en su posicion y rotacion neutrales (0, 0, 0)
    const savedPos = vehicle.root.position.clone();
    const savedRot = vehicle.root.rotation.clone();
    vehicle.root.position.set(0, 0, 0);
    vehicle.root.rotation.set(0, 0, 0);
    vehicle.root.updateMatrixWorld(true);

    const box = new Box3().setFromObject(vehicle.root);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    // Restaurar transformacion previa del vehiculo
    vehicle.root.position.copy(savedPos);
    vehicle.root.rotation.copy(savedRot);
    vehicle.root.updateMatrixWorld(true);

    const radius = Math.max(size.length() / 2, 0.8);
    const overviewDist = fitDistance(radius, this.camera.fov, this.camera.aspect);

    // Vector de orientacion 3/4 agradable: [0.78, 0.32, 0.72]
    const dir = new Vector3(0.78, 0.32, 0.72).normalize();
    const overviewPos = center.clone().addScaledVector(dir, overviewDist);

    this.bounds = {
      center,
      size,
      radius,
      overviewDist,
      overviewPos,
    };

    this.controls.minDistance = Math.max(0.5, radius * 0.5);
    this.controls.maxDistance = Math.max(radius * 4.0, overviewDist * 1.8);

    if (immediate) {
      this.userInteracted = false;
      this.focusedSlot = null;
      this.controls.target.copy(center);
      this.camera.position.copy(overviewPos);
      this.controls.update();
    }
  }

  public focusPart(slotId: PartSlotId | null, vehicle: BuiltVehicle | null): void {
    if (!slotId || !vehicle) {
      // Volver a vista general. Si el usuario no ha movido la camara y no hay pieza
      // enfocada, ya estamos en la vista general: no se anima (el HUD llama focusPart(null)
      // al montar, y esa animacion dejaba la camara en un encuadre viejo si el canvas
      // cambiaba de tamaño mientras corria).
      if (!this.userInteracted && !this.focusedSlot) return;
      this.focusedSlot = null;
      this.tweenToOverview = true;
      this.startTween(this.bounds.overviewPos, this.bounds.center);
      return;
    }
    this.focusedSlot = slotId;
    this.tweenToOverview = false;

    // 1. Intentar punto de foco declarado en la plantilla
    let target: Vector3 | null = null;
    const pt = vehicle.focusPoints[slotId];
    if (pt) {
      target = new Vector3(...pt);
    } else {
      // 2. Fallback: centro del bounding box del objeto de la pieza
      const partObj = vehicle.parts.get(slotId);
      if (partObj) {
        const box = new Box3().setFromObject(partObj);
        target = box.getCenter(new Vector3());
      }
    }

    if (!target) {
      this.startTween(this.bounds.overviewPos, this.bounds.center);
      return;
    }

    // Posicion objetivo: mantener el angulo de vision actual pero a una distancia cercana
    const curDir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (curDir.y < 0.15) curDir.y = 0.25;
    curDir.normalize();

    const focusDist = Math.max(this.bounds.radius * 0.65, 0.95);
    const endPos = target.clone().addScaledVector(curDir, focusDist);

    // Evitar que la camara baje del suelo
    if (endPos.y < 0.12) endPos.y = 0.12;

    this.startTween(endPos, target);
  }

  private startTween(endPos: Vector3, endTarget: Vector3): void {
    this.tweenStartPos.copy(this.camera.position);
    this.tweenEndPos.copy(endPos);
    this.tweenStartTarget.copy(this.controls.target);
    this.tweenEndTarget.copy(endTarget);
    this.tweenProgress = 0;
    this.tweenActive = true;
  }

  /**
   * Actualiza el tween de camara y damping de controles.
   * Retorna true si hay movimiento activo.
   */
  public update(deltaMs: number): boolean {
    let moving = false;

    if (this.tweenActive) {
      this.tweenProgress += deltaMs / this.tweenDuration;
      if (this.tweenProgress >= 1.0) {
        this.tweenProgress = 1.0;
        this.tweenActive = false;
      }
      const t = easeInOutCubic(this.tweenProgress);
      if (this.tweenToOverview) {
        // Si el canvas cambio de tamaño a mitad de camino, el destino es el encuadre nuevo.
        this.tweenEndPos.copy(this.bounds.overviewPos);
        this.tweenEndTarget.copy(this.bounds.center);
      }
      this.camera.position.lerpVectors(this.tweenStartPos, this.tweenEndPos, t);
      this.controls.target.lerpVectors(this.tweenStartTarget, this.tweenEndTarget, t);
      moving = true;
    }

    // Controls update realiza el damping suave
    this.controls.update();

    return moving;
  }

  public isTweening(): boolean {
    return this.tweenActive;
  }

  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    if (this.bounds.radius > 0) {
      const newDist = fitDistance(this.bounds.radius, this.camera.fov, this.camera.aspect);
      this.bounds.overviewDist = newDist;

      // Mantener la orientacion actual de la camara
      const curDir = this.camera.position.clone().sub(this.controls.target);
      if (curDir.lengthSq() < 1e-4) {
        curDir.set(0.78, 0.32, 0.72);
      }
      curDir.normalize();

      this.bounds.overviewPos = this.bounds.center.clone().addScaledVector(curDir, newDist);
      this.controls.maxDistance = Math.max(this.bounds.radius * 4.0, newDist * 1.8);

      // Si el usuario no ha movido la camara y no hay un tween activo, recalcular posicion
      // Sin interaccion del usuario y sin pieza enfocada, el encuadre manda: se cancela
      // cualquier animacion hacia la vista general y se reencuadra al tamaño nuevo.
      if (!this.userInteracted && !this.focusedSlot) {
        this.tweenActive = false;
        this.camera.position.copy(this.bounds.center).addScaledVector(curDir, newDist);
        this.controls.target.copy(this.bounds.center);
        this.controls.update();
      }
    }
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
