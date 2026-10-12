/**
 * bodyKit.ts — Carroceria de referencia para carros (escrita por el orquestador como
 * ejemplo de construccion; las plantillas la adaptan por carroceria).
 *
 * Tres ideas hacen que un carro generado por codigo se lea como carro y no como blob:
 *   1. Perfil lateral 2D con los PASOS DE RUEDA recortados, extruido a lo ancho con un
 *      bisel grande (6–9 cm, 4 segmentos): aristas redondeadas y siluetas limpias.
 *   2. Costados planos con normales con pliegue (sin estrias) y el estrechamiento en planta
 *      (taper) solo en el invernadero, que es un loft suave.
 *   3. Invernadero de VIDRIO OSCURO separado (loft de secciones sobre la linea de cintura)
 *      con techo y pilares pintados encima: la banda oscura de ventanas es lo que el ojo
 *      usa para reconocer un carro.
 */
import { ExtrudeGeometry, Group, Shape, Vector2 } from 'three/webgpu';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PaintSpec, TemplateContext } from '../../contracts';
import { bodySection, loft, mesh, tube, type LoftSection, type P2 } from '../common/geometry';

/** Perfil lateral del carro, en metros (x hacia el frente, y hacia arriba). */
export interface CarProfile {
  xFront: number;
  xRear: number;
  /** Centros de rueda (x) y radio de la llanta. */
  axleF: number;
  axleR: number;
  wheelRF: number;
  wheelRR: number;
  /** Borde inferior de la carroceria (despeje). */
  rockerY: number;
  /** Altura de la nariz (arriba del bomper delantero) y de la cola. */
  noseY: number;
  tailY: number;
  /** Capo junto al parabrisas, linea de cintura (base de ventanas) y techo. */
  hoodY: number;
  beltY: number;
  roofY: number;
  /** x de la base del parabrisas, del techo plano (inicio/fin) y de la base de la luneta. */
  cowlX: number;
  roofFrontX: number;
  roofRearX: number;
  backlightX: number;
  /** Medio ancho de la carroceria (sin espejos). */
  halfWidth: number;
  /** Opciones avanzadas por tipo de carroceria */
  archGap?: number;
  highRoofBehindX?: number; // Para van: carroceria alta hasta roofY detras del pilar B
  verticalRear?: boolean;   // Para van / pickup: luneta posterior vertical
  bedStartX?: number;       // Para pickup: inicio del platon detras de cabina
  bedFloorY?: number;       // Para pickup: altura del piso del platon
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Contorno lateral de la carroceria baja (bajo la cintura) con los pasos de rueda recortados. */
export function sideOutline(p: CarProfile, archGap = p.archGap ?? 0.035, archSeg = 14): P2[] {
  const pts: P2[] = [];
  const arch = (axle: number, wheelR: number) => {
    const r = wheelR + archGap;
    const cy = wheelR;
    const dy = Math.max(0, cy - p.rockerY);
    const dx = Math.sqrt(Math.max(r * r - dy * dy, 0));
    // De adelante hacia atras por la parte de abajo: entra por x = axle + dx y sale por axle - dx.
    const a0 = Math.atan2(p.rockerY - cy, dx);
    const a1 = Math.PI - a0;
    for (let k = 0; k <= archSeg; k++) {
      const a = a0 + ((a1 - a0) * k) / archSeg;
      pts.push([axle + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const nose = 0.06;
  // Frente abajo → por debajo hacia atras (con los dos pasos de rueda).
  pts.push([p.xFront - nose, p.rockerY + 0.04]);
  pts.push([p.xFront - nose * 2, p.rockerY]);
  arch(p.axleF, p.wheelRF);
  arch(p.axleR, p.wheelRR);
  pts.push([p.xRear + nose * 1.5, p.rockerY]);
  pts.push([p.xRear + nose * 0.4, p.rockerY + 0.05]);

  if (p.highRoofBehindX !== undefined) {
    // Para van: el cuerpo de carga sube hasta el techo (roofY) detras del pilar B
    pts.push([p.xRear, p.tailY]);
    pts.push([p.xRear + 0.01, p.roofY - 0.04]);
    pts.push([p.xRear - 0.02, p.roofY]);
    pts.push([p.highRoofBehindX, p.roofY]);
    pts.push([p.highRoofBehindX, p.beltY]);
    pts.push([p.cowlX, p.beltY]);
  } else {
    // Cara trasera y cola.
    pts.push([p.xRear, p.tailY - 0.08]);
    pts.push([p.xRear + 0.03, p.tailY]);
    // Tapa del baul / cola hasta la base de la luneta, linea de cintura hasta el parabrisas.
    pts.push([p.backlightX, p.beltY]);
    pts.push([p.cowlX, p.beltY]);
  }
  // Capo: baja suavemente hasta la nariz.
  pts.push([p.cowlX + (p.xFront - p.cowlX) * 0.35, p.hoodY - 0.01]);
  pts.push([p.cowlX + (p.xFront - p.cowlX) * 0.75, (p.hoodY + p.noseY) / 2]);
  pts.push([p.xFront - 0.02, p.noseY]);
  pts.push([p.xFront, p.noseY - 0.1]);
  return pts;
}

/** Ancho relativo en planta: 1 en el centro, se cierra hacia las puntas. */
function planTaper(p: CarProfile, x: number): number {
  const front = smooth(Math.min(1, Math.max(0, (p.xFront - x) / 0.55)));
  const rear = smooth(Math.min(1, Math.max(0, (x - p.xRear) / 0.45)));
  return 0.86 + 0.14 * Math.min(front, rear);
}

/**
 * Carroceria baja de pickup: doble cabina al frente + laterales del platon
 * con paredes a la cintura, compuerta trasera y piso oscuro texturizado.
 */
function buildPickupLowerBody(p: CarProfile, ctx: TemplateContext, paint: PaintSpec): Group {
  const grp = new Group();
  const bevel = ctx.lod === 'high' ? 0.07 : 0.055;
  const bs = bevel * 0.9;
  const bedStartX = p.bedStartX ?? -0.20;
  const bedFloorY = p.bedFloorY ?? (p.rockerY + 0.16);
  const archSeg = ctx.lod === 'high' ? 14 : 8;

  // 1. Doble cabina (del frente hasta bedStartX)
  const cabArch = (axle: number, wheelR: number, pts: P2[]) => {
    const r = wheelR + (p.archGap ?? 0.035) + bs;
    const cy = wheelR;
    const dy = Math.max(0, cy - (p.rockerY + bs));
    const dx = Math.sqrt(Math.max(r * r - dy * dy, 0));
    const a0 = Math.atan2(p.rockerY + bs - cy, dx);
    const a1 = Math.PI - a0;
    for (let k = 0; k <= archSeg; k++) {
      const a = a0 + ((a1 - a0) * k) / archSeg;
      pts.push([axle + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const nose = 0.06;
  const cabPts: P2[] = [
    [p.xFront - bs - nose, p.rockerY + bs + 0.04],
    [p.xFront - bs - nose * 2, p.rockerY + bs],
  ];
  cabArch(p.axleF, p.wheelRF, cabPts);
  cabPts.push([bedStartX + bs, p.rockerY + bs]);
  cabPts.push([bedStartX + bs, p.beltY - bs]);
  cabPts.push([p.cowlX, p.beltY - bs]);
  cabPts.push([p.cowlX + (p.xFront - p.cowlX) * 0.35, p.hoodY - bs - 0.01]);
  cabPts.push([p.cowlX + (p.xFront - p.cowlX) * 0.75, (p.hoodY + p.noseY) / 2 - bs]);
  cabPts.push([p.xFront - bs - 0.02, p.noseY - bs]);
  cabPts.push([p.xFront - bs, p.noseY - bs - 0.1]);

  const cabShape = new Shape(cabPts.map(([x, y]) => new Vector2(x, y)));
  const cabDepth = Math.max(0.2, p.halfWidth * 2 - bevel * 2);
  const cabGeo = new ExtrudeGeometry(cabShape, {
    depth: cabDepth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bs,
    bevelSegments: ctx.lod === 'high' ? 4 : 2,
    curveSegments: 8,
  });
  cabGeo.translate(0, 0, -cabDepth / 2);
  grp.add(mesh(toCreasedNormals(cabGeo, (20 * Math.PI) / 180), ctx.materials.paint(paint)));

  // 2. Laterales del platon (de bedStartX a xRear, con paso de rueda trasero)
  const bedPts: P2[] = [
    [bedStartX - bs, p.rockerY + bs],
  ];
  cabArch(p.axleR, p.wheelRR, bedPts);
  bedPts.push([p.xRear + bs + nose * 1.5, p.rockerY + bs]);
  bedPts.push([p.xRear + bs + nose * 0.4, p.rockerY + bs + 0.05]);
  bedPts.push([p.xRear + bs, p.tailY - bs - 0.08]);
  bedPts.push([p.xRear + bs + 0.03, p.tailY - bs]);
  bedPts.push([bedStartX - bs, p.beltY - bs]);

  const bedShape = new Shape(bedPts.map(([x, y]) => new Vector2(x, y)));
  const wallDepth = 0.05;
  for (const s of [1, -1]) {
    const wallGeo = new ExtrudeGeometry(bedShape, {
      depth: wallDepth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bs,
      bevelSegments: ctx.lod === 'high' ? 3 : 2,
      curveSegments: 8,
    });
    // Alinear la cara exterior exactamente con ±p.halfWidth
    const zOffset = s > 0 ? p.halfWidth - wallDepth - bevel : -p.halfWidth + bevel;
    wallGeo.translate(0, 0, zOffset);
    grp.add(mesh(toCreasedNormals(wallGeo, (20 * Math.PI) / 180), ctx.materials.paint(paint)));
  }

  // 3. Piso del platon (oscuro, plastico texturizado)
  const bedLen = Math.abs(bedStartX - p.xRear) - 0.08;
  const bedWidth = p.halfWidth * 2 - 0.20;
  const floorPts: LoftSection[] = [
    { x: bedStartX - 0.02, ring: bodySection({ halfWidthBottom: bedWidth / 2, halfWidthTop: bedWidth / 2, yBottom: bedFloorY - 0.04, yTop: bedFloorY, n: 4, points: 16 }) },
    { x: p.xRear + 0.04, ring: bodySection({ halfWidthBottom: bedWidth / 2, halfWidthTop: bedWidth / 2, yBottom: bedFloorY - 0.04, yTop: bedFloorY, n: 4, points: 16 }) },
  ];
  grp.add(mesh(loft(floorPts), ctx.materials.plastic('textured')));

  // 4. Compuerta trasera del platon (pintada, al ras de la cola)
  const gatePts: LoftSection[] = [
    { x: p.xRear + 0.06, ring: bodySection({ halfWidthBottom: bedWidth / 2, halfWidthTop: bedWidth / 2, yBottom: bedFloorY, yTop: p.tailY - 0.01, n: 4, points: 16 }) },
    { x: p.xRear + 0.01, ring: bodySection({ halfWidthBottom: bedWidth / 2, halfWidthTop: bedWidth / 2, yBottom: bedFloorY, yTop: p.tailY - 0.01, n: 4, points: 16 }) },
  ];
  grp.add(mesh(loft(gatePts), ctx.materials.paint(paint)));

  return grp;
}

/**
 * Carroceria baja pintada (todo lo que esta bajo la cintura).
 *
 * El contorno se encoge lo que mide el bisel antes de extruir: ExtrudeGeometry lo
 * expande hacia afuera, y sin compensar el largo y el alto se pasan ~2 × bisel de la
 * ficha. Las normales se recalculan con pliegue (toCreasedNormals): los costados quedan
 * planos y limpios (sin estrias) y el bisel se ve como un chaflan de superficie dura.
 */
export function buildLowerBody(p: CarProfile, ctx: TemplateContext, paint: PaintSpec): Group {
  if (p.bedStartX !== undefined) {
    return buildPickupLowerBody(p, ctx, paint);
  }
  const grp = new Group();
  const bevel = ctx.lod === 'high' ? 0.07 : 0.055;
  const bs = bevel * 0.9;
  const inner: CarProfile = {
    ...p,
    xFront: p.xFront - bs,
    xRear: p.xRear + bs,
    rockerY: p.rockerY + bs,
    noseY: p.noseY - bs,
    tailY: p.tailY - bs,
    hoodY: p.hoodY - bs,
    beltY: p.beltY - bs,
  };
  const shape = new Shape(sideOutline(inner, (p.archGap ?? 0.035) + bs, ctx.lod === 'high' ? 14 : 8).map(([x, y]) => new Vector2(x, y)));
  const depth = Math.max(0.2, p.halfWidth * 2 - bevel * 2);
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bs,
    bevelSegments: ctx.lod === 'high' ? 4 : 2,
    curveSegments: 8,
  });
  g.translate(0, 0, -depth / 2);
  grp.add(mesh(toCreasedNormals(g, (20 * Math.PI) / 180), ctx.materials.paint(paint)));
  return grp;
}

/** Altura del techo del invernadero en una x (parabrisas → techo → luneta). */
function greenhouseTop(p: CarProfile, x: number): number {
  if (x >= p.roofFrontX) {
    const t = (x - p.roofFrontX) / Math.max(0.01, p.cowlX - p.roofFrontX);
    return p.roofY - (p.roofY - p.beltY) * smooth(Math.min(1, t));
  }
  if (x <= p.roofRearX) {
    const t = (p.roofRearX - x) / Math.max(0.005, p.roofRearX - p.backlightX);
    return p.roofY - (p.roofY - p.beltY) * smooth(Math.min(1, t));
  }
  // Techo con una leve curva.
  const mid = (p.roofFrontX + p.roofRearX) / 2;
  const half = Math.max(0.01, (p.roofFrontX - p.roofRearX) / 2);
  return p.roofY + 0.015 * (1 - ((x - mid) / half) ** 2);
}

function greenhouseSections(p: CarProfile, n: number, points: number, inflate = 0, yBottomOverride?: number): LoftSection[] {
  const out: LoftSection[] = [];
  for (let k = 0; k <= n; k++) {
    const x = p.cowlX - ((p.cowlX - p.backlightX) * k) / n;
    const top = Math.max(greenhouseTop(p, x), p.beltY + 0.02) + inflate;
    const wBottom = p.halfWidth * 0.9 * planTaper(p, x) + inflate;
    out.push({
      x,
      ring: bodySection({
        halfWidthBottom: wBottom,
        halfWidthTop: wBottom * 0.74,
        yBottom: yBottomOverride ?? p.beltY - 0.03,
        yTop: top,
        n: 5,
        points,
      }),
    });
  }
  return out;
}

export interface GreenhouseParts {
  glass: Group;
  /** Techo y pilares pintados (van en la ranura `body`). */
  roof: Group;
}

/** Invernadero: vidrio oscuro + techo y pilares A/B/C pintados encima. */
export function buildGreenhouse(
  p: CarProfile,
  ctx: TemplateContext,
  paint: PaintSpec,
  opts: { bPillars?: number[]; verticalRear?: boolean } = {},
): GreenhouseParts {
  const n = ctx.lod === 'high' ? 14 : 8;
  const pts = ctx.lod === 'high' ? 28 : 16;
  const glass = new Group();
  glass.add(mesh(loft(greenhouseSections(p, n, pts)), ctx.materials.glass('tinted')));

  const roof = new Group();
  const paintMat = ctx.materials.paint(paint);
  // Techo: el mismo loft, inflado 1 cm y recortado a la franja alta.
  const roofSecs: LoftSection[] = [];
  const steps = ctx.lod === 'high' ? 8 : 4;
  for (let k = 0; k <= steps; k++) {
    const x = p.roofFrontX + 0.05 - ((p.roofFrontX - p.roofRearX + 0.1) * k) / steps;
    const top = greenhouseTop(p, x) + 0.012;
    const w = p.halfWidth * 0.9 * planTaper(p, x) * 0.74 + 0.03;
    roofSecs.push({ x, ring: bodySection({ halfWidthBottom: w, halfWidthTop: w * 0.92, yBottom: top - 0.07, yTop: top, n: 6, points: pts }) });
  }
  roof.add(mesh(loft(roofSecs), paintMat));

  // Pilares: tubos pintados por los bordes del vidrio.
  const r = 0.03;
  const isVertical = opts.verticalRear || p.verticalRear;
  for (const s of [1, -1]) {
    const edge = (x: number, y: number): [number, number, number] => {
      const wB = p.halfWidth * 0.9 * planTaper(p, x);
      const h = (y - (p.beltY - 0.03)) / Math.max(0.01, greenhouseTop(p, x) - (p.beltY - 0.03));
      return [x, y, s * (wB + (wB * 0.74 - wB) * h + 0.004)];
    };
    // A: base del parabrisas → inicio del techo.
    roof.add(mesh(tube([edge(p.cowlX - 0.02, p.beltY), edge((p.cowlX + p.roofFrontX) / 2, (p.beltY + p.roofY) / 2 + 0.03), edge(p.roofFrontX, p.roofY - 0.01)], r, { radial: 8, segments: 12 }), paintMat));
    // C: fin del techo → base de la luneta.
    if (isVertical) {
      roof.add(mesh(tube([edge(p.roofRearX, p.roofY - 0.01), edge(p.backlightX, p.beltY)], r * 1.3, { radial: 8, segments: 6 }), paintMat));
    } else {
      roof.add(mesh(tube([edge(p.roofRearX, p.roofY - 0.01), edge((p.roofRearX + p.backlightX) / 2, (p.beltY + p.roofY) / 2 + 0.03), edge(p.backlightX + 0.02, p.beltY)], r * 1.4, { radial: 8, segments: 12 }), paintMat));
    }
    // B (y otros): verticales.
    for (const bx of opts.bPillars ?? [(p.roofFrontX + p.roofRearX) / 2]) {
      roof.add(mesh(tube([edge(bx, p.beltY), edge(bx - 0.03, greenhouseTop(p, bx) - 0.02)], r * 1.2, { radial: 8, segments: 4 }), paintMat));
    }
  }
  return { glass, roof };
}

/** Perfil tipico de sedan a partir de las medidas reales (todas en metros). */
export function sedanProfile(
  o: { length: number; height: number; width: number; wheelbase: number; wheelRF: number; wheelRR: number; clearance?: number },
  shape: { roofSlope?: number; hoodLength?: number; beltLine?: number } = {},
): CarProfile {
  const L = o.length;
  const H = o.height;
  const frontOverhang = (L - o.wheelbase) * 0.54;
  const xFront = o.wheelbase / 2 + frontOverhang;
  const xRear = xFront - L;
  const hood = shape.hoodLength ?? 0.5;
  const belt = shape.beltLine ?? 0.5;
  const slope = shape.roofSlope ?? 0.5;
  const beltY = H * (0.6 + 0.06 * belt);
  const cowlX = o.wheelbase / 2 - 0.15 - hood * 0.35;
  return {
    xFront,
    xRear,
    axleF: o.wheelbase / 2,
    axleR: -o.wheelbase / 2,
    wheelRF: o.wheelRF,
    wheelRR: o.wheelRR,
    rockerY: o.clearance ?? 0.16,
    noseY: H * 0.47,
    tailY: beltY + 0.02,
    hoodY: beltY - 0.04,
    beltY,
    // El techo del invernadero sube ~3 cm sobre roofY (curva + techo pintado).
    roofY: H - 0.03,
    cowlX,
    roofFrontX: cowlX - 0.7 - 0.15 * slope,
    roofRearX: -o.wheelbase / 2 + 0.55 - 0.2 * slope,
    backlightX: -o.wheelbase / 2 - 0.05 - 0.35 * (1 - slope),
    halfWidth: o.width / 2,
  };
}

/** Perfil tipico de hatchback: voladizo trasero corto, luneta casi vertical que termina en la cola, cola alta. */
export function hatchbackProfile(
  o: { length: number; height: number; width: number; wheelbase: number; wheelRF: number; wheelRR: number; clearance?: number },
  shape: { roofSlope?: number; hoodLength?: number; beltLine?: number } = {},
): CarProfile {
  const L = o.length;
  const H = o.height;
  const overhangTotal = L - o.wheelbase;
  const frontOverhang = overhangTotal * 0.60;
  const xFront = o.wheelbase / 2 + frontOverhang;
  const xRear = xFront - L;
  const hood = shape.hoodLength ?? 0.5;
  const belt = shape.beltLine ?? 0.5;
  const slope = shape.roofSlope ?? 0.5;
  const beltY = H * (0.61 + 0.05 * belt);
  const cowlX = o.wheelbase / 2 - 0.12 - hood * 0.28;
  return {
    xFront,
    xRear,
    axleF: o.wheelbase / 2,
    axleR: -o.wheelbase / 2,
    wheelRF: o.wheelRF,
    wheelRR: o.wheelRR,
    rockerY: o.clearance ?? 0.15,
    noseY: H * 0.47,
    tailY: beltY + 0.04, // cola alta
    hoodY: beltY - 0.04,
    beltY,
    roofY: H - 0.03,
    cowlX,
    roofFrontX: cowlX - 0.55 - 0.10 * slope,
    roofRearX: xRear + 0.38 - 0.08 * slope, // techo largo hasta casi atras
    backlightX: xRear + 0.15 + 0.04 * (1 - slope), // luneta casi vertical
    halfWidth: o.width / 2,
  };
}

/** Perfil tipico de SUV: rocker y cintura mas altos, techo largo hasta atras, porton casi vertical, pasos de rueda mas grandes. */
export function suvProfile(
  o: { length: number; height: number; width: number; wheelbase: number; wheelRF: number; wheelRR: number; clearance?: number },
  shape: { roofSlope?: number; hoodLength?: number; beltLine?: number } = {},
): CarProfile {
  const L = o.length;
  const H = o.height;
  const overhangTotal = L - o.wheelbase;
  const frontOverhang = overhangTotal * 0.50;
  const xFront = o.wheelbase / 2 + frontOverhang;
  const xRear = xFront - L;
  const hood = shape.hoodLength ?? 0.5;
  const belt = shape.beltLine ?? 0.5;
  const slope = shape.roofSlope ?? 0.5;
  const beltY = H * (0.62 + 0.04 * belt); // cintura mas alta
  const cowlX = o.wheelbase / 2 - 0.18 - hood * 0.28;
  return {
    xFront,
    xRear,
    axleF: o.wheelbase / 2,
    axleR: -o.wheelbase / 2,
    wheelRF: o.wheelRF,
    wheelRR: o.wheelRR,
    rockerY: o.clearance ?? 0.20, // rocker mas alto
    noseY: H * 0.50,
    tailY: beltY + 0.03,
    hoodY: beltY - 0.03,
    beltY,
    roofY: H - 0.03,
    cowlX,
    roofFrontX: cowlX - 0.60 - 0.10 * slope,
    roofRearX: xRear + 0.28 - 0.06 * slope, // techo largo hasta atras
    backlightX: xRear + 0.10 + 0.04 * (1 - slope), // porton casi vertical
    halfWidth: o.width / 2,
    archGap: 0.055, // pasos de rueda mas grandes
  };
}

/** Perfil tipico de pickup: invernadero SOLO sobre la cabina doble, platon detras con paredes a la cintura y piso oscuro. */
export function pickupProfile(
  o: { length: number; height: number; width: number; wheelbase: number; wheelRF: number; wheelRR: number; clearance?: number },
  shape: { roofSlope?: number; hoodLength?: number; beltLine?: number; bedLength?: number } = {},
): CarProfile {
  const L = o.length;
  const H = o.height;
  const frontOverhang = (L - o.wheelbase) * 0.42;
  const xFront = o.wheelbase / 2 + frontOverhang;
  const xRear = xFront - L;
  const hood = shape.hoodLength ?? 0.5;
  const belt = shape.beltLine ?? 0.5;
  const bedRatio = shape.bedLength ?? 0.5;
  const beltY = H * (0.58 + 0.04 * belt);
  const cowlX = o.wheelbase / 2 - 0.20 - hood * 0.22;
  // Doble cabina: termina alrededor de x = -0.15 m
  const cabRearX = -0.15 - (0.5 - bedRatio) * 0.20;
  return {
    xFront,
    xRear,
    axleF: o.wheelbase / 2,
    axleR: -o.wheelbase / 2,
    wheelRF: o.wheelRF,
    wheelRR: o.wheelRR,
    rockerY: o.clearance ?? 0.22,
    noseY: H * 0.52,
    tailY: beltY, // paredes a la altura de la cintura
    hoodY: beltY - 0.03,
    beltY,
    roofY: H - 0.03,
    cowlX,
    roofFrontX: cowlX - 0.65,
    roofRearX: cabRearX + 0.04, // techo solo sobre cabina
    backlightX: cabRearX,       // luneta vertical
    halfWidth: o.width / 2,
    archGap: 0.05,
    verticalRear: true,
    bedStartX: cabRearX,
    bedFloorY: (o.clearance ?? 0.22) + 0.16,
  };
}

/** Perfil tipico de van: cabina corta con parabrisas inclinado y cuerpo de carga alto pintado detras del pilar B. */
export function vanProfile(
  o: { length: number; height: number; width: number; wheelbase: number; wheelRF: number; wheelRR: number; clearance?: number },
  shape: { hoodLength?: number; beltLine?: number } = {},
): CarProfile {
  const L = o.length;
  const H = o.height;
  const frontOverhang = (L - o.wheelbase) * 0.44;
  const xFront = o.wheelbase / 2 + frontOverhang;
  const xRear = xFront - L;
  const hood = shape.hoodLength ?? 0.5;
  const belt = shape.beltLine ?? 0.5;
  const beltY = H * (0.46 + 0.04 * belt); // altura de ventanilla de cabina
  // Trompa corta, parabrisas inclinado
  const cowlX = o.wheelbase / 2 + 0.18 - hood * 0.15;
  // Detras del pilar B termina la cabina y la carroceria sube al techo
  const xB = o.wheelbase / 2 - 0.65;
  return {
    xFront,
    xRear,
    axleF: o.wheelbase / 2,
    axleR: -o.wheelbase / 2,
    wheelRF: o.wheelRF,
    wheelRR: o.wheelRR,
    rockerY: o.clearance ?? 0.18,
    noseY: H * 0.38,
    tailY: beltY + 0.05,
    hoodY: beltY - 0.04,
    beltY,
    roofY: H - 0.03,
    cowlX,
    roofFrontX: cowlX - 0.55,
    roofRearX: xB,
    backlightX: xB,
    halfWidth: o.width / 2,
    highRoofBehindX: xB, // cuerpo de carga sube al techo detras del pilar B
    verticalRear: true,
  };
}
