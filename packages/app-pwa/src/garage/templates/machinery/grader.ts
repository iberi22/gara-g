/**
 * grader.ts — Motoniveladora (clase 14 t): eje delantero, cuello largo, circulo con
 * vertedera al centro, cabina sobre el tandem trasero y motor atras.
 *
 * wheelbaseMm = del eje delantero al centro del tandem; los dos ejes del tandem quedan a
 * +-TANDEM/2 de ese centro.
 */
import type { Object3D } from 'three/webgpu';
import type { BuiltVehicle, VehicleTemplate } from '../../contracts';
import type { P2 } from '../common/geometry';
import { mm } from '../common/units';
import {
  addTo,
  addWheel,
  arc,
  beamProfile,
  box,
  cylY,
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
  tireRadiusM,
} from './machineryKit';

const TANDEM = 1.52;

export const GRADER: VehicleTemplate = {
  id: 'machinery-grader',
  family: 'machinery',
  body: 'grader',
  label: 'Motoniveladora',
  defaults: {
    family: 'machinery',
    body: 'grader',
    dims: { lengthMm: 8500, widthMm: 2500, heightMm: 3480, wheelbaseMm: 6100, trackFrontMm: 2080, trackRearMm: 2080, groundClearanceMm: 430 },
    tireFront: { widthMm: 375, aspectPct: 97, rimIn: 24 },
    tireRear: { widthMm: 375, aspectPct: 97, rimIn: 24 },
  },
  shapeParams: [{ id: 'bladeAngle', label: 'Angulo de la vertedera', default: 0.5 }],
  variants: {},
  build(spec, ctx): BuiltVehicle {
    const b = startMachine(spec, ctx, 'machinery-grader');
    const kit = ctx.materials;
    const paint = kit.paint(spec.paint);
    const dark = kit.metal('dark');
    const wb = mm(spec.dims.wheelbaseMm);
    const tf = mm(spec.dims.trackFrontMm ?? 2080);
    const tr = mm(spec.dims.trackRearMm ?? 2080);
    const W = mm(spec.dims.widthMm);
    const H = mm(spec.dims.heightMm);
    const r = tireRadiusM(spec.tireFront);
    const tw = mm(spec.tireFront.widthMm);
    const xF = wb / 2;
    const xR = -wb / 2;
    const rearAxles = [xR + TANDEM / 2, xR - TANDEM / 2];

    for (const s of [1, -1] as const) {
      addWheel(b, s === 1 ? 'fl' : 'fr', spec.tireFront, [xF, r, (s * tf) / 2]);
      for (const ax of rearAxles) addWheel(b, s === 1 ? 'rl' : 'rr', spec.tireRear, [ax, r, (s * tr) / 2]);
    }

    // Cuello (viga arqueada) del eje delantero hasta la cabina.
    const neckZ = 0;
    const neck: P2[] = [[xF + 0.35, r + 0.35], [xF - 0.2, r + 0.75], [xF - 2.0, r + 1.0], [xR + 1.55, r + 0.95], [xR + 1.0, r + 0.55]];
    const chassis: Object3D[] = [
      plate(ctx, beamProfile(neck, [0.4, 0.5, 0.48, 0.5, 0.6]), 0.42, neckZ, paint, 0.03),
      // Eje delantero (viga oscilante) y defensa con contrapeso.
      cylZ(0.11, tf - tw, dark, [xF, r, 0], 12),
      box(0.35, 0.55, 0.5, dark, [xF, r + 0.2, 0]),
      rbox(ctx, 0.4, 0.55, W * 0.7, 0.04, paint, [xF + 0.6, r + 0.15, 0]),
    ];
    // Bastidor trasero y cajas del tandem (son los mandos finales de la motoniveladora).
    const rearX0 = xR + 1.2;
    const backX = xR - 1.6;
    chassis.push(rbox(ctx, rearX0 - backX, 0.45, tr - tw - 0.15, 0.04, dark, [(rearX0 + backX) / 2, r + 0.35, 0]));
    addTo(b, 'chassis_frame', chassis, [0, r + 0.9, 0]);
    const tandem: Object3D[] = [];
    for (const s of [1, -1]) tandem.push(rbox(ctx, TANDEM + 0.35, 0.45, 0.2, 0.05, paint, [xR, r, s * (tr / 2 - tw / 2 - 0.15)]));
    addTo(b, 'final_drive', tandem, [xR, r, tr / 2 - tw / 2 - 0.15]);

    // Motor atras y cabina sobre el tandem delantero.
    powerPack(b, { x0: backX + 0.05, x1: xR + 0.35, y0: r + 0.55, y1: r + 1.55, z0: -0.72, z1: 0.72, rounded: true, fuelTankAt: [xR + 0.5, r + 0.85, 0.75], fuelTankSize: [0.5, 0.5, 0.3] });
    rearLights(b, backX + 0.02, r + 1.05, 0.55);
    ropsCab(b, { x0: xR + 0.35, x1: xR + 1.85, y0: r + 0.6, y1: H, z0: -0.8, z1: 0.8, doorSide: 1 });

    // Barra de tiro, circulo y vertedera.
    const angle = 0.35 + ((spec.shape?.bladeAngle ?? 0.5) - 0.5) * 0.4;
    const circleX = 0.1;
    const circleY = 0.55;
    const blade: Object3D[] = [];
    const drawbar = [xF - 0.3, r + 0.5, 0] as [number, number, number];
    for (const s of [1, -1]) blade.push(rod(drawbar, [circleX + 0.3, circleY + 0.05, s * 0.55], 0.07, dark, 8));
    blade.push(cylY(0.85, 0.08, dark, [circleX, circleY + 0.08, 0], ctx.lod === 'low' ? 16 : 32));
    const bladeW = Math.min(3.66, W * 1.35);
    const mold: P2[] = [[0.05, 0], ...arc(0.42, 0.33, 0.42, Math.PI * 1.25, Math.PI * 0.72, ctx.lod === 'low' ? 5 : 9), [-0.05, 0.62], [-0.12, 0.3]];
    const mb = plate(ctx, mold, bladeW, 0, paint, 0.02);
    mb.rotation.y = angle;
    mb.position.set(circleX - 0.3, 0.02, 0);
    blade.push(mb);
    const edge = box(0.05, 0.1, bladeW, dark, [circleX - 0.25, 0.05, 0]);
    edge.rotation.y = angle;
    blade.push(edge);
    addTo(b, 'blade', blade, [circleX, 0.4, 0]);

    // Cilindros de levante de la vertedera desde el cuello.
    const cyl: Object3D[] = [];
    for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [0.6, r + 1.15, s * 0.32], [circleX + 0.35, circleY + 0.15, s * 0.75], 0.07));
    cyl.push(...hydCylinder(ctx, [-0.6, r + 0.95, 0.25], [circleX - 0.3, circleY + 0.2, 0.85], 0.06));
    addTo(b, 'hydraulic_cylinders', cyl, [0.4, r + 0.7, 0.5]);

    return finishMachine(b);
  },
};
