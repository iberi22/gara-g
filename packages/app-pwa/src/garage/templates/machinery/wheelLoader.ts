/**
 * wheelLoader.ts — Cargador frontal de llantas, articulado (clase 18 t).
 *
 * Chasis delantero (brazos y balde) y trasero (cabina, motor, contrapeso) unidos por la
 * articulacion central en x = 0. Balde en el suelo, como se exhibe.
 */
import type { Object3D } from 'three/webgpu';
import type { BuiltVehicle, VehicleTemplate } from '../../contracts';
import type { P2 } from '../common/geometry';
import { mm } from '../common/units';
import {
  addTo,
  addWheel,
  beamProfile,
  box,
  groundedBucket,
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

export const WHEEL_LOADER: VehicleTemplate = {
  id: 'machinery-wheel-loader',
  family: 'machinery',
  body: 'wheel_loader',
  label: 'Cargador frontal',
  defaults: {
    family: 'machinery',
    body: 'wheel_loader',
    dims: { lengthMm: 7600, widthMm: 2950, heightMm: 3570, wheelbaseMm: 3300, trackFrontMm: 2200, trackRearMm: 2200, groundClearanceMm: 450 },
    tireFront: { widthMm: 597, aspectPct: 82, rimIn: 25 },
    tireRear: { widthMm: 597, aspectPct: 82, rimIn: 25 },
  },
  shapeParams: [],
  variants: {},
  build(spec, ctx): BuiltVehicle {
    const b = startMachine(spec, ctx, 'machinery-wheel-loader');
    const kit = ctx.materials;
    const paint = kit.paint(spec.paint);
    const dark = kit.metal('dark');
    const wb = mm(spec.dims.wheelbaseMm);
    const tf = mm(spec.dims.trackFrontMm ?? 2200);
    const tr = mm(spec.dims.trackRearMm ?? 2200);
    const W = mm(spec.dims.widthMm);
    const H = mm(spec.dims.heightMm);
    const r = tireRadiusM(spec.tireFront);
    const tw = mm(spec.tireFront.widthMm);
    const xF = wb / 2;
    const xR = -wb / 2;

    for (const s of [1, -1] as const) {
      addWheel(b, s === 1 ? 'fl' : 'fr', spec.tireFront, [xF, r, (s * tf) / 2]);
      addWheel(b, s === 1 ? 'rl' : 'rr', spec.tireRear, [xR, r, (s * tr) / 2]);
    }

    // Chasis delantero y trasero + articulacion + ejes.
    const frameY = r + 0.05;
    const halfIn = tf / 2 - tw / 2 - 0.08;
    const chassis: Object3D[] = [
      rbox(ctx, xF + 0.9, 0.55, halfIn * 2, 0.05, dark, [xF / 2 + 0.35, frameY, 0]),
      rbox(ctx, -xR + 1.2, 0.6, halfIn * 2, 0.05, dark, [xR / 2 - 0.5, frameY + 0.05, 0]),
      cylY(0.22, 0.7, kit.metal('steel'), [0, frameY, 0], 16),
      cylZ(0.13, tf - tw, dark, [xF, r, 0], 14),
      cylZ(0.13, tr - tw, dark, [xR, r, 0], 14),
      // Torre de los brazos (donde pivotan).
      ...[1, -1].map((s) => plate(ctx, [[0.25, frameY], [1.15, frameY], [0.9, frameY + 1.35], [0.5, frameY + 1.4]], 0.1, s * (halfIn - 0.05), paint, 0.015)),
    ];
    addTo(b, 'chassis_frame', chassis, [0, frameY, 0]);

    // Guardabarros sobre las cuatro llantas.
    const body: Object3D[] = [];
    for (const s of [1, -1]) {
      body.push(fenderArch(ctx, xF, r, r + 0.05, 0.05, tw + 0.1, (s * tf) / 2, paint, 0.35, Math.PI * 0.95));
      body.push(fenderArch(ctx, xR, r, r + 0.05, 0.05, tw + 0.1, (s * tr) / 2, paint, 0.1, Math.PI * 0.75));
    }
    addTo(b, 'chassis_frame', body);

    // Motor atras con contrapeso redondeado.
    const backX = xR - 1.75;
    powerPack(b, { x0: backX + 0.45, x1: xR + 0.55, y0: frameY + 0.3, y1: frameY + 1.45, z0: -0.82, z1: 0.82, rounded: true, fuelTankAt: [xR + 0.35, frameY + 0.4, 0], fuelTankSize: [0.6, 0.5, 1.4] });
    const cw = rbox(ctx, 0.6, 1.2, W * 0.78, 0.22, paint, [backX + 0.3, frameY + 0.35, 0]);
    addTo(b, 'counterweight', [cw, box(0.03, 0.4, W * 0.5, kit.plastic('black'), [backX + 0.02, frameY + 0.55, 0])], [backX + 0.2, frameY + 0.35, 0]);
    rearLights(b, backX + 0.05, frameY + 0.85, W * 0.33);

    // Cabina sobre el chasis trasero, junto a la articulacion.
    ropsCab(b, { x0: xR + 0.35, x1: 0.15, y0: frameY + 0.35, y1: H, z0: -0.82, z1: 0.82, doorSide: 1 });

    // Brazos de levante, varillaje en Z y balde.
    const pivot: P2 = [0.75, frameY + 1.3];
    const loaderBucket = groundedBucket(ctx, xF + 1.3, 1.15, W, 1, paint, 0.08);
    const pin = loaderBucket.pin;
    const knee: P2 = [xF + 0.35, 1.3];
    const arms: Object3D[] = [];
    for (const s of [1, -1]) arms.push(plate(ctx, beamProfile([pivot, knee, pin], [0.32, 0.4, 0.26]), 0.14, s * (halfIn - 0.05), paint, 0.02));
    arms.push(box(0.25, 0.3, halfIn * 2 - 0.2, paint, [knee[0], knee[1], 0]));
    // Palanca en Z (bellcrank) y barra de empuje.
    arms.push(plate(ctx, [[knee[0] - 0.25, knee[1] + 0.55], [knee[0] + 0.05, knee[1] + 0.6], [knee[0] + 0.3, knee[1] - 0.2], [knee[0] + 0.05, knee[1] - 0.25]], 0.16, 0, dark, 0.02));
    arms.push(plate(ctx, beamProfile([[knee[0] + 0.15, knee[1] - 0.15], [pin[0] + 0.15, pin[1] + 0.55]], [0.12, 0.12]), 0.12, 0, dark, 0.01));
    addTo(b, 'loader_arms', arms, [knee[0], knee[1], halfIn]);
    addTo(b, 'bucket', loaderBucket.parts, [pin[0] + 0.5, 0.5, 0]);

    // Cilindros: dos de levante y uno de volteo.
    const cyl: Object3D[] = [];
    for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [0.6, frameY + 0.2, s * (halfIn - 0.25)], [knee[0] - 0.2, knee[1] - 0.1, s * (halfIn - 0.25)], 0.1));
    cyl.push(...hydCylinder(ctx, [0.95, frameY + 0.95, 0], [knee[0] - 0.2, knee[1] + 0.5, 0], 0.11));
    // Cilindros de direccion en la articulacion.
    for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [-0.55, frameY, s * 0.42], [0.5, frameY, s * 0.42], 0.06));
    addTo(b, 'hydraulic_cylinders', cyl, [knee[0], knee[1], 0]);

    // Escalera de acceso a la cabina.
    const ladder: Object3D[] = [];
    for (const k of [0, 1, 2, 3]) ladder.push(box(0.35, 0.03, 0.18, kit.metal('aluminum'), [xR + 0.65, 0.45 + k * 0.3, W / 2 - 0.35]));
    addTo(b, 'chassis_frame', ladder);

    return finishMachine(b);
  },
};
