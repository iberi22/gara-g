/**
 * carBodyHelper.ts — Constructores de carroceria estilizada, paneles exteriores, vidrios, luces y defensas.
 *
 * Crea piezas con geometria aerodinamica moderna, superficies redondeadas,
 * tumblehome autentico, vidrios empotrados en la silueta y cero aspecto de cajas flotantes:
 *   - headlight / taillight (opticas LED estilizadas y envolventes)
 *   - mirrors (retrovisores aerodinamicos sobre pilar A)
 *   - door_fl, door_fr, door_rl, door_rr (paneles de puertas estilizados con manijas y zocalo)
 *   - hood (capo curvado que sigue el contorno del vano motor)
 *   - glass (greenhouse continuo con parabrisas inclinado, luneta y ventanillas)
 *   - bumper_front (defensa delantera envolvente con toma de aire y labio)
 *   - bumper_rear (defensa trasera envolvente con difusor y portaplaca)
 *   - trunk (tapa de baul o porton trasero estilizado)
 *   - cargo_bed (platon utilitario para pickup)
 *   - cab, chassis_frame, fuel_tank_heavy, cargo_box, fifth_wheel (ranuras para pesados)
 */
import { Group } from 'three/webgpu';
import type { PartSlotId, TemplateContext, VehicleSpec } from '../../contracts';
import { bodySection, loft, mesh, part, roundedBox, type LoftSection } from '../common/geometry';

export interface ExteriorBounds {
  xFront: number;
  xRear: number;
  totalLength: number;
  totalHeight: number;
  totalWidth: number;
  halfW: number;
  wb: number;
  tf: number;
  tr: number;
  rFront: number;
  rRear: number;
  groundY: number;
  hoodY: number;
  roofY: number;
  beltY: number;
  cowlX: number;
  roofStartX: number;
  roofEndX: number;
  trunkX: number;
}

// =========================================================================
// 1. ILUMINACION: Farolas y Stops envolventes
// =========================================================================
export function buildLighting(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
): { headlight: Group; taillight: Group; fpHead: [number, number, number]; fpTail: [number, number, number] } {
  const { materials: kit } = ctx;
  const { xFront, xRear, halfW, groundY, hoodY, beltY } = bounds;

  // Headlights: opticas estilizadas e integradas al ras en las esquinas frontales
  const headGrp = new Group();
  const headX = xFront - 0.04;
  const headY = groundY + (hoodY - groundY) * 0.74;
  const headW = 0.10;
  const headH = 0.05;
  const headD = 0.13;

  for (const s of [1, -1]) {
    const headZ = s * (halfW * 0.58);
    const housing = mesh(roundedBox(headW, headH, headD, 0.015), kit.metal('dark'), [headX, headY, headZ]);
    const lens = mesh(roundedBox(0.02, headH * 0.80, headD * 0.80, 0.01), kit.light('head'), [
      headX + headW / 2 - 0.005,
      headY,
      headZ - s * 0.01,
    ]);
    const drl = mesh(roundedBox(0.02, 0.01, headD * 0.70, 0.004), kit.light('drl'), [
      headX + headW / 2 - 0.005,
      headY + headH * 0.30,
      headZ,
    ]);
    headGrp.add(housing, lens, drl);
  }
  const gHeadlight = part('headlight', headGrp);

  // Taillights: opticas estilizadas horizontales integradas
  const tailGrp = new Group();
  const isHeavy = spec.family === 'heavy';
  const tailX = xRear + 0.04;
  const tailY = isHeavy ? groundY + 0.38 : groundY + (beltY - groundY) * 0.76;
  const tailW = 0.08;
  const tailH = 0.045;
  const tailD = 0.15;

  for (const s of [1, -1]) {
    const tailZ = s * (isHeavy ? 0.44 : halfW * 0.58);
    const housing = mesh(roundedBox(tailW, tailH, tailD, 0.012), kit.metal('dark'), [tailX, tailY, tailZ]);
    const redLight = mesh(roundedBox(0.018, tailH * 0.80, tailD * 0.82, 0.008), kit.light('tail'), [
      tailX - tailW / 2 + 0.005,
      tailY,
      tailZ,
    ]);
    const turnLight = mesh(roundedBox(0.018, 0.012, tailD * 0.30, 0.004), kit.light('turn'), [
      tailX - tailW / 2 + 0.005,
      tailY - tailH * 0.22,
      tailZ - s * 0.02,
    ]);
    tailGrp.add(housing, redLight, turnLight);
  }
  const gTaillight = part('taillight', tailGrp);

  return {
    headlight: gHeadlight,
    taillight: gTaillight,
    fpHead: [headX, headY, halfW * 0.74],
    fpTail: [tailX, tailY, halfW * 0.76],
  };
}

// =========================================================================
// 2. ESPEJOS RETROVISORES AERODINAMICOS
// =========================================================================
export function buildMirrors(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
): { mirrors: Group; fp: [number, number, number] } {
  const { materials: kit } = ctx;
  const { cowlX, beltY, halfW } = bounds;

  const mirrorGrp = new Group();
  const mX = cowlX - 0.08;
  const mY = beltY + 0.07;
  const mW = 0.13;
  const mH = 0.08;
  const mD = 0.07;

  for (const s of [1, -1]) {
    const mZ = s * (halfW * 0.88);
    const stalk = mesh(roundedBox(0.04, 0.03, 0.04, 0.008), kit.plastic('black'), [
      mX,
      mY - 0.03,
      s * (halfW * 0.83),
    ]);
    const shell = mesh(roundedBox(mW, mH, mD, 0.02), kit.paint(spec.paint), [mX, mY, mZ]);
    const glassRef = mesh(roundedBox(0.008, mH * 0.8, mD * 0.8, 0.008), kit.chrome(), [
      mX - mW / 2 + 0.006,
      mY,
      mZ,
    ]);
    mirrorGrp.add(stalk, shell, glassRef);
  }
  const gMirrors = part('mirrors', mirrorGrp);
  return { mirrors: gMirrors, fp: [mX, mY, halfW * 0.88] };
}

// =========================================================================
// 3. PUERTAS ESTILIZADAS CON MANIJAS Y ZOCALO
// =========================================================================
export function buildDoors(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
  opts: { fourDoors?: boolean } = {},
): { doors: Map<PartSlotId, Group>; fps: Record<PartSlotId, [number, number, number]> } {
  const { materials: kit } = ctx;
  const { cowlX, beltY, groundY, roofY, halfW } = bounds;
  const fourDoors = opts.fourDoors ?? true;
  const isHeavy = spec.family === 'heavy';

  const doors = new Map<PartSlotId, Group>();
  const fps: Record<PartSlotId, [number, number, number]> = {};

  if (isHeavy) {
    // Puertas de cabina para camiones / tractores
    const isTractor = spec.body === 'tractor';
    const cabLen = isTractor ? 2.45 : 2.10;
    const cabX = bounds.xFront - cabLen / 2 - 0.05;
    const cabH = isTractor ? (roofY - groundY - 0.28) * 0.84 : roofY - groundY - 0.28;
    const cabY = groundY + 0.28 + cabH / 2;
    const dLen = cabLen * 0.44;
    const dH = cabH * 0.58;
    const dX = cabX + cabLen * 0.12;
    const dY = cabY - cabH * 0.10;

    for (const [tag, s] of [
      ['door_fl', 1],
      ['door_fr', -1],
    ] as const) {
      const grp = new Group();
      const zPos = s * (halfW * 0.965);
      const skin = mesh(roundedBox(dLen, dH, 0.006, 0.002), kit.paint(spec.paint), [dX, dY, zPos]);
      const handle = mesh(roundedBox(0.09, 0.024, 0.010, 0.004), kit.plastic('black'), [
        dX - dLen * 0.30,
        dY + dH * 0.25,
        zPos + s * 0.006,
      ]);
      const step = mesh(roundedBox(dLen * 0.85, 0.03, 0.02, 0.004), kit.metal('dark'), [
        dX,
        groundY + 0.32,
        zPos + s * 0.010,
      ]);
      grp.add(skin, handle, step);
      const g = part(tag, grp);
      doors.set(tag, g);
      fps[tag] = [dX, dY, zPos];
    }
    return { doors, fps };
  }

  // Para vehiculos ligeros: puertas situadas limpiamente entre pasos de rueda
  const frontArchRear = bounds.wb / 2 - bounds.rFront - 0.04;
  const rearArchFront = -bounds.wb / 2 + bounds.rRear + 0.04;
  const spaceStart = Math.min(cowlX, frontArchRear);
  const spaceEnd = rearArchFront;
  const doorSpace = Math.max(0.6, spaceStart - spaceEnd);
  const doorH = (beltY - groundY) * 0.72;
  const doorY = groundY + doorH / 2 + 0.05;

  if (fourDoors) {
    const fDoorLen = doorSpace * 0.51;
    const rDoorLen = doorSpace * 0.47;
    const fDoorX = spaceStart - fDoorLen / 2;
    const rDoorX = spaceEnd + rDoorLen / 2;

    for (const [tag, xPos, isFront, s] of [
      ['door_fl', fDoorX, true, 1],
      ['door_fr', fDoorX, true, -1],
      ['door_rl', rDoorX, false, 1],
      ['door_rr', rDoorX, false, -1],
    ] as const) {
      const dLen = isFront ? fDoorLen : rDoorLen;
      const grp = new Group();
      const zPos = s * (halfW * 0.965);

      // Panel de puerta al ras con bisel sutil
      const skin = mesh(roundedBox(dLen * 0.97, doorH, 0.006, 0.002), kit.paint(spec.paint), [xPos, doorY, zPos]);
      // Manija empotrada moderna
      const handleX = isFront ? xPos - dLen * 0.30 : xPos - dLen * 0.25;
      const handle = mesh(roundedBox(0.09, 0.022, 0.012, 0.004), kit.plastic('black'), [
        handleX,
        beltY - 0.06,
        zPos + s * 0.008,
      ]);
      // Protector inferior de estribo
      const mould = mesh(roundedBox(dLen * 0.95, 0.04, 0.012, 0.004), kit.plastic('textured'), [
        xPos,
        groundY + 0.04,
        zPos + s * 0.006,
      ]);
      grp.add(skin, handle, mould);

      const g = part(tag, grp);
      doors.set(tag, g);
      fps[tag] = [xPos, doorY, zPos];
    }
  } else {
    // 2 puertas (van)
    const dLen = doorSpace * 0.90;
    const dX = (spaceStart + spaceEnd) / 2;
    for (const [tag, s] of [
      ['door_fl', 1],
      ['door_fr', -1],
    ] as const) {
      const grp = new Group();
      const zPos = s * (halfW * 0.965);

      const skin = mesh(roundedBox(dLen * 0.97, doorH, 0.006, 0.002), kit.paint(spec.paint), [dX, doorY, zPos]);
      const handle = mesh(roundedBox(0.10, 0.025, 0.014, 0.004), kit.plastic('black'), [
        dX - dLen * 0.30,
        beltY - 0.06,
        zPos + s * 0.008,
      ]);
      const mould = mesh(roundedBox(dLen * 0.95, 0.04, 0.012, 0.004), kit.plastic('textured'), [
        dX,
        groundY + 0.04,
        zPos + s * 0.006,
      ]);
      grp.add(skin, handle, mould);

      const g = part(tag, grp);
      doors.set(tag, g);
      fps[tag] = [dX, doorY, zPos];
    }
  }

  return { doors, fps };
}

// =========================================================================
// 4. CAPO ESCULPIDO (hood)
// =========================================================================
export function buildHood(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
): { hood: Group; fp: [number, number, number] } {
  const { materials: kit, lod } = ctx;
  const { xFront, cowlX, hoodY, halfW } = bounds;

  const pts = lod === 'high' ? 32 : 16;
  const sections: LoftSection[] = [
    {
      x: xFront - 0.16,
      ring: bodySection({ halfWidthBottom: halfW * 0.68, halfWidthTop: halfW * 0.65, yBottom: hoodY * 0.86, yTop: hoodY * 0.88, n: 2.6, points: pts }),
    },
    {
      x: (xFront - 0.16 + cowlX) / 2,
      ring: bodySection({ halfWidthBottom: halfW * 0.78, halfWidthTop: halfW * 0.75, yBottom: hoodY * 0.94, yTop: hoodY * 0.96, n: 2.8, points: pts }),
    },
    {
      x: cowlX,
      ring: bodySection({ halfWidthBottom: halfW * 0.82, halfWidthTop: halfW * 0.79, yBottom: hoodY - 0.01, yTop: hoodY + 0.015, n: 2.8, points: pts }),
    },
  ];

  const hoodGeo = loft(sections);
  const hoodMesh = mesh(hoodGeo, kit.paint(spec.paint));
  const gHood = part('hood', hoodMesh);
  return { hood: gHood, fp: [(xFront + cowlX) / 2, hoodY, 0] };
}

// =========================================================================
// 5. GREENHOUSE DE VIDRIOS EMPOTRADOS (glass)
// =========================================================================
export function buildGlass(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
  opts: { hasRearWindow?: boolean } = {},
): { glass: Group; fp: [number, number, number] } {
  const { materials: kit, lod } = ctx;
  const { xFront, groundY, cowlX, roofStartX, roofEndX, trunkX, beltY, roofY, halfW } = bounds;
  const hasRear = opts.hasRearWindow ?? true;
  const glassMat = kit.glass('tinted');
  const grp = new Group();

  if (spec.family === 'heavy') {
    // Parabrisas panoramico y ventanillas laterales oscuras para cabinas comerciales
    const isTractor = spec.body === 'tractor';
    const cabLen = isTractor ? 2.45 : 2.10;
    const cabX = xFront - cabLen / 2 - 0.05;
    const cabH = isTractor ? (roofY - groundY - 0.28) * 0.84 : roofY - groundY - 0.28;
    const cabY = groundY + 0.28 + cabH / 2;
    const cabW = isTractor ? halfW * 1.99 : halfW * 1.97;

    const wShieldH = cabH * 0.38;
    const wShieldY = cabY + cabH * 0.16;
    const wShieldX = cabX + cabLen / 2 + 0.005;

    // Parabrisas frontal oscuro
    const frontGlass = mesh(
      roundedBox(0.04, wShieldH, cabW * 0.88, 0.03),
      glassMat,
      [wShieldX, wShieldY, 0],
    );
    const rubberFrame = mesh(
      roundedBox(0.02, wShieldH + 0.04, cabW * 0.90, 0.03),
      kit.plastic('black'),
      [wShieldX - 0.01, wShieldY, 0],
    );
    grp.add(rubberFrame, frontGlass);

    // Ventanillas laterales
    const winLen = cabLen * 0.45;
    const winH = wShieldH * 0.90;
    for (const s of [1, -1]) {
      const sideGlass = mesh(
        roundedBox(winLen, winH, 0.02, 0.02),
        glassMat,
        [cabX + cabLen * 0.14, wShieldY, s * (cabW / 2 + 0.005)],
      );
      const sFrame = mesh(
        roundedBox(winLen + 0.03, winH + 0.03, 0.015),
        kit.plastic('black'),
        [cabX + cabLen * 0.14, wShieldY, s * (cabW / 2 + 0.002)],
      );
      grp.add(sFrame, sideGlass);
    }
    const gGlass = part('glass', grp);
    return { glass: gGlass, fp: [wShieldX, wShieldY, 0] };
  }

  const pts = lod === 'high' ? 32 : 16;
  const sections: LoftSection[] = [
    // Base de parabrisas (cowl)
    {
      x: cowlX,
      ring: bodySection({ halfWidthBottom: halfW * 0.76, halfWidthTop: halfW * 0.73, yBottom: beltY + 0.01, yTop: beltY + 0.035, n: 2.4, points: pts }),
    },
    // Parabrisas superior / inicio del techo
    {
      x: roofStartX,
      ring: bodySection({ halfWidthBottom: halfW * 0.70, halfWidthTop: halfW * 0.67, yBottom: beltY + 0.03, yTop: roofY - 0.015, n: 3.0, points: pts }),
    },
    // Centro del techo acristalado y ventanillas laterales
    {
      x: (roofStartX + roofEndX) / 2,
      ring: bodySection({ halfWidthBottom: halfW * 0.71, halfWidthTop: halfW * 0.68, yBottom: beltY + 0.03, yTop: roofY - 0.01, n: 3.0, points: pts }),
    },
    // Fin de techo / inicio de luneta trasera
    {
      x: roofEndX,
      ring: bodySection({ halfWidthBottom: halfW * 0.69, halfWidthTop: halfW * 0.67, yBottom: beltY + 0.03, yTop: roofY - 0.015, n: 3.0, points: pts }),
    },
  ];

  if (hasRear) {
    sections.push({
      x: trunkX,
      ring: bodySection({ halfWidthBottom: halfW * 0.74, halfWidthTop: halfW * 0.71, yBottom: beltY + 0.01, yTop: beltY + 0.035, n: 2.4, points: pts }),
    });
  }

  const glassGeo = loft(sections);
  const glassMesh = mesh(glassGeo, glassMat);
  const gGlass = part('glass', glassMesh);
  return { glass: gGlass, fp: [(cowlX + roofStartX) / 2, (beltY + roofY) / 2, 0] };
}

// =========================================================================
// 6. DEFENSAS ENVOLVENTES (bumper_front, bumper_rear)
// =========================================================================
export function buildBumpers(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
): {
  bumperFront: Group;
  bumperRear: Group;
  fpFront: [number, number, number];
  fpRear: [number, number, number];
} {
  const { materials: kit } = ctx;
  const { xFront, xRear, halfW, groundY, hoodY, beltY } = bounds;

  // Bumper delantero: parrilla inferior, lip aerodinamico y tomas de aire
  const bFGrp = new Group();
  const grilleH = Math.max(0.08, hoodY * 0.28);
  const grille = mesh(roundedBox(0.04, grilleH, halfW * 0.95, 0.015), kit.plastic('black'), [
    xFront - 0.02,
    groundY + hoodY * 0.22,
    0,
  ]);
  const lip = mesh(roundedBox(0.08, 0.03, halfW * 1.25, 0.01), kit.plastic('textured'), [
    xFront - 0.02,
    groundY + 0.02,
    0,
  ]);
  for (const s of [1, -1]) {
    const intake = mesh(roundedBox(0.03, grilleH * 0.6, halfW * 0.22, 0.008), kit.plastic('black'), [
      xFront - 0.03,
      groundY + hoodY * 0.22,
      s * (halfW * 0.68),
    ]);
    bFGrp.add(intake);
  }
  bFGrp.add(grille, lip);
  const gBumperFront = part('bumper_front', bFGrp);

  // Bumper trasero: difusor aerodinamico, portaplaca y reflectores
  const bRGrp = new Group();
  const isHeavy = spec.family === 'heavy';
  const diffH = Math.max(0.08, beltY * 0.22);
  const diffY = isHeavy ? groundY + 0.36 : groundY + 0.06;
  const plateY = isHeavy ? groundY + 0.38 : groundY + beltY * 0.48;
  const reflectorY = isHeavy ? groundY + 0.38 : groundY + beltY * 0.35;
  const diff = mesh(roundedBox(0.08, diffH, halfW * 1.10, 0.015), kit.plastic('textured'), [
    xRear + 0.03,
    diffY,
    0,
  ]);
  const plate = mesh(roundedBox(0.02, 0.13, 0.32, 0.008), kit.plastic('black'), [
    xRear + 0.02,
    plateY,
    0,
  ]);
  for (const s of [1, -1]) {
    const reflector = mesh(roundedBox(0.01, 0.02, 0.12, 0.004), kit.light('tail'), [
      xRear + 0.04,
      reflectorY,
      s * (isHeavy ? 0.44 : halfW * 0.65),
    ]);
    bRGrp.add(reflector);
  }
  bRGrp.add(diff, plate);
  const gBumperRear = part('bumper_rear', bRGrp);

  return {
    bumperFront: gBumperFront,
    bumperRear: gBumperRear,
    fpFront: [xFront, hoodY * 0.5, 0],
    fpRear: [xRear, beltY * 0.5, 0],
  };
}

// =========================================================================
// 7. BAUL O PORTON TRASERO (trunk)
// =========================================================================
export function buildTrunk(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
  opts: { isTailgate?: boolean; isVanDoors?: boolean } = {},
): { trunk: Group; fp: [number, number, number] } {
  const { materials: kit, lod } = ctx;
  const { trunkX, xRear, beltY, groundY, roofY, halfW } = bounds;

  const pts = lod === 'high' ? 32 : 16;
  const grp = new Group();

  if (opts.isVanDoors) {
    // Porton doble vertical para van
    const doorH = roofY - groundY - 0.06;
    const doorY = groundY + doorH / 2 + 0.03;
    const doorW = halfW * 0.90;
    for (const s of [1, -1]) {
      const doorMesh = mesh(roundedBox(0.04, doorH, doorW, 0.02), kit.paint(spec.paint), [
        xRear + 0.03,
        doorY,
        s * (doorW / 2 + 0.005),
      ]);
      const handle = mesh(roundedBox(0.02, 0.12, 0.03, 0.008), kit.plastic('black'), [
        xRear + 0.06,
        doorY,
        s * 0.06,
      ]);
      grp.add(doorMesh, handle);
    }
  } else if (opts.isTailgate) {
    // Porton inclinado tipo liftback (hatchback / SUV)
    const tSections: LoftSection[] = [
      {
        x: bounds.roofEndX,
        ring: bodySection({ halfWidthBottom: halfW * 0.69, halfWidthTop: halfW * 0.67, yBottom: beltY + 0.02, yTop: roofY - 0.015, n: 3.0, points: pts }),
      },
      {
        x: (bounds.roofEndX + xRear + 0.08) / 2,
        ring: bodySection({ halfWidthBottom: halfW * 0.74, halfWidthTop: halfW * 0.70, yBottom: beltY * 0.88, yTop: beltY + 0.12, n: 3.0, points: pts }),
      },
      {
        x: xRear + 0.08,
        ring: bodySection({ halfWidthBottom: halfW * 0.72, halfWidthTop: halfW * 0.68, yBottom: beltY * 0.84, yTop: beltY + 0.02, n: 2.8, points: pts }),
      },
    ];
    const gateGeo = loft(tSections);
    grp.add(mesh(gateGeo, kit.paint(spec.paint)));
  } else {
    // Tapa de baul clasica para sedan (loft perfilado al ras con la cintura)
    const tSections: LoftSection[] = [
      {
        x: trunkX,
        ring: bodySection({ halfWidthBottom: halfW * 0.74, halfWidthTop: halfW * 0.72, yBottom: beltY - 0.015, yTop: beltY + 0.004, n: 2.6, points: pts }),
      },
      {
        x: (trunkX + xRear + 0.10) / 2,
        ring: bodySection({ halfWidthBottom: halfW * 0.72, halfWidthTop: halfW * 0.70, yBottom: beltY - 0.020, yTop: beltY + 0.003, n: 2.6, points: pts }),
      },
      {
        x: xRear + 0.10,
        ring: bodySection({ halfWidthBottom: halfW * 0.69, halfWidthTop: halfW * 0.67, yBottom: beltY - 0.025, yTop: beltY + 0.002, n: 2.4, points: pts }),
      },
    ];
    const lidGeo = loft(tSections);
    grp.add(mesh(lidGeo, kit.paint(spec.paint)));
  }

  const gTrunk = part('trunk', grp);
  return { trunk: gTrunk, fp: [(trunkX + xRear) / 2, beltY, 0] };
}

// =========================================================================
// 8. PLATON DE PICKUP (cargo_bed)
// =========================================================================
export function buildCargoBed(
  spec: VehicleSpec,
  ctx: TemplateContext,
  bounds: ExteriorBounds,
): { cargoBed: Group; fp: [number, number, number] } {
  const { materials: kit } = ctx;
  const { roofEndX, xRear, beltY, groundY, halfW } = bounds;

  const grp = new Group();
  const bedStartX = roofEndX - 0.12;
  const bedLen = Math.abs(bedStartX - xRear) - 0.15;
  const bedCenterX = (bedStartX + xRear) / 2;
  const bedWallH = (beltY - groundY) * 0.88;
  const bedFloorY = groundY + 0.18;
  const bedW = halfW * 1.82;

  // Piso del platon texturizado
  const floor = mesh(roundedBox(bedLen, 0.04, bedW * 0.88, 0.015), kit.plastic('textured'), [
    bedCenterX,
    bedFloorY,
    0,
  ]);
  grp.add(floor);

  // Laterales exteriores del platon (pintados)
  for (const s of [1, -1]) {
    const sideWall = mesh(roundedBox(bedLen, bedWallH, 0.04, 0.015), kit.paint(spec.paint), [
      bedCenterX,
      bedFloorY + bedWallH / 2,
      s * (bedW / 2 - 0.02),
    ]);
    const railCap = mesh(roundedBox(bedLen, 0.025, 0.06, 0.008), kit.plastic('textured'), [
      bedCenterX,
      bedFloorY + bedWallH + 0.01,
      s * (bedW / 2 - 0.02),
    ]);
    grp.add(sideWall, railCap);
  }

  // Pared frontal de cabina
  const frontWall = mesh(roundedBox(0.04, bedWallH, bedW * 0.88, 0.015), kit.paint(spec.paint), [
    bedStartX,
    bedFloorY + bedWallH / 2,
    0,
  ]);
  grp.add(frontWall);

  // Compuerta trasera (tailgate)
  const gateX = xRear + 0.12;
  const tailgate = mesh(roundedBox(0.05, bedWallH * 0.94, bedW * 0.88, 0.015), kit.paint(spec.paint), [
    gateX,
    bedFloorY + bedWallH / 2,
    0,
  ]);
  const handle = mesh(roundedBox(0.02, 0.05, 0.14, 0.006), kit.plastic('black'), [
    gateX - 0.03,
    bedFloorY + bedWallH * 0.72,
    0,
  ]);
  grp.add(tailgate, handle);

  const gCargoBed = part('cargo_bed', grp);
  return { cargoBed: gCargoBed, fp: [bedCenterX, bedFloorY + bedWallH / 2, 0] };
}
