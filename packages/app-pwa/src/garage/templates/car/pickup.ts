/**
 * pickup.ts — Plantilla parametrica de Pickup doble cabina.
 *
 * Silueta utilitaria de camioneta 4x4 construida con bodyKit:
 *   - Invernadero con vidrio oscuro tintado SOLO sobre la cabina doble, con luneta vertical.
 *   - Platon detras con paredes a la altura de la cintura y piso oscuro texturizado,
 *     sin techo sobre el platon.
 *   - 4 puertas laterales, defensas reforzadas y mecanica 4x4 completa.
 */
import { Group } from 'three/webgpu';
import type { BuiltVehicle, VehicleSpec, VehicleTemplate } from '../../contracts';
import { countTriangles, part } from '../common/geometry';
import { mm } from '../common/units';
import { buildGreenhouse, buildLowerBody, pickupProfile } from './bodyKit';
import {
  buildBumpers,
  buildCargoBed,
  buildDoors,
  buildHood,
  buildLighting,
  buildMirrors,
  type ExteriorBounds,
} from './carBodyHelper';
import { buildCarMechanicals } from './carMechanicals';
import { buildCarWheels } from './carWheelHelper';

export const PICKUP: VehicleTemplate = {
  id: 'car-pickup',
  family: 'car',
  body: 'pickup',
  label: 'Pickup doble cabina',
  defaults: {
    family: 'car',
    body: 'pickup',
    dims: {
      lengthMm: 5325,
      widthMm: 1855,
      heightMm: 1815,
      wheelbaseMm: 3085,
      trackFrontMm: 1540,
      trackRearMm: 1550,
      groundClearanceMm: 220,
    },
    tireFront: { widthMm: 265, aspectPct: 65, rimIn: 17 },
    tireRear: { widthMm: 265, aspectPct: 65, rimIn: 17 },
  },
  shapeParams: [
    { id: 'roofSlope', label: 'Caída del techo', default: 0.5, hint: 'Caída de cabina' },
    { id: 'hoodLength', label: 'Largo del capó', default: 0.5, hint: 'Largo del vano motor' },
    { id: 'beltLine', label: 'Línea de cintura', default: 0.5, hint: 'Altura de los costados del platón' },
    { id: 'rideHeight', label: 'Altura de marcha', default: 0.5, hint: 'Despeje al suelo 4x4' },
    { id: 'bumperBulk', label: 'Volumen de bómperes', default: 0.5, hint: 'Volumen de defensa frontal' },
    { id: 'cabinSetback', label: 'Posición de cabina', default: 0.5, hint: 'División entre cabina y platón' },
    { id: 'bedLength', label: 'Largo del platón', default: 0.5, hint: 'Proporción de zona de carga' },
  ],
  variants: {
    rim_fl: ['spokes', 'split', 'mesh', 'disc'],
    rim_fr: ['spokes', 'split', 'mesh', 'disc'],
    rim_rl: ['spokes', 'split', 'mesh', 'disc'],
    rim_rr: ['spokes', 'split', 'mesh', 'disc'],
  },
  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const root = new Group();
    root.name = 'vehicle:car-pickup';
    const parts = new Map();
    const focusPoints: Record<string, [number, number, number]> = {};

    // 1. Ruedas 4x4
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
    const p = pickupProfile(
      {
        length: L,
        height: H,
        width: W,
        wheelbase: wheels.wb,
        wheelRF: wheels.rFront,
        wheelRR: wheels.rRear,
        clearance: mm(spec.dims.groundClearanceMm ?? 220),
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
    // Carroceria baja con doble cabina y laterales de platon con paso de rueda
    const lowerBody = buildLowerBody(p, ctx, spec.paint);
    // Invernadero con vidrio oscuro SOLO sobre la cabina doble, con luneta trasera vertical
    const gh = buildGreenhouse(p, ctx, spec.paint, {
      verticalRear: true,
      bPillars: [(p.roofFrontX + p.roofRearX) * 0.52],
    });
    lowerBody.add(gh.roof);

    const gBody = part('body', lowerBody);
    const gGlass = part('glass', gh.glass);
    root.add(gBody, gGlass);
    parts.set('body', gBody);
    parts.set('glass', gGlass);
    focusPoints.body = [0, (p.rockerY + H) / 2, 0];
    focusPoints.glass = [(p.cowlX + p.roofFrontX) / 2, (p.beltY + p.roofY) / 2, 0];

    // 3. Mecanica interna y chasis 4x4
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

    // 6. Puertas (4 puertas de cabina doble)
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

    // 8. Bomperes reforzados
    const bumperBuild = buildBumpers(spec, ctx, bounds);
    root.add(bumperBuild.bumperFront, bumperBuild.bumperRear);
    parts.set('bumper_front', bumperBuild.bumperFront);
    parts.set('bumper_rear', bumperBuild.bumperRear);
    focusPoints.bumper_front = bumperBuild.fpFront;
    focusPoints.bumper_rear = bumperBuild.fpRear;

    // 9. Platon de carga utilitario (cargo_bed)
    const bedBuild = buildCargoBed(spec, ctx, bounds);
    root.add(bedBuild.cargoBed);
    parts.set('cargo_bed', bedBuild.cargoBed);
    focusPoints.cargo_bed = bedBuild.fp;

    return {
      root,
      parts,
      focusPoints,
      triangles: countTriangles(root),
    };
  },
};
