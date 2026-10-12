/**
 * van.ts — Plantilla parametrica de Van de carga / utilitaria de techo alto.
 *
 * Silueta de furgon utilitario de techo alto construida con bodyKit:
 *   - Cabina corta con parabrisas inclinado.
 *   - Cuerpo de carga alto pintado detras (la carroceria sube hasta el techo detras del pilar B).
 *   - Ventanas de vidrio oscuro tintado solo en la cabina (invernadero frontal).
 *   - Puertas traseras dobles verticales (trunk), dos puertas delanteras de trabajo y defensas comerciales.
 */
import { Group } from 'three/webgpu';
import type { BuiltVehicle, VehicleSpec, VehicleTemplate } from '../../contracts';
import { countTriangles, part } from '../common/geometry';
import { mm } from '../common/units';
import { buildGreenhouse, buildLowerBody, vanProfile } from './bodyKit';
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

export const VAN: VehicleTemplate = {
  id: 'car-van',
  family: 'car',
  body: 'van',
  label: 'Van de carga',
  defaults: {
    family: 'car',
    body: 'van',
    dims: {
      lengthMm: 4900,
      widthMm: 1950,
      heightMm: 2300,
      wheelbaseMm: 3100,
      trackFrontMm: 1660,
      trackRearMm: 1650,
      groundClearanceMm: 180,
    },
    tireFront: { widthMm: 215, aspectPct: 65, rimIn: 16 },
    tireRear: { widthMm: 215, aspectPct: 65, rimIn: 16 },
  },
  shapeParams: [
    { id: 'roofSlope', label: 'Caída del techo', default: 0.5, hint: 'Caída posterior de la van' },
    { id: 'hoodLength', label: 'Largo del capó', default: 0.5, hint: 'Largo de trompa delantera' },
    { id: 'beltLine', label: 'Línea de cintura', default: 0.5, hint: 'Moldura protectora lateral' },
    { id: 'rideHeight', label: 'Altura de marcha', default: 0.5, hint: 'Despeje al suelo de carga' },
    { id: 'bumperBulk', label: 'Volumen de bómperes', default: 0.5, hint: 'Defensas comerciales' },
  ],
  variants: {
    rim_fl: ['spokes', 'split', 'mesh', 'disc'],
    rim_fr: ['spokes', 'split', 'mesh', 'disc'],
    rim_rl: ['spokes', 'split', 'mesh', 'disc'],
    rim_rr: ['spokes', 'split', 'mesh', 'disc'],
  },
  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const root = new Group();
    root.name = 'vehicle:car-van';
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
    const p = vanProfile(
      {
        length: L,
        height: H,
        width: W,
        wheelbase: wheels.wb,
        wheelRF: wheels.rFront,
        wheelRR: wheels.rRear,
        clearance: mm(spec.dims.groundClearanceMm ?? 180),
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

    // 2. Carroceria baja y alta (bodyKit)
    // En la van, la carroceria baja sube hasta el techo detras del pilar B (highRoofBehindX)
    const lowerBody = buildLowerBody(p, ctx, spec.paint);
    // Invernadero con ventanas oscuras SOLO en la cabina (del cowlX al pilar B)
    const gh = buildGreenhouse(p, ctx, spec.paint, { verticalRear: true });
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

    // 5. Espejos retrovisores comerciales
    const mir = buildMirrors(spec, ctx, bounds);
    root.add(mir.mirrors);
    parts.set('mirrors', mir.mirrors);
    focusPoints.mirrors = mir.fp;

    // 6. Puertas (2 puertas delanteras comerciales)
    const doorBuild = buildDoors(spec, ctx, bounds, { fourDoors: false });
    for (const [id, grp] of doorBuild.doors) {
      root.add(grp);
      parts.set(id, grp);
    }
    Object.assign(focusPoints, doorBuild.fps);

    // 7. Capo corto comercial
    const hoodBuild = buildHood(spec, ctx, bounds);
    root.add(hoodBuild.hood);
    parts.set('hood', hoodBuild.hood);
    focusPoints.hood = hoodBuild.fp;

    // 8. Bomperes de trabajo comercial
    const bumperBuild = buildBumpers(spec, ctx, bounds);
    root.add(bumperBuild.bumperFront, bumperBuild.bumperRear);
    parts.set('bumper_front', bumperBuild.bumperFront);
    parts.set('bumper_rear', bumperBuild.bumperRear);
    focusPoints.bumper_front = bumperBuild.fpFront;
    focusPoints.bumper_rear = bumperBuild.fpRear;

    // 9. Porton trasero doble vertical (van doors)
    const trunkBuild = buildTrunk(spec, ctx, bounds, { isVanDoors: true });
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
