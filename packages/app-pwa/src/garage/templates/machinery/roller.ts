/**
 * roller.ts — Vibrocompactador de rodillo liso (clase 10 t), articulado.
 *
 * Rodillo vibratorio adelante en su bastidor, llantas de traccion atras, cabina ROPS
 * sobre el chasis trasero. wheelbaseMm = del centro del rodillo al eje trasero;
 * tireFront describe el rodillo (widthMm = ancho, diametro = rimIn * 25.4 + 2 * flanco).
 */
import type { Object3D } from 'three/webgpu';
import type { BuiltVehicle, VehicleTemplate } from '../../contracts';
import type { P2 } from '../common/geometry';
import { mm } from '../common/units';
import {
  addTo,
  addWheel,
  arc,
  box,
  cylY,
  cylZ,
  fenderArch,
  finishMachine,
  hydCylinder,
  plate,
  powerPack,
  rbox,
  rearLights,
  ropsCab,
  startMachine,
  tireRadiusM,
} from './machineryKit';

export const ROLLER: VehicleTemplate = {
  id: 'machinery-roller',
  family: 'machinery',
  body: 'roller',
  label: 'Vibrocompactador',
  defaults: {
    family: 'machinery',
    body: 'roller',
    dims: { lengthMm: 5230, widthMm: 2380, heightMm: 3120, wheelbaseMm: 2900, trackRearMm: 1700, groundClearanceMm: 420 },
    // Rodillo de 1 530 mm x 2 130 mm (ancho 2130, "rin" 0 y flanco de 765 mm).
    tireFront: { widthMm: 2130, aspectPct: 36, rimIn: 0 },
    tireRear: { widthMm: 587, aspectPct: 80, rimIn: 26 },
  },
  shapeParams: [],
  variants: {},
  build(spec, ctx): BuiltVehicle {
    const b = startMachine(spec, ctx, 'machinery-roller');
    const kit = ctx.materials;
    const paint = kit.paint(spec.paint);
    const dark = kit.metal('dark');
    const lo = ctx.lod === 'low';
    const wb = mm(spec.dims.wheelbaseMm);
    const tr = mm(spec.dims.trackRearMm ?? 1700);
    const W = mm(spec.dims.widthMm);
    const H = mm(spec.dims.heightMm);
    const drumW = mm(spec.tireFront.widthMm);
    const drumR = tireRadiusM(spec.tireFront);
    const rR = tireRadiusM(spec.tireRear);
    const tw = mm(spec.tireRear.widthMm);
    const xF = wb / 2;
    const xR = -wb / 2;

    // Rodillo con tapas y su bastidor (yugo) pintado.
    addTo(
      b,
      'drum',
      [cylZ(drumR, drumW, kit.metal('steel'), [xF, drumR, 0], lo ? 24 : 48), cylZ(drumR * 0.45, drumW + 0.04, dark, [xF, drumR, 0], lo ? 12 : 24)],
      [xF, drumR, 0],
    );
    const yoke: Object3D[] = [];
    for (const s of [1, -1]) {
      yoke.push(plate(ctx, [[xF - drumR - 0.15, drumR - 0.2], [xF + drumR + 0.2, drumR - 0.2], [xF + drumR + 0.25, drumR + 0.55], [xF - drumR - 0.15, drumR + 0.75]], 0.09, s * (drumW / 2 + 0.07), paint, 0.015));
    }
    // Travesanos del bastidor (adelante y atras, a la altura del eje del rodillo).
    for (const dx of [drumR + 0.12, -drumR - 0.08]) yoke.push(rbox(ctx, 0.22, 0.3, drumW + 0.25, 0.04, paint, [xF + dx, drumR + 0.35, 0]));
    // Raspadores delante y detras del rodillo.
    yoke.push(box(0.05, 0.08, drumW, dark, [xF + drumR + 0.05, drumR * 0.6, 0]));
    yoke.push(box(0.05, 0.08, drumW, dark, [xF - drumR - 0.05, drumR * 0.6, 0]));
    // Articulacion.
    yoke.push(rbox(ctx, 0.9, 0.45, 0.5, 0.04, dark, [0.25, drumR + 0.05, 0]));
    yoke.push(cylY(0.16, 0.6, kit.metal('steel'), [-0.1, drumR + 0.05, 0], 14));
    addTo(b, 'chassis_frame', yoke, [xF, drumR + 0.4, 0]);

    for (const s of [1, -1] as const) addWheel(b, s === 1 ? 'rl' : 'rr', spec.tireRear, [xR, rR, (s * tr) / 2]);
    const rear: Object3D[] = [rbox(ctx, 1.7, 0.5, tr - tw - 0.1, 0.04, dark, [xR + 0.1, rR + 0.05, 0]), cylZ(0.12, tr - tw, dark, [xR, rR, 0], 12)];
    for (const s of [1, -1]) rear.push(fenderArch(ctx, xR, rR, rR + 0.05, 0.05, tw + 0.1, (s * tr) / 2, paint, 0.2, Math.PI * 0.8));
    addTo(b, 'chassis_frame', rear);

    // Motor atras con capot y cabina adelante del eje trasero.
    const backX = xR - rR - 0.45;
    powerPack(b, { x0: backX, x1: xR + 0.45, y0: rR + 0.25, y1: rR + 1.15, z0: -W / 2 + 0.25, z1: W / 2 - 0.25, rounded: true, fuelTankAt: [xR + 0.7, rR + 0.35, -0.55], fuelTankSize: [0.45, 0.5, 0.4] });
    const tailProfile: P2[] = [[backX + 0.2, rR - 0.15], ...arc(backX + 0.2, rR + 0.4, 0.55, -Math.PI / 2, -Math.PI * 1.5, lo ? 6 : 10).map(([x, y]) => [backX + 0.2 + (x - backX - 0.2) * 0.35, y] as P2), [backX + 0.2, rR + 0.95]];
    addTo(b, 'counterweight', [plate(ctx, tailProfile, W - 0.6, 0, paint, 0.03)], [backX, rR + 0.4, 0]);
    rearLights(b, backX - 0.02, rR + 0.75, W / 2 - 0.45);
    ropsCab(b, { x0: xR + 0.45, x1: xR + 1.75, y0: rR + 0.3, y1: H, z0: -0.82, z1: 0.82, doorSide: 1 });

    // Cilindros de direccion en la articulacion.
    const cyl: Object3D[] = [];
    for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [-0.65, drumR + 0.1, s * 0.4], [0.55, drumR + 0.1, s * 0.4], 0.06));
    addTo(b, 'hydraulic_cylinders', cyl, [0, drumR + 0.1, 0.4]);

    return finishMachine(b);
  },
};
