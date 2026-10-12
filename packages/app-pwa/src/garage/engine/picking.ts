/**
 * picking.ts — Raycasting, seleccion de piezas y deteccion de arrastre/hover.
 *
 * Realiza un raycast unico contra la raiz del vehiculo. Resuelve el slotId
 * navegando hacia arriba en la jerarquia de objetos. Ignora arrastres (>6 px entre
 * pointerdown y pointerup). Resalta al pasar el mouse solo en dispositivos con (hover: hover)
 * y mantiene resaltada la pieza seleccionada.
 */
import {
  Color,
  Mesh,
  Raycaster,
  Vector2,
  type Camera,
  type MeshStandardMaterial,
  type Object3D,
} from 'three/webgpu';
import type { BuiltVehicle, PartSlotId } from '../contracts';

export function findSlotId(object: Object3D | null | undefined): PartSlotId | null {
  let curr: Object3D | null | undefined = object;
  while (curr) {
    if (curr.userData && typeof curr.userData.slotId === 'string' && curr.userData.slotId.length > 0) {
      return curr.userData.slotId;
    }
    if (curr.name && curr.name.startsWith('part:')) {
      return curr.name.slice(5);
    }
    curr = curr.parent;
  }
  return null;
}

export class PickingManager {
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private downPos = { x: 0, y: 0, time: 0 };
  private lastTapTime = 0;
  private selectedSlot: PartSlotId | null = null;
  private hoveredSlot: PartSlotId | null = null;
  private listeners = new Set<(slotId: PartSlotId | null) => void>();
  private highlightedMeshes = new Set<Mesh>();

  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onDblClickBound: (e: MouseEvent) => void;

  private canvas: HTMLCanvasElement | null = null;
  private camera: Camera | null = null;
  private currentVehicle: BuiltVehicle | null = null;
  private onActivity: (() => void) | null = null;

  constructor() {
    this.onPointerDownBound = this.onPointerDown.bind(this);
    this.onPointerUpBound = this.onPointerUp.bind(this);
    this.onPointerMoveBound = this.onPointerMove.bind(this);
    this.onDblClickBound = this.onDblClick.bind(this);
  }

  public attach(
    canvas: HTMLCanvasElement,
    camera: Camera,
    onActivity: () => void,
    onDblClickReset: () => void,
  ): void {
    this.canvas = canvas;
    this.camera = camera;
    this.onActivity = onActivity;

    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    canvas.addEventListener('pointerup', this.onPointerUpBound);
    canvas.addEventListener('pointermove', this.onPointerMoveBound);
    canvas.addEventListener('dblclick', (e) => {
      this.onDblClickBound(e);
      onDblClickReset();
    });
  }

  public setVehicle(vehicle: BuiltVehicle | null): void {
    this.clearHighlights();
    this.currentVehicle = vehicle;
    this.selectedSlot = null;
    this.hoveredSlot = null;
  }

  public setSelectedSlot(slotId: PartSlotId | null): void {
    this.selectedSlot = slotId;
    this.applyHighlights();
  }

  public getSelectedSlot(): PartSlotId | null {
    return this.selectedSlot;
  }

  public onPartSelected(cb: (slotId: PartSlotId | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(slotId: PartSlotId | null): void {
    for (const cb of this.listeners) {
      cb(slotId);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    this.downPos = { x: e.clientX, y: e.clientY, time: performance.now() };
    this.onActivity?.();
  }

  private onPointerUp(e: PointerEvent): void {
    this.onActivity?.();
    if (!this.canvas || !this.camera || !this.currentVehicle) return;

    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;
    const dist = Math.hypot(dx, dy);

    // Ignorar si fue arrastre de camara (> 6 px)
    if (dist > 6) return;

    // Comprobar doble toque en movil
    const now = performance.now();
    if (now - this.lastTapTime < 300) {
      this.lastTapTime = 0;
      this.selectedSlot = null;
      this.clearHighlights();
      this.notify(null);
      return;
    }
    this.lastTapTime = now;

    // Raycast contra el vehiculo
    const hitSlot = this.raycastSlot(e.clientX, e.clientY);
    this.selectedSlot = hitSlot;
    this.applyHighlights();
    this.notify(hitSlot);
  }

  private onPointerMove(e: PointerEvent): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // Solo resaltar al pasar el mouse si el dispositivo soporta hover
    if (!window.matchMedia('(hover: hover)').matches) return;
    if (!this.canvas || !this.camera || !this.currentVehicle) return;

    const hitSlot = this.raycastSlot(e.clientX, e.clientY);
    if (hitSlot !== this.hoveredSlot) {
      this.hoveredSlot = hitSlot;
      this.applyHighlights();
      this.onActivity?.();
    }
  }

  private onDblClick(_e: MouseEvent): void {
    this.selectedSlot = null;
    this.clearHighlights();
    this.notify(null);
    this.onActivity?.();
  }

  private raycastSlot(clientX: number, clientY: number): PartSlotId | null {
    if (!this.canvas || !this.camera || !this.currentVehicle) return null;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObject(this.currentVehicle.root, true);

    if (intersects.length > 0) {
      return findSlotId(intersects[0].object);
    }
    return null;
  }

  private applyHighlights(): void {
    this.clearHighlights();
    if (!this.currentVehicle) return;

    const targetSlot = this.selectedSlot ?? this.hoveredSlot;
    if (!targetSlot) return;

    const partObj = this.currentVehicle.parts.get(targetSlot);
    if (!partObj) return;

    const isSelected = targetSlot === this.selectedSlot;
    const highlightColor = new Color(isSelected ? '#38bdf8' : '#0284c7');
    const intensity = isSelected ? 1.6 : 0.8;

    partObj.traverse((child: Object3D) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      const mat = mesh.material as unknown as MeshStandardMaterial;
      if ('emissive' in mat && mat.emissive) {
        if (!mesh.userData.origEmissive) {
          mesh.userData.origEmissive = mat.emissive.clone();
          mesh.userData.origEmissiveIntensity = mat.emissiveIntensity ?? 0;
        }
        mat.emissive.copy(highlightColor);
        mat.emissiveIntensity = intensity;
        this.highlightedMeshes.add(mesh);
      }
    });
  }

  private clearHighlights(): void {
    for (const mesh of this.highlightedMeshes) {
      const mat = mesh.material as unknown as MeshStandardMaterial;
      if (mat && 'emissive' in mat && mat.emissive && mesh.userData.origEmissive) {
        mat.emissive.copy(mesh.userData.origEmissive as Color);
        mat.emissiveIntensity = (mesh.userData.origEmissiveIntensity as number) ?? 0;
      }
    }
    this.highlightedMeshes.clear();
  }

  public dispose(): void {
    this.clearHighlights();
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
      this.canvas.removeEventListener('pointerup', this.onPointerUpBound);
      this.canvas.removeEventListener('pointermove', this.onPointerMoveBound);
      this.canvas.removeEventListener('dblclick', this.onDblClickBound);
      this.canvas = null;
    }
    this.listeners.clear();
    this.camera = null;
    this.currentVehicle = null;
    this.onActivity = null;
  }
}
