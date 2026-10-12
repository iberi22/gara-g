/**
 * debugTemplate.ts — Plantilla minima (bloque + 2 ruedas) para probar el motor y el
 * laboratorio antes de que existan las plantillas reales. No es para usuarios.
 */
import { Group } from 'three/webgpu';
import type { BuiltVehicle, VehicleSpec, VehicleTemplate } from '../../contracts';
import { countTriangles, mesh, part, roundedBox } from './geometry';
import { mm } from './units';
import { buildWheel } from './wheel';

export const DEBUG_TEMPLATE: VehicleTemplate = {
  id: 'debug-block',
  family: 'moto',
  body: 'naked',
  label: 'Bloque de prueba',
  defaults: {
    family: 'moto',
    body: 'naked',
    dims: { lengthMm: 2100, widthMm: 800, heightMm: 1100, wheelbaseMm: 1440 },
    tireFront: { widthMm: 120, aspectPct: 70, rimIn: 17 },
    tireRear: { widthMm: 180, aspectPct: 55, rimIn: 17 },
  },
  shapeParams: [],
  variants: {},
  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const root = new Group();
    root.name = 'vehicle:debug-block';
    const parts = new Map();
    const wb = mm(spec.dims.wheelbaseMm);
    const front = buildWheel({ tire: spec.tireFront, family: 'moto', paint: spec.paint }, ctx);
    const rear = buildWheel({ tire: spec.tireRear, family: 'moto', paint: spec.paint, rear: true }, ctx);
    for (const [w, x, tag] of [
      [front, wb / 2, 'front'],
      [rear, -wb / 2, 'rear'],
    ] as const) {
      w.tire.position.set(x, w.radius, 0);
      w.rim.position.set(x, w.radius, 0);
      w.brake.position.set(x, w.radius, 0);
      for (const [slot, obj] of [
        [`tire_${tag}`, w.tire],
        [`rim_${tag}`, w.rim],
        [`brake_${tag}`, w.brake],
      ] as const) {
        const g = part(slot, obj);
        root.add(g);
        parts.set(slot, g);
      }
    }
    const block = part('engine', mesh(roundedBox(wb * 0.6, 0.35, 0.3), ctx.materials.paint(spec.paint), [0, 0.55, 0]));
    root.add(block);
    parts.set('engine', block);
    return {
      root,
      parts,
      focusPoints: { engine: [0, 0.55, 0], tire_front: [wb / 2, front.radius, 0], tire_rear: [-wb / 2, rear.radius, 0] },
      triangles: countTriangles(root),
    };
  },
};
