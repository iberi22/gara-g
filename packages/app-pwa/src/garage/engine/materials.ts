/**
 * materials.ts — Materiales de modos de vista (health y xray) y aplicador de estados.
 *
 * En modo 'health', cada pieza recibe uno de los 5 materiales compartidos de estado.
 * El estado 'overdue' pulsa con TSL en su canal emisivo.
 * En modo 'xray', las piezas con categoria 'carroceria' reciben un material translucido
 * con efecto Fresnel calculado en TSL, y las piezas internas se hacen visibles.
 * En modo 'beauty', se restauran los materiales originales guardados en `userData.baseMaterial`
 * y las piezas con `internal: true` se ocultan.
 */
import {
  Color,
  DoubleSide,
  Mesh,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { color, dot, float, mix, normalView, positionView, sin, time } from 'three/tsl';
import type { BuiltVehicle, PartHealthStatus, PartSlotId, PartState, ViewMode } from '../contracts';
import { categoryOfSlot, getSlot } from '../parts';

export interface ViewModeMaterials {
  statusMaterials: Record<PartHealthStatus, Material>;
  xrayMaterial: Material;
  dispose(): void;
}

export function createViewModeMaterials(): ViewModeMaterials {
  const statusMaterials: Record<PartHealthStatus, Material> = {
    ok: createStatusMaterial('#22c55e', 0.1, 0.35),
    warn: createStatusMaterial('#f59e0b', 0.1, 0.35),
    critical: createStatusMaterial('#ef4444', 0.1, 0.35),
    unknown: createStatusMaterial('#64748b', 0.05, 0.45),
    overdue: createOverdueMaterial(),
  };

  const xrayMaterial = createXrayMaterial();

  return {
    statusMaterials,
    xrayMaterial,
    dispose() {
      for (const m of Object.values(statusMaterials)) {
        m.dispose();
      }
      xrayMaterial.dispose();
    },
  };
}

function createStatusMaterial(hex: string, metalness: number, roughness: number): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.name = `status:${hex}`;
  m.color = new Color(hex);
  m.metalness = metalness;
  m.roughness = roughness;
  return m;
}

function createOverdueMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.name = 'status:overdue';
  m.color = new Color('#dc2626');
  m.roughness = 0.32;
  m.metalness = 0.1;

  // Pulso emisivo continuo usando TSL sin(time * 4)
  const pulse = sin(time.mul(4.0)).mul(0.5).add(0.5);
  m.emissiveNode = mix(color(0x550000), color(0xff2222), pulse);
  m.emissiveIntensity = 2.2;
  return m;
}

function createXrayMaterial(): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial();
  m.name = 'xray:fresnel';
  m.colorNode = color(0x38bdf8);
  m.roughness = 0.1;
  m.metalness = 0.1;
  m.side = DoubleSide;
  m.transparent = true;
  m.depthWrite = false;

  // TSL: dot product de normalView y direccion de vista para efecto Fresnel de rayos X
  const viewDir = positionView.normalize().negate();
  const cosTheta = dot(normalView, viewDir).abs();
  const fresnel = float(1.0).sub(cosTheta).clamp(0.0, 1.0);
  m.opacityNode = mix(float(0.18), float(0.85), fresnel.pow(float(2.0)));
  return m;
}

/**
 * Aplica el modo de vista actual sobre el vehiculo construido.
 */
export function applyViewMode(
  vehicle: BuiltVehicle,
  mode: ViewMode,
  partStates: Map<PartSlotId, PartState>,
  materials: ViewModeMaterials,
): void {
  // Comprobar si la plantilla tiene ranuras formales de carroceria
  const hasCarroceria = [...vehicle.parts.keys()].some((id) => categoryOfSlot(id) === 'carroceria');

  for (const [slotId, partObj] of vehicle.parts.entries()) {
    const slotDef = getSlot(slotId);
    const isInternal = slotDef?.internal ?? false;
    const category = categoryOfSlot(slotId);
    // Si la plantilla no tiene ranura de carroceria (como debug-block), el bloque principal actua como tal
    const isCarroceria = category === 'carroceria' || (!hasCarroceria && (slotId === 'engine' || slotId === 'body'));

    // Visibilidad de ranuras internas
    if (mode === 'beauty') {
      partObj.visible = !isInternal;
    } else {
      // En health y xray los internos son visibles
      partObj.visible = true;
    }

    partObj.traverse((child: Object3D) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;

      // Preservar siempre el material base si aun no esta guardado
      if (!mesh.userData.baseMaterial) {
        mesh.userData.baseMaterial = mesh.material;
      }
      const baseMat = mesh.userData.baseMaterial as Material;

      if (mode === 'beauty') {
        mesh.material = baseMat;
      } else if (mode === 'health') {
        const state = partStates.get(slotId);
        const status: PartHealthStatus = state?.status ?? 'unknown';
        mesh.material = materials.statusMaterials[status] ?? materials.statusMaterials.unknown;
      } else if (mode === 'xray') {
        if (isCarroceria) {
          mesh.material = materials.xrayMaterial;
        } else {
          mesh.material = baseMat;
        }
      }
    });
  }
}
