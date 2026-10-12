/**
 * hatchback.ts — Plantilla parametrica de Hatchback compacto.
 *
 * Silueta compacta y agil de dos volumenes construida con bodyKit:
 *   - Voladizo trasero corto, luneta casi vertical y cola alta.
 *   - Invernadero con vidrio oscuro tintado, techo y pilares pintados encima.
 *   - Porton posterior (trunk) tipo liftback, 4 puertas laterales, opticas integradas.
 */
import { Group } from 'three/webgpu';
import type { BuiltVehicle, VehicleSpec, VehicleTemplate } from '../../contracts';
import { countTriangles, part } from '../common/geometry';
import { mm } from '../common/units';
import { buildGreenhouse, buildLowerBody, hatchbackProfile } from './bodyKit';
import {
  buildBumpers,
  buildDoors,
  buildHood,
  buildLighting,
  buildMirrors,
  buildTrunk,
  type ExteriorBounds,
} from './carBodyHelper';
import { buildCarMechanicals } from './carMechanicals';
import { buildCarWheels } from './carWheelHelper';

export const HATCHBACK: VehicleTemplate = {
  id: 'car-hatchback',
  family: 'car',
  body: 'hatchback',
  label: 'Hatchback',
  defaults: {
    family: 'car',
    body: 'hatchback',
    dims: {
      lengthMm: 4100,
      widthMm: 1740,
      heightMm: 1480,
      wheelbaseMm: 2550,
      trackFrontMm: 1500,
      trackRearMm: 1500,
      groundClearanceMm: 150,
    },
    tireFront: { widthMm: 185, aspectPct: 65, rimIn: 15 },
    tireRear: { widthMm: 185, aspectPct: 65, rimIn: 15 },
  },
  shapeParams: [
    { id: 'roofSlope', label: 'Caída del techo', default: 0.5, hint: 'Caída del portón trasero' },
    { id: 'hoodLength', label: 'Largo del capó', default: 0.5, hint: 'Largo del vano motor' },
    { id: 'beltLine', label: 'Línea de cintura', default: 0.5, hint: 'Línea de cintura lateral' },
    { id: 'rideHeight', label: 'Altura de marcha', default: 0.5, hint: 'Despeje al suelo' },
    { id: 'bumperBulk', label: 'Volumen de bómperes', default: 0.5, hint: 'Volumen de bómperes' },
  ],
  variants: {
    rim_fl: ['spokes', 'split', 'mesh'],
    rim_fr: ['spokes', 'split', 'mesh'],
    rim_rl: ['spokes', 'split', 'mesh'],
    rim_rr: ['spokes', 'split', 'mesh'],
  },
  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const root = new Group();
    root.name = 'vehicle:car-hatchback';
    const parts = new Map();
    const focusPoints: Record<string, [number, number, number]> = {};

    // 1. Ruedas
    const wheels = buildCarWheels(spec, ctx);
    for (const [id, grp] of wheels.parts) {
      root.add(grp);
      parts.set(id, grp);
    }
    Object.assign(focusPoints, wheels.focusPoints);

    // Dimensiones y perfil
    const L = mm(spec.dims.lengthMm);
    const H = mm(spec.dims.heightMm);
    const W = mm(spec.dims.widthMm);
    const p = hatchbackProfile(
      {
        length: L,
        height: H,
        width: W,
        wheelbase: wheels.wb,
        wheelRF: wheels.rFront,
        wheelRR: wheels.rRear,
        clearance: mm(spec.dims.groundClearanceMm ?? 150),
      },
      spec.shape ?? {},
    );

    const bounds: ExteriorBounds = {
      xFront: p.xFront,
      xRear: p.xRear,
      totalLength: L,
      totalHeight: H,
      totalWidth: W,
      halfW: p.halfWidth,
      wb: wheels.wb,
      tf: wheels.tf,
      tr: wheels.tr,
      rFront: wheels.rFront,
      rRear: wheels.rRear,
      groundY: p.rockerY,
      hoodY: p.hoodY,
      roofY: p.roofY,
      beltY: p.beltY,
      cowlX: p.cowlX,
      roofStartX: p.roofFrontX,
      roofEndX: p.roofRearX,
      trunkX: p.backlightX,
    };

    // 2. Carroceria baja e invernadero (bodyKit)
    const lowerBody = buildLowerBody(p, ctx, spec.paint);
    const gh = buildGreenhouse(p, ctx, spec.paint);
    lowerBody.add(gh.roof);
    const gBody = part('body', lowerBody);
    const gGlass = part('glass', gh.glass);
    root.add(gBody, gGlass);
    parts.set('body', gBody);
    parts.set('glass', gGlass);
    focusPoints.body = [0, (p.rockerY + H) / 2, 0];
    focusPoints.glass = [(p.cowlX + p.roofFrontX) / 2, (p.beltY + p.roofY) / 2, 0];

    // 3. Mecanica interna y chasis
    const mech = buildCarMechanicals(spec, ctx, {
      wb: wheels.wb,
      trackFront: wheels.tf,
      trackRear: wheels.tr,
      rFront: wheels.rFront,
      rRear: wheels.rRear,
      xFront: p.xFront,
      xRear: p.xRear,
      hoodY: p.hoodY,
      groundY: p.rockerY,
    });
    for (const [id, grp] of mech.parts) {
      root.add(grp);
      parts.set(id, grp);
    }
    Object.assign(focusPoints, mech.focusPoints);

    // 4. Luces (farolas y stops)
    const lighting = buildLighting(spec, ctx, bounds);
    root.add(lighting.headlight, lighting.taillight);
    parts.set('headlight', lighting.headlight);
    parts.set('taillight', lighting.taillight);
    focusPoints.headlight = lighting.fpHead;
    focusPoints.taillight = lighting.fpTail;

    // 5. Espejos retrovisores
    const mir = buildMirrors(spec, ctx, bounds);
    root.add(mir.mirrors);
    parts.set('mirrors', mir.mirrors);
    focusPoints.mirrors = mir.fp;

    // 6. Puertas (4 puertas)
    const doorBuild = buildDoors(spec, ctx, bounds, { fourDoors: true });
    for (const [id, grp] of doorBuild.doors) {
      root.add(grp);
      parts.set(id, grp);
    }
    Object.assign(focusPoints, doorBuild.fps);

    // 7. Capo
    const hoodBuild = buildHood(spec, ctx, bounds);
    root.add(hoodBuild.hood);
    parts.set('hood', hoodBuild.hood);
    focusPoints.hood = hoodBuild.fp;

    // 8. Bomperes
    const bumperBuild = buildBumpers(spec, ctx, bounds);
    root.add(bumperBuild.bumperFront, bumperBuild.bumperRear);
    parts.set('bumper_front', bumperBuild.bumperFront);
    parts.set('bumper_rear', bumperBuild.bumperRear);
    focusPoints.bumper_front = bumperBuild.fpFront;
    focusPoints.bumper_rear = bumperBuild.fpRear;

    // 9. Porton trasero (hatchback liftgate)
    const trunkBuild = buildTrunk(spec, ctx, bounds, { isTailgate: true });
    root.add(trunkBuild.trunk);
    parts.set('trunk', trunkBuild.trunk);
    focusPoints.trunk = trunkBuild.fp;

    return {
      root,
      parts,
      focusPoints,
      triangles: countTriangles(root),
    };
  },
};
