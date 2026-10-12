/**
 * heavyMachinery.test.ts — Plantillas de camiones (heavy) y maquinaria amarilla (machinery).
 *
 * Para cada plantilla:
 *   1. Construye en LOD high y low dentro de presupuesto (y low con menos triangulos).
 *   2. Construye con shapeParams extremos y con cada variante declarada.
 *   3. Tiene todas las ranuras requeridas de su familia, cada una como `part:<slot>`.
 *   4. Cada ranura quedo fusionada: a lo sumo una malla por material (collapse.ts).
 *   5. Apoya en el suelo (minY en +-10 mm) y no tiene NaN/Infinity.
 *   6. Caja envolvente: largo y alto en +-3 % de la ficha; ancho sin espejos en +-3 %
 *      (en la motoniveladora sin la vertedera, que sobresale de las llantas como en la real).
 */
import { describe, expect, it } from 'vitest';
import { Box3, type BufferAttribute, type Material, type Mesh, type Object3D } from 'three/webgpu';
import { RENDER_BUDGET, type VehicleSpec, type VehicleTemplate } from '../../contracts';
import { requiredSlots } from '../../parts';
import { createMaterialKit } from '../common/materials';
import { mm } from '../common/units';
import { HEAVY_TEMPLATES } from './index';
import { MACHINERY_TEMPLATES } from '../machinery';

const kit = createMaterialKit();

function specOf(t: VehicleTemplate, extra: Partial<VehicleSpec> = {}): VehicleSpec {
  return {
    ...t.defaults,
    paint: { baseColor: '#f2b200', finish: 'gloss' },
    shape: Object.fromEntries(t.shapeParams.map((p) => [p.id, p.default])),
    ...extra,
  };
}

function boundsWithout(root: Object3D, skip: string[]): Box3 {
  const box = new Box3();
  root.updateMatrixWorld(true);
  for (const child of root.children) {
    if (skip.some((s) => child.name === `part:${s}`)) continue;
    box.expandByObject(child);
  }
  return box;
}

for (const template of [...HEAVY_TEMPLATES, ...MACHINERY_TEMPLATES]) {
  describe(`${template.id} (${template.label})`, () => {
    const spec = specOf(template);
    const high = template.build(spec, { materials: kit, lod: 'high' });

    it('construye en high y low dentro de presupuesto', () => {
      const low = template.build(spec, { materials: kit, lod: 'low' });
      expect(high.triangles).toBeGreaterThan(5000);
      expect(high.triangles).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesHigh);
      expect(low.triangles).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesLow);
      expect(low.triangles).toBeLessThan(high.triangles);
    });

    it('construye con parametros extremos y con cada variante', () => {
      for (const v of [0, 1]) {
        const shape = Object.fromEntries(template.shapeParams.map((p) => [p.id, v]));
        expect(() => template.build(specOf(template, { shape }), { materials: kit, lod: 'high' })).not.toThrow();
      }
      for (const [slot, options] of Object.entries(template.variants)) {
        for (const option of options) {
          const built = template.build(specOf(template, { variants: { [slot]: option } }), { materials: kit, lod: 'high' });
          expect(built.triangles).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesHigh);
        }
      }
    });

    it('tiene todas las ranuras requeridas de su familia', () => {
      for (const slot of requiredSlots(template.family)) {
        expect(high.parts.has(slot), `falta la ranura ${slot}`).toBe(true);
        expect(high.root.getObjectByName(`part:${slot}`), `falta part:${slot} en el arbol`).toBeDefined();
        expect(high.focusPoints[slot], `falta el foco de ${slot}`).toBeDefined();
      }
    });

    it('cada ranura tiene a lo sumo una malla por material', () => {
      for (const [slot, obj] of high.parts) {
        const seen = new Set<Material>();
        obj.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          expect(m.userData.slotId).toBe(slot);
          expect(seen.has(m.material as Material), `${slot} repite material`).toBe(false);
          seen.add(m.material as Material);
        });
      }
    });

    it('apoya en el suelo y no tiene NaN', () => {
      const box = new Box3().setFromObject(high.root);
      expect(box.min.y).toBeGreaterThan(-0.01);
      expect(box.min.y).toBeLessThan(0.01);
      // Se cuenta y se compara una vez: un expect por coordenada (cientos de miles) tardaba
      // mas de 5 s con la maquina cargada y el test caia por timeout, no por la geometria.
      let notFinite = 0;
      high.root.traverse((o) => {
        const g = (o as Mesh).geometry;
        if (!(o as Mesh).isMesh || !g) return;
        const arr = (g.getAttribute('position') as BufferAttribute).array;
        for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) notFinite++;
      });
      expect(notFinite).toBe(0);
    });

    it('la caja envolvente coincide con la ficha (+-3 %)', () => {
      const all = boundsWithout(high.root, ['mirrors']);
      const width = boundsWithout(high.root, template.body === 'grader' ? ['mirrors', 'blade'] : ['mirrors']);
      const d = template.defaults.dims;
      const got = { length: all.max.x - all.min.x, height: all.max.y - all.min.y, width: width.max.z - width.min.z };
      expect(got.length / mm(d.lengthMm), `largo ${got.length.toFixed(3)}`).toBeCloseTo(1, 1);
      expect(Math.abs(got.length / mm(d.lengthMm) - 1), `largo ${got.length.toFixed(3)}`).toBeLessThan(0.03);
      expect(Math.abs(got.height / mm(d.heightMm) - 1), `alto ${got.height.toFixed(3)}`).toBeLessThan(0.03);
      expect(Math.abs(got.width / mm(d.widthMm) - 1), `ancho ${got.width.toFixed(3)}`).toBeLessThan(0.03);
    });
  });
}
