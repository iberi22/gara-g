/**
 * backhoe.ts — Retroexcavadora (cargador adelante, retro atras; clase 8 t).
 *
 * Pose de transporte: cargador con el balde en el suelo, retro recogida y estabilizadores
 * apoyados. Llantas delanteras chicas y traseras grandes, como en la ficha de la clase.
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
  bucket,
  groundedBucket,
  cylZ,
  fenderArch,
  finishMachine,
  hydCylinder,
  plate,
  powerPack,
  rbox,
  rearLights,
  rod,
  ropsCab,
  startMachine,
  tireRadiusM,
} from './machineryKit';

export const BACKHOE: VehicleTemplate = {
  id: 'machinery-backhoe',
  family: 'machinery',
  body: 'backhoe',
  label: 'Retroexcavadora',
  defaults: {
    family: 'machinery',
    body: 'backhoe',
    dims: { lengthMm: 6600, widthMm: 2350, heightMm: 3680, wheelbaseMm: 2200, trackFrontMm: 1840, trackRearMm: 1720, groundClearanceMm: 380 },
    tireFront: { widthMm: 318, aspectPct: 80, rimIn: 18 },
    tireRear: { widthMm: 430, aspectPct: 95, rimIn: 28 },
  },
  shapeParams: [],
  variants: {},
  build(spec, ctx): BuiltVehicle {
    const b = startMachine(spec, ctx, 'machinery-backhoe');
    const kit = ctx.materials;
    const paint = kit.paint(spec.paint);
    const dark = kit.metal('dark');
    const wb = mm(spec.dims.wheelbaseMm);
    const tf = mm(spec.dims.trackFrontMm ?? 1840);
    const tr = mm(spec.dims.trackRearMm ?? 1720);
    const W = mm(spec.dims.widthMm);
    const rF = tireRadiusM(spec.tireFront);
    const rR = tireRadiusM(spec.tireRear);
    const xF = wb / 2;
    const xR = -wb / 2;

    for (const s of [1, -1] as const) {
      addWheel(b, s === 1 ? 'fl' : 'fr', spec.tireFront, [xF, rF, (s * tf) / 2]);
      addWheel(b, s === 1 ? 'rl' : 'rr', spec.tireRear, [xR, rR, (s * tr) / 2]);
    }

    // Chasis: viga central entre ejes, ejes y guardabarros traseros.
    const frameY = 0.75;
    const chassis: Object3D[] = [
      rbox(ctx, wb + 1.6, 0.42, 0.8, 0.05, paint, [0.1, frameY, 0]),
      cylZ(0.09, tf - 0.2, dark, [xF, rF, 0], 12),
      cylZ(0.11, tr - 0.35, dark, [xR, rR, 0], 12),
    ];
    for (const s of [1, -1]) chassis.push(fenderArch(ctx, xR, rR, rR + 0.06, 0.06, mm(spec.tireRear.widthMm) + 0.08, (s * tr) / 2, paint, 0.05, Math.PI * 0.62));
    addTo(b, 'chassis_frame', chassis, [0, frameY, 0]);

    // Capot delantero (motor adelante, sobre el eje).
    powerPack(b, { x0: 0.45, x1: xF + 0.95, y0: frameY + 0.2, y1: frameY + 1.05, z0: -0.48, z1: 0.48, rounded: true, fuelTankAt: [-0.2, frameY + 0.1, -W / 2 + 0.35], fuelTankSize: [0.9, 0.45, 0.4] });
    rearLights(b, xR - 1.0, frameY + 0.85, W / 2 - 0.25);

    // Cabina sobre el eje trasero.
    ropsCab(b, { x0: xR - 0.55, x1: 0.48, y0: rR + 0.35, y1: mm(spec.dims.heightMm) - 0.62, z0: -0.95, z1: 0.95, doorSide: 1 });

    // --- Cargador frontal ---------------------------------------------------
    const armZ = 0.68;
    const armPivot: P2 = [0.25, rR * 2 + 0.6];
    const loaderBucket = groundedBucket(ctx, xF + 1.35, 0.82, W, 1, paint, 0.05);
    const loaderPin = loaderBucket.pin;
    const elbow: P2 = [xF + 0.45, 1.55];
    const arms: Object3D[] = [];
    for (const s of [1, -1]) arms.push(plate(ctx, beamProfile([armPivot, elbow, loaderPin], [0.26, 0.3, 0.2]), 0.12, s * armZ, paint, 0.02));
    arms.push(cylZ(0.06, armZ * 2 + 0.2, kit.metal('steel'), [loaderPin[0], loaderPin[1], 0], 10));
    addTo(b, 'loader_arms', arms, [elbow[0], elbow[1], armZ]);
    addTo(b, 'bucket', loaderBucket.parts, [loaderPin[0] + 0.4, 0.4, 0]);

    // --- Retro (trasera) ----------------------------------------------------
    const king: P2 = [xR - 1.0, frameY + 0.35];
    const knee: P2 = [xR - 1.45, 2.65];
    const tip: P2 = [xR - 1.05, mm(spec.dims.heightMm) - 0.25];
    const backPin: P2 = [xR - 1.6, 1.25];
    const boom = plate(ctx, beamProfile([king, knee, tip], [0.36, 0.42, 0.3]), 0.32, 0, paint, 0.025);
    addTo(b, 'swing', [rbox(ctx, 0.45, 0.7, 0.7, 0.05, dark, [king[0] + 0.1, king[1], 0])], [king[0], king[1], 0]);
    addTo(b, 'boom', [boom], [knee[0], knee[1], 0]);
    const armTail: P2 = [tip[0] + 0.2, tip[1] + 0.12];
    addTo(b, 'arm', [plate(ctx, beamProfile([armTail, tip, backPin], [0.3, 0.32, 0.22]), 0.26, 0, paint, 0.02)], [tip[0], (tip[1] + backPin[1]) / 2, 0]);
    const rear = bucket(ctx, backPin, 0.55, 0.6, 1, paint, -0.6);
    addTo(b, 'bucket', rear);

    // Estabilizadores a los lados de la retro.
    const stab: Object3D[] = [];
    for (const s of [1, -1]) {
      const top: [number, number, number] = [xR - 0.85, frameY + 0.5, s * 0.55];
      const foot: [number, number, number] = [xR - 0.95, 0.12, s * (W / 2 - 0.2)];
      stab.push(rod(top, foot, 0.08, paint, 8));
      stab.push(box(0.4, 0.06, 0.35, dark, [foot[0], 0.03, foot[2]]));
    }
    addTo(b, 'chassis_frame', stab);

    // Cilindros: levante del cargador, pluma y brazo de la retro.
    const cyl: Object3D[] = [];
    for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [0.55, frameY + 0.1, s * (armZ - 0.12)], [elbow[0] - 0.1, elbow[1] - 0.15, s * (armZ - 0.12)], 0.07));
    cyl.push(...hydCylinder(ctx, [king[0] + 0.15, king[1] + 0.3, 0.22], [knee[0] + 0.15, knee[1] - 0.3, 0.22], 0.07));
    cyl.push(...hydCylinder(ctx, [knee[0] + 0.25, knee[1] + 0.1, -0.22], [armTail[0], armTail[1], -0.22], 0.065));
    addTo(b, 'hydraulic_cylinders', cyl, [elbow[0], elbow[1], armZ]);

    return finishMachine(b);
  },
};
