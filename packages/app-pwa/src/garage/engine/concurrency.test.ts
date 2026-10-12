import { describe, expect, it } from 'vitest';
import { Group, BoxGeometry, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { disposeVehicleGeometries } from './carousel';

describe('Concurrency and Lifecycle Mechanics', () => {
  it('simula la cancelacion por secuencia mas nueva liberando geometrias', () => {
    let vehicleSeq = 0;
    const scene: Group[] = [];
    const disposedIds: string[] = [];

    async function mockShowVehicle(id: string) {
      const seq = ++vehicleSeq;
      const root = new Group();
      root.name = `vehicle:${id}`;
      const geo = new BoxGeometry();
      geo.dispose = () => {
        disposedIds.push(id);
      };
      root.add(new Mesh(geo, new MeshBasicNodeMaterial()));
      root.visible = false;
      scene.push(root);

      // Simular compilacion asincrona
      await new Promise((r) => setTimeout(r, 20));

      if (seq !== vehicleSeq) {
        // Descartado por llamada mas nueva
        const idx = scene.indexOf(root);
        if (idx !== -1) scene.splice(idx, 1);
        disposeVehicleGeometries(root);
        return;
      }

      root.visible = true;
    }

    // Dos llamadas consecutivas sin esperar
    const p1 = mockShowVehicle('call1');
    const p2 = mockShowVehicle('call2');

    return Promise.all([p1, p2]).then(() => {
      // call1 debio ser descartado y sus geometrias liberadas
      expect(disposedIds).toContain('call1');
      expect(scene.length).toBe(1);
      expect(scene[0].name).toBe('vehicle:call2');
      expect(scene[0].visible).toBe(true);
    });
  });
});
