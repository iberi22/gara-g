/**
 * dozer.ts — Bulldozer de orugas con hoja frontal y escarificador (clase 20 t).
 *
 * Medidas como la excavadora: wheelbaseMm = oruga sobre el suelo, trackFrontMm = trocha,
 * tireFront.widthMm = zapata, widthMm = ancho de la hoja (lo mas ancho de la maquina).
 */
import type { Object3D } from 'three/webgpu';
import type { BuiltVehicle, VehicleTemplate } from '../../contracts';
import type { P2 } from '../common/geometry';
import { mm } from '../common/units';
import {
  addTo,
  arc,
  box,
  cylZ,
  finishMachine,
  hydCylinder,
  plate,
  powerPack,
  rbox,
  rearLights,
  rod,
  ropsCab,
  startMachine,
  trackAssembly,
} from './machineryKit';

export const DOZER: VehicleTemplate = {
  id: 'machinery-dozer',
  family: 'machinery',
  body: 'dozer',
  label: 'Bulldozer',
  defaults: {
    family: 'machinery',
    body: 'dozer',
    dims: { lengthMm: 4850, widthMm: 3300, heightMm: 3280, wheelbaseMm: 2650, trackFrontMm: 1880, groundClearanceMm: 400 },
    tireFront: { widthMm: 560, aspectPct: 100, rimIn: 0 },
    tireRear: { widthMm: 560, aspectPct: 100, rimIn: 0 },
  },
  shapeParams: [],
  variants: { ripper: ['shank', 'none'] },
  build(spec, ctx): BuiltVehicle {
    const b = startMachine(spec, ctx, 'machinery-dozer');
    const kit = ctx.materials;
    const paint = kit.paint(spec.paint);
    const dark = kit.metal('dark');
    const lo = ctx.lod === 'low';
    const shoe = mm(spec.tireFront.widthMm || 560);
    const gauge = mm(spec.dims.trackFrontMm ?? 1880);
    const contact = mm(spec.dims.wheelbaseMm);
    const H = mm(spec.dims.heightMm);
    const W = mm(spec.dims.widthMm);
    const trackH = 0.88;
    const trackLen = contact + trackH * 0.85;

    for (const s of [1, -1] as const) {
      const t = trackAssembly(ctx, { length: trackLen, height: trackH, shoe, z: (s * gauge) / 2 });
      addTo(b, s === 1 ? 'track_left' : 'track_right', t.track, [0, trackH / 2, (s * gauge) / 2]);
      addTo(b, 'chassis_frame', t.frame);
      addTo(b, 'final_drive', t.drive, [-(trackLen / 2 - trackH / 2), trackH / 2, (s * gauge) / 2]);
    }
    const bodyHalf = gauge / 2 - shoe / 2 - 0.04;
    const deckY = trackH + 0.05;
    addTo(b, 'chassis_frame', [rbox(ctx, trackLen - 0.3, 0.5, bodyHalf * 2, 0.05, dark, [0, trackH * 0.7, 0]), box(trackLen - 0.2, 0.06, gauge + shoe, paint, [0, deckY, 0])], [0, trackH * 0.7, 0]);

    // Capot del motor adelante (mas angosto) y cabina atras.
    const front = trackLen / 2 - 0.05;
    powerPack(b, { x0: -0.15, x1: front, y0: deckY + 0.03, y1: deckY + 1.05, z0: -0.62, z1: 0.62, rounded: true, fuelTankAt: [-trackLen / 2 + 0.2, deckY + 0.45, 0], fuelTankSize: [0.35, 0.8, bodyHalf * 2] });
    // Rejilla del radiador al frente.
    addTo(b, 'engine_hood', [box(0.03, 0.75, 1.0, kit.plastic('black'), [front + 0.01, deckY + 0.55, 0])]);
    ropsCab(b, { x0: -trackLen / 2 + 0.4, x1: -0.15, y0: deckY + 0.03, y1: H, z0: -0.78, z1: 0.78, doorSide: 1 });
    rearLights(b, -trackLen / 2 + 0.02, deckY + 0.5, bodyHalf - 0.1);

    // Hoja: vertedera curva, cuchilla abajo, brazos de empuje a los bastidores.
    const bladeX = trackLen / 2 + 0.55;
    const bladeH = 1.3;
    const lip: P2[] = [
      [bladeX + 0.12, 0.02],
      ...arc(bladeX + 0.55, bladeH * 0.55, 0.6, Math.PI * 1.25, Math.PI * 0.75, lo ? 5 : 10),
      [bladeX + 0.2, bladeH],
      [bladeX + 0.05, bladeH],
      [bladeX - 0.12, bladeH * 0.5],
      [bladeX, 0.02],
    ];
    const blade: Object3D[] = [plate(ctx, lip, W, 0, paint, 0.025), box(0.05, 0.14, W, dark, [bladeX + 0.06, 0.07, 0])];
    for (const s of [1, -1]) {
      blade.push(box(0.2, bladeH * 0.9, 0.06, paint, [bladeX + 0.05, bladeH * 0.47, s * (W / 2 - 0.02)]));
      blade.push(rod([0.1, trackH * 0.45, s * (gauge / 2 + shoe / 2 + 0.06)], [bladeX - 0.1, 0.35, s * (gauge / 2 + shoe / 2 + 0.06)], 0.09, paint, 10));
    }
    addTo(b, 'blade', blade, [bladeX, bladeH / 2, 0]);

    const cyl: Object3D[] = [];
    for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [front - 0.35, deckY + 0.95, s * 0.7], [bladeX - 0.05, bladeH * 0.85, s * 0.7], 0.09));
    // Cilindro de inclinacion (tilt).
    cyl.push(...hydCylinder(ctx, [bladeX - 0.6, 0.85, gauge / 2], [bladeX - 0.08, bladeH * 0.75, gauge / 2 - 0.2], 0.07));

    // Escarificador trasero de un diente.
    if ((spec.variants?.ripper ?? 'shank') === 'shank') {
      const rx = -trackLen / 2 - 0.55;
      const ripper: Object3D[] = [
        box(0.25, 0.35, 1.2, paint, [rx, 1.1, 0]),
        plate(ctx, [[rx - 0.1, 1.15], [rx + 0.1, 1.15], [rx + 0.2, 0.25], [rx + 0.05, 0.02], [rx - 0.05, 0.2]], 0.12, 0, dark, 0.01),
      ];
      for (const s of [1, -1]) ripper.push(rod([-trackLen / 2 + 0.1, 0.65, s * 0.45], [rx + 0.05, 1.05, s * 0.45], 0.06, paint, 8));
      addTo(b, 'ripper', ripper, [rx, 0.8, 0]);
      for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [-trackLen / 2 + 0.1, 1.25, s * 0.3], [rx + 0.05, 1.25, s * 0.3], 0.07));
    }
    addTo(b, 'hydraulic_cylinders', cyl, [front, deckY + 0.6, 0.7]);
    addTo(b, 'chassis_frame', [cylZ(0.08, gauge + shoe + 0.2, kit.metal('steel'), [0.1, trackH * 0.45, 0], 10)]);

    return finishMachine(b);
  },
};
