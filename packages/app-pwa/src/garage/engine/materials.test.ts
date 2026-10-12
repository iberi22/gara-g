import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardNodeMaterial } from 'three/webgpu';
import type { PartSlotId, PartState, VehicleSpec } from '../contracts';
import { DEBUG_TEMPLATE } from '../templates/common/debugTemplate';
import { createMaterialKit } from '../templates/common/materials';
import { applyViewMode, createViewModeMaterials } from './materials';

describe('View Modes & Materials', () => {
  const kit = createMaterialKit();
  const spec: VehicleSpec = {
    ...DEBUG_TEMPLATE.defaults,
    paint: { baseColor: '#38bdf8', finish: 'metallic' },
  };

  it('asigna materiales y visibilidad segun el modo de vista (beauty, health, xray)', () => {
    const vehicle = DEBUG_TEMPLATE.build(spec, { materials: kit, lod: 'high' });
    const viewMaterials = createViewModeMaterials();

    // Agregar una ranura interna simulada para verificar visibilidad
    const internalMesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardNodeMaterial());
    internalMesh.userData.slotId = 'battery'; // battery tiene internal: true en parts.ts
    vehicle.parts.set('battery', internalMesh);
    vehicle.root.add(internalMesh);

    // 1. Modo beauty
    applyViewMode(vehicle, 'beauty', new Map(), viewMaterials);
    const enginePart = vehicle.parts.get('engine')!;
    const batteryPart = vehicle.parts.get('battery')!;

    expect(enginePart.visible).toBe(true);
    expect(batteryPart.visible).toBe(false); // internal oculto en beauty

    // 2. Modo health
    const states = new Map<PartSlotId, PartState>([
      ['engine', { slotId: 'engine', label: 'Motor', category: 'motor', healthPct: 90, status: 'ok' }],
      ['brake_front', { slotId: 'brake_front', label: 'Freno', category: 'frenos', healthPct: 20, status: 'overdue' }],
    ]);

    applyViewMode(vehicle, 'health', states, viewMaterials);

    // En health los internos son visibles
    expect(batteryPart.visible).toBe(true);

    // El motor recibe material de estado 'ok'
    let engineMeshMat: unknown = null;
    enginePart.traverse((c) => {
      if ((c as Mesh).isMesh) engineMeshMat = (c as Mesh).material;
    });
    expect(engineMeshMat).toBe(viewMaterials.statusMaterials.ok);

    // Ranura sin estado explico recibe 'unknown'
    let rimMeshMat: unknown = null;
    vehicle.parts.get('rim_front')?.traverse((c) => {
      if ((c as Mesh).isMesh) rimMeshMat = (c as Mesh).material;
    });
    expect(rimMeshMat).toBe(viewMaterials.statusMaterials.unknown);

    // Freno recibe material 'overdue' (con pulso emisivo)
    let brakeMeshMat: unknown = null;
    vehicle.parts.get('brake_front')?.traverse((c) => {
      if ((c as Mesh).isMesh) brakeMeshMat = (c as Mesh).material;
    });
    expect(brakeMeshMat).toBe(viewMaterials.statusMaterials.overdue);

    // 3. Modo xray
    // Agregar un panel de carroceria (ej. fuel_tank)
    const tankMesh = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshStandardNodeMaterial());
    tankMesh.userData.slotId = 'fuel_tank'; // fuel_tank es category: 'carroceria'
    vehicle.parts.set('fuel_tank', tankMesh);
    vehicle.root.add(tankMesh);

    applyViewMode(vehicle, 'xray', states, viewMaterials);
    expect(tankMesh.material).toBe(viewMaterials.xrayMaterial);

    // Las piezas que no son carroceria conservan su baseMaterial
    enginePart.traverse((c) => {
      const m = c as Mesh;
      if (m.isMesh) {
        expect(m.material).toBe(m.userData.baseMaterial);
      }
    });

    // 4. Vuelta a modo beauty restaura los materiales base
    applyViewMode(vehicle, 'beauty', states, viewMaterials);
    expect(tankMesh.material).toBe(tankMesh.userData.baseMaterial);
    expect(batteryPart.visible).toBe(false);

    viewMaterials.dispose();
    kit.dispose();
  });
});
