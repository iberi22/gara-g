/**
 * car.test.ts — Suite de pruebas de vitest para las plantillas de carros y pesados.
 *
 * Verifica para cada plantilla:
 *   1. Construccion con defaults (LOD high y low).
 *   2. Construccion con shapeParams en 0 y en 1.
 *   3. Presencia de TODAS las ranuras requeridas de su familia (requiredSlots).
 *   4. Estructura de nombres part:<slot> en el arbol de three.
 *   5. Dimensiones de la caja envolvente (bbox) dentro de ±3 % de la ficha tecnica (ancho sin espejos).
 *   6. Suelo en y ≈ 0 (minY entre -5 mm y +5 mm, llantas apoyadas en el piso).
 *   7. Centros de rueda exactos en ±entre_ejes/2 y ±via/2 (±5 mm).
 *   8. Presupuesto de triangulos respetado (high <= 90k, low <= 35k).
 *   9. Ausencia total de valores NaN o Infinity en las geometrias.
 */
import { describe, expect, it } from 'vitest';
import { Box3, Mesh, Vector3, type BufferAttribute } from 'three/webgpu';
import { RENDER_BUDGET, type VehicleSpec } from '../../contracts';
import { requiredSlots } from '../../parts';
import { createMaterialKit } from '../common/materials';
import { mm } from '../common/units';
import { MOCK_SNAPSHOT } from '../../mock';
import { CAR_TEMPLATES, PICKUP, SEDAN } from './index';

describe('Plantillas parametricas de carros y pesados (car & heavy)', () => {
  const kit = createMaterialKit();

  for (const template of CAR_TEMPLATES) {
    describe(`Plantilla: ${template.id} (${template.label})`, () => {
      const defaultSpec: VehicleSpec = {
        ...template.defaults,
        paint: { baseColor: '#3a7bd5', finish: 'metallic' },
        shape: Object.fromEntries(template.shapeParams.map((p) => [p.id, p.default])),
      };

      it('construye con defaults en LOD high dentro de presupuesto', () => {
        const built = template.build(defaultSpec, { materials: kit, lod: 'high' });
        expect(built.triangles).toBeGreaterThan(5000);
        expect(built.triangles).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesHigh);
      });

      it('construye en LOD low reduciendo triangulos y dentro de presupuesto low', () => {
        const builtHigh = template.build(defaultSpec, { materials: kit, lod: 'high' });
        const builtLow = template.build(defaultSpec, { materials: kit, lod: 'low' });
        expect(builtLow.triangles).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesLow);
        expect(builtLow.triangles).toBeLessThan(builtHigh.triangles);
      });

      it('construye con shapeParams extremos (0 y 1) sin errores', () => {
        const shape0 = Object.fromEntries(template.shapeParams.map((p) => [p.id, 0.0]));
        const shape1 = Object.fromEntries(template.shapeParams.map((p) => [p.id, 1.0]));

        const built0 = template.build({ ...defaultSpec, shape: shape0 }, { materials: kit, lod: 'high' });
        const built1 = template.build({ ...defaultSpec, shape: shape1 }, { materials: kit, lod: 'high' });

        expect(built0.triangles).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesHigh);
        expect(built1.triangles).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesHigh);
      });

      it('contiene TODAS las ranuras requeridas de su familia', () => {
        const built = template.build(defaultSpec, { materials: kit, lod: 'high' });
        const req = requiredSlots(template.family);

        for (const slotId of req) {
          expect(built.parts.has(slotId), `Falta la ranura requerida: ${slotId}`).toBe(true);
          const foundInTree = built.root.getObjectByName(`part:${slotId}`);
          expect(foundInTree, `El arbol no contiene part:${slotId}`).toBeDefined();
        }
      });
      it('cumple dimensiones del bbox dentro de ±3 % (largo, alto y ancho sin espejos)', () => {
        const built = template.build(defaultSpec, { materials: kit, lod: 'high' });
        built.root.updateMatrixWorld(true);
        const box = new Box3();
        built.root.traverse((obj) => {
          if ((obj as Mesh).isMesh) {
            let p = obj.parent;
            let isMirror = false;
            while (p && p !== built.root) {
              if (p.name === 'part:mirrors') {
                isMirror = true;
                break;
              }
              p = p.parent;
            }
            if (!isMirror) {
              box.expandByObject(obj);
            }
          }
        });

        const size = box.getSize(new Vector3());

        const lengthMm = size.x * 1000;
        const heightMm = size.y * 1000;
        const widthMm = size.z * 1000;

        const targetL = template.defaults.dims.lengthMm;
        const targetH = template.defaults.dims.heightMm;
        const targetW = template.defaults.dims.widthMm;

        const diffL = Math.abs(lengthMm - targetL) / targetL;
        const diffH = Math.abs(heightMm - targetH) / targetH;
        const diffW = Math.abs(widthMm - targetW) / targetW;

        expect(
          diffL,
          `Largo fuera de rango: real ${lengthMm.toFixed(1)} mm vs objetivo ${targetL} mm (error ${(diffL * 100).toFixed(2)}%)`,
        ).toBeLessThanOrEqual(0.03);

        expect(
          diffH,
          `Alto fuera de rango: real ${heightMm.toFixed(1)} mm vs objetivo ${targetH} mm (error ${(diffH * 100).toFixed(2)}%)`,
        ).toBeLessThanOrEqual(0.03);

        expect(
          diffW,
          `Ancho fuera de rango: real ${widthMm.toFixed(1)} mm vs objetivo ${targetW} mm (error ${(diffW * 100).toFixed(2)}%)`,
        ).toBeLessThanOrEqual(0.03);
      });

      it('mantiene el suelo en y ≈ 0 (minY entre -5 mm y +5 mm)', () => {
        const built = template.build(defaultSpec, { materials: kit, lod: 'high' });
        const box = new Box3().setFromObject(built.root);
        expect(Math.abs(box.min.y)).toBeLessThanOrEqual(0.005);
      });

      it('ubica los centros de las ruedas en ±entre_ejes/2 y ±via/2 (±5 mm)', () => {
        const built = template.build(defaultSpec, { materials: kit, lod: 'high' });
        const dims = template.defaults.dims;
        const wb = mm(dims.wheelbaseMm);
        const tf = mm(dims.trackFrontMm ?? Math.round(dims.widthMm * 0.86));
        const tr = mm(dims.trackRearMm ?? Math.round(dims.widthMm * 0.86));

        const fl = built.focusPoints.tire_fl;
        const fr = built.focusPoints.tire_fr;
        const rl = built.focusPoints.tire_rl;
        const rr = built.focusPoints.tire_rr;

        expect(fl).toBeDefined();
        expect(fr).toBeDefined();
        expect(rl).toBeDefined();
        expect(rr).toBeDefined();

        expect(Math.abs(fl[0] - wb / 2)).toBeLessThanOrEqual(0.005);
        expect(Math.abs(fl[2] - tf / 2)).toBeLessThanOrEqual(0.005);

        expect(Math.abs(fr[0] - wb / 2)).toBeLessThanOrEqual(0.005);
        expect(Math.abs(fr[2] - (-tf / 2))).toBeLessThanOrEqual(0.005);

        expect(Math.abs(rl[0] - (-wb / 2))).toBeLessThanOrEqual(0.005);
        expect(Math.abs(rl[2] - tr / 2)).toBeLessThanOrEqual(0.005);

        expect(Math.abs(rr[0] - (-wb / 2))).toBeLessThanOrEqual(0.005);
        expect(Math.abs(rr[2] - (-tr / 2))).toBeLessThanOrEqual(0.005);
      });

      it('no contiene valores NaN ni Infinity en ninguna posicion de vertice', () => {
        const built = template.build(defaultSpec, { materials: kit, lod: 'high' });
        let hasNaN = false;
        let hasInf = false;
        let invalidMesh = '';

        built.root.traverse((obj) => {
          if ((obj as Mesh).isMesh) {
            const geo = (obj as Mesh).geometry;
            const pos = geo.getAttribute('position') as BufferAttribute | undefined;
            if (pos) {
              const arr = pos.array;
              for (let i = 0; i < arr.length; i++) {
                const val = arr[i];
                if (Number.isNaN(val)) {
                  hasNaN = true;
                  invalidMesh = obj.name || 'unnamed';
                  break;
                }
                if (!Number.isFinite(val)) {
                  hasInf = true;
                  invalidMesh = obj.name || 'unnamed';
                  break;
                }
              }
            }
          }
        });

        expect(hasNaN, `NaN encontrado en ${invalidMesh}`).toBe(false);
        expect(hasInf, `Infinity encontrado en ${invalidMesh}`).toBe(false);
      });
    });
  }

  describe('Medidas de la tabla real del mock (src/garage/mock.ts: Corolla y Hilux)', () => {
    const corolla = MOCK_SNAPSHOT.vehicles.find((v) => v.id === 'mock-car-1')!;
    const hilux = MOCK_SNAPSHOT.vehicles.find((v) => v.id === 'mock-car-2')!;

    it('cumple medidas ±3 % para Toyota Corolla (Sedán)', () => {
      const built = SEDAN.build(corolla.spec, { materials: kit, lod: 'high' });
      built.root.updateMatrixWorld(true);
      const box = new Box3();
      built.root.traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          let p = obj.parent;
          let isMirror = false;
          while (p && p !== built.root) {
            if (p.name === 'part:mirrors') {
              isMirror = true;
              break;
            }
            p = p.parent;
          }
          if (!isMirror) box.expandByObject(obj);
        }
      });
      const size = box.getSize(new Vector3());
      const lengthMm = size.x * 1000;
      const heightMm = size.y * 1000;
      const widthMm = size.z * 1000;

      const targetL = corolla.spec.dims.lengthMm;
      const targetH = corolla.spec.dims.heightMm;
      const targetW = corolla.spec.dims.widthMm;

      const diffL = Math.abs(lengthMm - targetL) / targetL;
      const diffH = Math.abs(heightMm - targetH) / targetH;
      const diffW = Math.abs(widthMm - targetW) / targetW;

      expect(diffL, `Corolla Largo: real ${lengthMm.toFixed(1)} vs objetivo ${targetL}`).toBeLessThanOrEqual(0.03);
      expect(diffH, `Corolla Alto: real ${heightMm.toFixed(1)} vs objetivo ${targetH}`).toBeLessThanOrEqual(0.03);
      expect(diffW, `Corolla Ancho: real ${widthMm.toFixed(1)} vs objetivo ${targetW}`).toBeLessThanOrEqual(0.03);
    });

    it('cumple medidas ±3 % para Toyota Hilux (Pickup)', () => {
      const built = PICKUP.build(hilux.spec, { materials: kit, lod: 'high' });
      built.root.updateMatrixWorld(true);
      const box = new Box3();
      built.root.traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          let p = obj.parent;
          let isMirror = false;
          while (p && p !== built.root) {
            if (p.name === 'part:mirrors') {
              isMirror = true;
              break;
            }
            p = p.parent;
          }
          if (!isMirror) box.expandByObject(obj);
        }
      });
      const size = box.getSize(new Vector3());
      const lengthMm = size.x * 1000;
      const heightMm = size.y * 1000;
      const widthMm = size.z * 1000;

      const targetL = hilux.spec.dims.lengthMm;
      const targetH = hilux.spec.dims.heightMm;
      const targetW = hilux.spec.dims.widthMm;

      const diffL = Math.abs(lengthMm - targetL) / targetL;
      const diffH = Math.abs(heightMm - targetH) / targetH;
      const diffW = Math.abs(widthMm - targetW) / targetW;

      expect(diffL, `Hilux Largo: real ${lengthMm.toFixed(1)} vs objetivo ${targetL}`).toBeLessThanOrEqual(0.03);
      expect(diffH, `Hilux Alto: real ${heightMm.toFixed(1)} vs objetivo ${targetH}`).toBeLessThanOrEqual(0.03);
      expect(diffW, `Hilux Ancho: real ${widthMm.toFixed(1)} vs objetivo ${targetW}`).toBeLessThanOrEqual(0.03);
    });
  });
});
