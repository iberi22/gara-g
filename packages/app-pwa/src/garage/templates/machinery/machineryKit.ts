/**
 * machineryKit.ts — Piezas comunes de la maquinaria amarilla (familia 'machinery').
 *
 * Herramientas de construccion que comparten excavadora, retroexcavadora, cargador,
 * bulldozer, motoniveladora y vibrocompactador:
 *   - trackAssembly()   oruga completa: cadena con zapatas, rueda guia, sprocket y rodillos.
 *   - hydCylinder()     cilindro hidraulico entre dos pines (camisa + vastago cromado).
 *   - beam()            viga de seccion variable por una polilinea (pluma, brazo, chasis).
 *   - bucket()          balde visto de lado con dientes.
 *   - ropsCab()         cabina ROPS: postes, techo, vidrios por los cuatro lados, baliza.
 *   - powerPack()       motor y todo lo interno (aceite, filtros, bateria, bomba
 *                       hidraulica, aceite hidraulico) bajo su capot, con escape y prefiltro.
 *   - otrWheel()        llanta de obra (OTR) con tacos en V.
 *
 * Las plantillas arman su maquina con estas piezas en un MachineBuild y llaman
 * finishMachine(), que fusiona por material como los camiones (collapse.ts).
 *
 * Convenciones del espacio 3D: las de contracts.ts (frente a +X, izquierda a +Z, suelo y = 0).
 */
import { Box3, BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Path, Shape, Vector2, Vector3, type Object3D } from 'three/webgpu';
import type { BuiltVehicle, PartSlotId, TemplateContext, TireSize, VehicleSpec } from '../../contracts';
import { collapseParts } from '../common/collapse';
import { countTriangles, extrudeProfile, mesh, roundedBox, type P2, type P3 } from '../common/geometry';
import { mm } from '../common/units';
import { buildWheel, placeWheel } from '../common/wheel';

export const MACHINE_YELLOW = '#f2b200';

export interface MachineBuild {
  root: Group;
  parts: Map<PartSlotId, Object3D>;
  focusPoints: Record<PartSlotId, P3>;
  spec: VehicleSpec;
  ctx: TemplateContext;
}

export function startMachine(spec: VehicleSpec, ctx: TemplateContext, id: string): MachineBuild {
  const root = new Group();
  root.name = `vehicle:${id}`;
  return { root, parts: new Map(), focusPoints: {}, spec, ctx };
}

export function addTo(b: MachineBuild, slot: PartSlotId, children: Object3D[], focus?: P3): void {
  let g = b.parts.get(slot) as Group | undefined;
  if (!g) {
    g = new Group();
    g.name = `part:${slot}`;
    b.parts.set(slot, g);
  }
  for (const c of children) g.add(c);
  if (focus) b.focusPoints[slot] = focus;
}

export function finishMachine(b: MachineBuild): BuiltVehicle {
  const collapsed = collapseParts(b.parts);
  for (const g of collapsed.values()) b.root.add(g);
  return { root: b.root, parts: collapsed, focusPoints: b.focusPoints, triangles: countTriangles(b.root) };
}

const low = (ctx: TemplateContext): boolean => ctx.lod === 'low';

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

export function box(w: number, h: number, d: number, material: unknown, at: P3, rotZ = 0): ReturnType<typeof mesh> {
  const m = mesh(new BoxGeometry(w, h, d), material, at);
  if (rotZ) m.rotation.z = rotZ;
  return m;
}

export function rbox(ctx: TemplateContext, w: number, h: number, d: number, r: number, material: unknown, at: P3): ReturnType<typeof mesh> {
  return mesh(roundedBox(w, h, d, r, low(ctx) ? 1 : 2), material, at);
}

/** Cilindro con eje en Z (pines, rodillos, tambores). */
export function cylZ(r: number, len: number, material: unknown, at: P3, seg = 20): ReturnType<typeof mesh> {
  const g = new CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return mesh(g, material, at);
}

export function cylY(r: number, len: number, material: unknown, at: P3, seg = 16): ReturnType<typeof mesh> {
  return mesh(new CylinderGeometry(r, r, len, seg), material, at);
}

/** Cilindro entre dos puntos cualesquiera. */
export function rod(a: P3, b: P3, r: number, material: unknown, seg = 12): ReturnType<typeof mesh> {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const m = mesh(new CylinderGeometry(r, r, len, seg), material, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  return m;
}

/** Perfil lateral (x, y) extruido en Z y centrado en `z`. */
export function plate(ctx: TemplateContext, profile: P2[], depth: number, z: number, material: unknown, bevel = 0.025): ReturnType<typeof mesh> {
  const m = mesh(extrudeProfile(profile, { depth, bevel, bevelSegments: low(ctx) ? 1 : 2, curveSegments: 6 }), material);
  m.position.z = z;
  return m;
}

/** Puntos de un arco. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hidraulica y estructura
// ---------------------------------------------------------------------------

/**
 * Cilindro hidraulico del pin `a` (lado de la camisa) al pin `b` (lado del vastago).
 * La camisa ocupa el 55 % del largo; el resto es vastago cromado.
 */
export function hydCylinder(ctx: TemplateContext, a: P3, b: P3, r: number): Object3D[] {
  const kit = ctx.materials;
  const seg = low(ctx) ? 8 : 14;
  const split = 0.55;
  const mid: P3 = [a[0] + (b[0] - a[0]) * split, a[1] + (b[1] - a[1]) * split, a[2] + (b[2] - a[2]) * split];
  return [
    rod(a, mid, r, kit.metal('dark'), seg),
    rod(mid, b, r * 0.55, kit.chrome(), seg),
    cylZ(r * 0.75, r * 2.4, kit.metal('steel'), a, seg),
    cylZ(r * 0.75, r * 2.4, kit.metal('steel'), b, seg),
  ];
}

/**
 * Viga de seccion variable por una polilinea (x, y): pluma, brazo, chasis de cuello.
 * `thick[i]` es el peralte en el punto i. Devuelve el perfil cerrado para plate().
 */
export function beamProfile(points: P2[], thick: number[]): P2[] {
  const upper: P2[] = [];
  const lower: P2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const h = thick[i] / 2;
    upper.push([points[i][0] + nx * h, points[i][1] + ny * h]);
    lower.push([points[i][0] - nx * h, points[i][1] - ny * h]);
  }
  return [...upper, ...lower.reverse()];
}

/**
 * Balde visto de lado con el pin en `pin` (x, y). `facing` = +1 si la boca mira al
 * frente (+X, cargador), -1 si mira hacia la maquina (excavadora recogida).
 * Devuelve la concha y los dientes (y una barra de pines en el pin).
 */
export function bucket(
  ctx: TemplateContext,
  pin: P2,
  size: number,
  width: number,
  facing: 1 | -1,
  material: unknown,
  rotation = 0,
): Object3D[] {
  const kit = ctx.materials;
  const s = size;
  // Perfil de la concha relativo al pin, con la boca hacia +X: espalda curva, piso y labio.
  const local: P2[] = [
    [0, 0],
    [-0.35 * s, -0.12 * s],
    ...arc(-0.25 * s, -0.55 * s, 0.45 * s, Math.PI * 0.9, Math.PI * 1.55, low(ctx) ? 5 : 10),
    [0.75 * s, -1.0 * s],
    [0.85 * s, -0.94 * s],
    [0.15 * s, -0.08 * s],
  ];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const xf = (p: P2): P2 => {
    const x = p[0] * facing;
    return [pin[0] + x * cos - p[1] * sin, pin[1] + x * sin + p[1] * cos];
  };
  const out: Object3D[] = [plate(ctx, local.map(xf), width, 0, material, 0.02)];
  // Dientes en el labio.
  const lip = xf([0.86 * s, -0.97 * s]);
  const teeth = low(ctx) ? 3 : 5;
  const toothDir = Math.atan2(xf([1, -1.02])[1] - xf([0, -1])[1], xf([1, -1.02])[0] - xf([0, -1])[0]);
  for (let i = 0; i < teeth; i++) {
    const z = -width / 2 + 0.1 + ((width - 0.2) * i) / Math.max(1, teeth - 1);
    const t = box(0.16 * s + 0.05, 0.06, 0.08, kit.metal('dark'), [lip[0] + Math.cos(toothDir) * 0.06, lip[1] + Math.sin(toothDir) * 0.06, z], toothDir);
    out.push(t);
  }
  out.push(cylZ(0.06, width - 0.06, kit.metal('steel'), [pin[0], pin[1], 0], 12));
  return out;
}

/**
 * Balde apoyado en el suelo: lo construye, mide cuanto baja de y = 0 y sube el pin lo
 * justo para que el punto mas bajo (labio o dientes) toque el suelo. Devuelve el pin
 * final para que el brazo o los brazos de cargue lleguen a el.
 */
export function groundedBucket(
  ctx: TemplateContext,
  pinX: number,
  size: number,
  width: number,
  facing: 1 | -1,
  material: unknown,
  rotation = 0,
): { pin: P2; parts: Object3D[] } {
  const trial = bucket(ctx, [pinX, 0], size, width, facing, material, rotation);
  const g = new Group();
  for (const o of trial) g.add(o);
  const minY = new Box3().setFromObject(g).min.y;
  const pin: P2 = [pinX, -minY];
  return { pin, parts: bucket(ctx, pin, size, width, facing, material, rotation) };
}

// ---------------------------------------------------------------------------
// Tren de rodaje
// ---------------------------------------------------------------------------

export interface TrackOpts {
  /** Largo total de la oruga (m). */
  length: number;
  /** Alto total de la oruga (m). */
  height: number;
  /** Ancho de zapata (m). */
  shoe: number;
  /** Centro de la oruga en Z. */
  z: number;
  /** Centro en X. */
  x?: number;
}

/**
 * Oruga de una sola pieza: cadena (anillo tipo estadio) con zapatas, rueda guia
 * delante, sprocket dentado atras, rodillos inferiores y superiores y bastidor.
 */
export function trackAssembly(ctx: TemplateContext, o: TrackOpts): { track: Object3D[]; frame: Object3D[]; drive: Object3D[] } {
  const kit = ctx.materials;
  const lo = low(ctx);
  const grip = 0.035; // alto de la garra de la zapata
  const r = o.height / 2 - grip; // radio del anillo de la cadena
  const cy = grip + r; // altura de los centros de rueda guia y sprocket
  const cx = o.x ?? 0;
  const half = o.length / 2 - r - grip;
  const thick = 0.1;
  const steel = kit.metal('dark');

  // Cadena: estadio exterior con agujero del mismo estadio reducido.
  const seg = lo ? 10 : 18;
  const stadium = (rad: number): Vector2[] => [
    ...arc(cx + half, cy, rad, -Math.PI / 2, Math.PI / 2, seg),
    ...arc(cx - half, cy, rad, Math.PI / 2, Math.PI * 1.5, seg),
  ].map(([x, y]) => new Vector2(x, y));
  const shape = new Shape(stadium(r));
  shape.holes.push(new Path(stadium(r - thick).reverse()));
  const g = new ExtrudeGeometry(shape, { depth: o.shoe, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -o.shoe / 2);
  const chain = mesh(g, steel);
  chain.position.z = o.z;
  const track: Object3D[] = [chain];

  // Zapatas con garra: barras transversales por todo el perimetro, por fuera del anillo
  // (las de abajo tocan el suelo en y = 0).
  const pitch = lo ? 0.32 : 0.2;
  const perimeter = 4 * half + 2 * Math.PI * r;
  const count = Math.floor(perimeter / pitch);
  const rg = r + grip / 2;
  for (let i = 0; i < count; i++) {
    const s = (i / count) * perimeter;
    let x: number;
    let y: number;
    let ang = 0;
    if (s < 2 * half) {
      x = cx + half - s;
      y = cy - rg;
    } else if (s < 2 * half + Math.PI * r) {
      const a = Math.PI * 1.5 - (s - 2 * half) / r;
      x = cx - half + Math.cos(a) * rg;
      y = cy + Math.sin(a) * rg;
      ang = a + Math.PI / 2;
    } else if (s < 4 * half + Math.PI * r) {
      x = cx - half + (s - 2 * half - Math.PI * r);
      y = cy + rg;
    } else {
      const a = Math.PI / 2 - (s - 4 * half - Math.PI * r) / r;
      x = cx + half + Math.cos(a) * rg;
      y = cy + Math.sin(a) * rg;
      ang = a + Math.PI / 2;
    }
    track.push(box(0.05, grip, o.shoe, steel, [x, y, o.z], ang));
  }

  // Rueda guia (delante) y sprocket (atras) con dientes.
  const rr = r - thick - 0.01;
  track.push(cylZ(rr, o.shoe * 0.7, kit.metal('steel'), [cx + half, cy, o.z], lo ? 12 : 24));
  track.push(cylZ(rr * 0.95, o.shoe * 0.75, kit.metal('dark'), [cx - half, cy, o.z], lo ? 10 : 20));
  if (!lo) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      track.push(box(0.06, 0.06, o.shoe * 0.5, kit.metal('dark'), [cx - half + Math.cos(a) * rr, cy + Math.sin(a) * rr, o.z], a));
    }
  }
  // Rodillos inferiores y superiores.
  const rollers = lo ? 4 : 7;
  for (let i = 0; i < rollers; i++) {
    const x = cx + half - r * 0.9 - ((2 * half - r * 1.8) * i) / Math.max(1, rollers - 1);
    track.push(cylZ(0.085, o.shoe * 0.6, kit.metal('steel'), [x, grip + thick + 0.085, o.z], lo ? 8 : 14));
  }
  for (const f of [0.3, -0.3]) track.push(cylZ(0.07, o.shoe * 0.5, kit.metal('steel'), [cx + half * f, cy + r - thick - 0.07, o.z], lo ? 8 : 12));

  // Bastidor de la oruga: viga entre rueda guia y sprocket.
  const frame: Object3D[] = [box(2 * half - 0.2, r * 0.75, o.shoe * 0.55, steel, [cx, cy, o.z])];
  // Mando final: el motor hidraulico del sprocket hacia dentro.
  const drive: Object3D[] = [cylZ(rr * 0.7, 0.25, kit.metal('steel'), [cx - half, cy, o.z - Math.sign(o.z) * (o.shoe / 2 + 0.1)], lo ? 10 : 18)];
  return { track, frame, drive };
}

// ---------------------------------------------------------------------------
// Llanta de obra
// ---------------------------------------------------------------------------

/** Llanta OTR: rin de acero pintado y banda con tacos en V. Devuelve tire/rim para las ranuras. */
export function otrWheel(ctx: TemplateContext, spec: VehicleSpec, tire: TireSize, at: P3, side: 1 | -1): { tire: Object3D[]; rim: Object3D[]; radius: number } {
  const kit = ctx.materials;
  const w = buildWheel({ tire, family: 'heavy', style: 'disc', paint: { ...spec.paint, baseColor: spec.paint.baseColor }, side, rear: true }, ctx);
  placeWheel(w, at, [w.tire, w.rim]);
  const lugs: Object3D[] = [w.tire];
  const n = low(ctx) ? 14 : 22;
  const width = mm(tire.widthMm);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const s of [1, -1]) {
      const lug = box(0.09, 0.05, width * 0.42, kit.rubber(), [
        at[0] + Math.cos(a) * (w.radius - 0.026),
        at[1] + Math.sin(a) * (w.radius - 0.026),
        at[2] + s * width * 0.24,
      ]);
      // Primero se gira sobre el eje radial (diagonal de la V), luego se lleva a su angulo.
      lug.rotation.set(0, s * 0.45, a + Math.PI / 2, 'ZYX');
      lugs.push(lug);
    }
  }
  return { tire: lugs, rim: [w.rim], radius: w.radius };
}

/** Pone una llanta OTR en la ranura `tire_<tag>` / `rim_<tag>` (se pueden acumular varias). */
export function addWheel(b: MachineBuild, tag: 'fl' | 'fr' | 'rl' | 'rr', tire: TireSize, at: P3): number {
  const side: 1 | -1 = at[2] >= 0 ? 1 : -1;
  const w = otrWheel(b.ctx, b.spec, tire, at, side);
  addTo(b, `tire_${tag}`, w.tire, at);
  addTo(b, `rim_${tag}`, w.rim, at);
  return w.radius;
}

/** Guardabarros en arco sobre una rueda (banda de `a0` a `a1` radianes, vista lateral). */
export function fenderArch(ctx: TemplateContext, cx: number, cy: number, r: number, thick: number, width: number, z: number, material: unknown, a0 = 0.15, a1 = Math.PI - 0.15): ReturnType<typeof mesh> {
  const n = low(ctx) ? 8 : 16;
  const outer = arc(cx, cy, r + thick, a0, a1, n);
  const inner = arc(cx, cy, r, a1, a0, n);
  return plate(ctx, [...outer, ...inner], width, z, material, 0.015);
}

/** Radio exterior de una llanta (m) sin construirla. */
export function tireRadiusM(t: TireSize): number {
  return mm((t.rimIn * 25.4) / 2 + (t.widthMm * t.aspectPct) / 100);
}

// ---------------------------------------------------------------------------
// Cabina y motor
// ---------------------------------------------------------------------------

export interface CabOpts {
  /** Caja de la cabina (m); y1 incluye la baliza y las luces del techo. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  /** Lado de la puerta: +1 izquierda. */
  doorSide?: 1 | -1;
}

/** Cabina ROPS: postes de color de la maquina, techo, vidrio alrededor, baliza y luces. */
export function ropsCab(b: MachineBuild, o: CabOpts): void {
  const { ctx, spec } = b;
  const kit = ctx.materials;
  // y1 es lo mas alto de la maquina (con baliza y luces); el techo queda 13 cm abajo.
  const y1 = o.y1 - 0.13;
  const paint = kit.paint(spec.paint);
  const dark = kit.plastic('black');
  const glass = kit.glass('tinted');
  const post = 0.07;
  const w = o.x1 - o.x0;
  const d = o.z1 - o.z0;
  const h = y1 - o.y0;
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  const roofT = 0.09;
  const glassTop = y1 - roofT;
  const sill = o.y0 + h * 0.22;

  const cab: Object3D[] = [
    // Base cerrada (hasta la cintura) y techo con alero.
    box(w, sill - o.y0, d, paint, [cx, (o.y0 + sill) / 2, cz]),
    rbox(ctx, w + 0.1, roofT, d + 0.1, 0.03, paint, [cx, y1 - roofT / 2, cz]),
  ];
  for (const x of [o.x0 + post / 2, o.x1 - post / 2]) for (const z of [o.z0 + post / 2, o.z1 - post / 2]) cab.push(box(post, glassTop - sill, post, dark, [x, (sill + glassTop) / 2, z]));
  // Vidrios: frente (inclinado leve), costados y atras, con un travesano a media altura.
  const gh = glassTop - sill;
  cab.push(box(0.012, gh, d - post * 2, glass, [o.x1 - 0.004, sill + gh / 2, cz]));
  cab.push(box(0.012, gh * 0.8, d - post * 2, glass, [o.x0 + 0.004, sill + gh * 0.55, cz]));
  for (const z of [o.z0, o.z1]) cab.push(box(w - post * 2, gh, 0.012, glass, [cx, sill + gh / 2, z + (z === o.z0 ? 0.004 : -0.004)]));
  cab.push(box(0.03, 0.03, d, dark, [o.x1 - 0.01, sill + gh * 0.4, cz]));
  // Puerta: costura y manija.
  const dz = (o.doorSide ?? 1) === 1 ? o.z1 + 0.004 : o.z0 - 0.004;
  cab.push(box(0.025, gh + (sill - o.y0) - 0.1, 0.008, dark, [cx - w * 0.15, (o.y0 + glassTop) / 2, dz]));
  cab.push(box(0.12, 0.03, 0.025, kit.chrome(), [cx + w * 0.2, sill + 0.05, dz]));
  // Limpiaparabrisas.
  cab.push(box(0.01, gh * 0.55, 0.02, dark, [o.x1 + 0.012, sill + gh * 0.32, cz], 0.35));
  addTo(b, 'cab', cab, [cx, (o.y0 + y1) / 2, cz]);

  // Luces de trabajo en el techo (frente) y baliza ambar.
  const lights: Object3D[] = [];
  for (const z of [o.z0 + 0.15, o.z1 - 0.15]) {
    lights.push(rbox(ctx, 0.1, 0.1, 0.14, 0.02, dark, [o.x1 + 0.02, y1 + 0.02, z]));
    lights.push(box(0.012, 0.08, 0.11, kit.light('head'), [o.x1 + 0.072, y1 + 0.02, z]));
  }
  lights.push(cylY(0.07, 0.12, kit.light('turn'), [o.x0 + 0.2, y1 + 0.06, o.z1 - 0.2], 12));
  addTo(b, 'headlight', lights, [o.x1, y1, cz]);

  // Espejos en los postes delanteros.
  const mirrors: Object3D[] = [];
  for (const z of [o.z0 - 0.12, o.z1 + 0.12]) {
    mirrors.push(rod([o.x1 - 0.02, sill + gh * 0.8, z - Math.sign(z - cz) * 0.12], [o.x1 + 0.08, sill + gh * 0.8, z], 0.012, dark, 6));
    mirrors.push(rbox(ctx, 0.04, 0.22, 0.14, 0.015, dark, [o.x1 + 0.08, sill + gh * 0.8, z]));
  }
  addTo(b, 'mirrors', mirrors, [o.x1, sill + gh * 0.8, o.z1 + 0.12]);
}

export interface PowerPackOpts {
  /** Caja del compartimiento del motor. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  /** Capot redondeado (cargador, retro) o plano (excavadora). */
  rounded?: boolean;
  /** Donde va el tanque de combustible si no es dentro del capot. */
  fuelTankAt?: P3;
  fuelTankSize?: [number, number, number];
}

/**
 * Compartimiento del motor: capot con rejillas, escape y prefiltro arriba, y por dentro
 * motor, carter, filtros, bateria, bomba y tanque hidraulico (visibles en rayos X).
 */
export function powerPack(b: MachineBuild, o: PowerPackOpts): void {
  const { ctx, spec } = b;
  const kit = ctx.materials;
  const paint = kit.paint(spec.paint);
  const dark = kit.plastic('black');
  const w = o.x1 - o.x0;
  const h = o.y1 - o.y0;
  const d = o.z1 - o.z0;
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;

  const hood: Object3D[] = [rbox(ctx, w, h, d, o.rounded ? Math.min(0.18, h * 0.3) : 0.04, paint, [cx, o.y0 + h / 2, cz])];
  // Rejillas laterales.
  const slats = low(ctx) ? 3 : 6;
  for (const z of [o.z0 - 0.003, o.z1 + 0.003]) {
    for (let i = 0; i < slats; i++) hood.push(box(w * 0.35, 0.025, 0.01, dark, [o.x0 + w * 0.3, o.y0 + h * (0.3 + (0.45 * i) / slats), z]));
  }
  // Pasamanos sobre el capot.
  for (const z of [o.z0 + 0.06, o.z1 - 0.06]) {
    hood.push(rod([o.x0 + 0.1, o.y1, z], [o.x0 + 0.1, o.y1 + 0.18, z], 0.018, kit.metal('dark'), 6));
    hood.push(rod([o.x1 - 0.1, o.y1, z], [o.x1 - 0.1, o.y1 + 0.18, z], 0.018, kit.metal('dark'), 6));
    hood.push(rod([o.x0 + 0.1, o.y1 + 0.18, z], [o.x1 - 0.1, o.y1 + 0.18, z], 0.018, kit.metal('dark'), 6));
  }
  addTo(b, 'engine_hood', hood, [cx, o.y1, cz]);

  // Escape vertical y prefiltro de aire sobre el capot.
  const ex: P3 = [o.x0 + w * 0.65, o.y1, o.z0 + d * 0.3];
  addTo(
    b,
    'exhaust',
    [cylY(0.065, 0.55, kit.metal('dark'), [ex[0], ex[1] + 0.27, ex[2]], 12), cylY(0.09, 0.08, kit.metal('dark'), [ex[0], ex[1] + 0.04, ex[2]], 12)],
    [ex[0], ex[1] + 0.3, ex[2]],
  );
  const af: P3 = [o.x0 + w * 0.65, o.y1, o.z0 + d * 0.72];
  addTo(b, 'air_filter', [cylY(0.1, 0.3, kit.plastic('black'), [af[0], af[1] + 0.15, af[2]], 14), cylY(0.12, 0.05, kit.plastic('black'), [af[0], af[1] + 0.32, af[2]], 14)], [af[0], af[1] + 0.2, af[2]]);

  // Por dentro (ranuras internas: se ven en rayos X).
  const ey = o.y0 + h * 0.45;
  const ew = Math.min(w * 0.55, 1.1);
  addTo(
    b,
    'engine',
    [
      rbox(ctx, ew, h * 0.5, Math.min(d * 0.45, 0.65), 0.04, kit.metal('dark'), [cx, ey, cz]),
      box(ew * 0.92, h * 0.12, Math.min(d * 0.4, 0.55), kit.metal('aluminum'), [cx, ey + h * 0.3, cz]),
      box(0.08, h * 0.7, d * 0.8, kit.metal('dark'), [o.x0 + 0.1, o.y0 + h * 0.45, cz]),
    ],
    [cx, ey, cz],
  );
  addTo(b, 'engine_oil', [box(ew * 0.8, h * 0.12, Math.min(d * 0.4, 0.55), kit.metal('steel'), [cx, o.y0 + h * 0.12, cz])], [cx, o.y0 + h * 0.12, cz]);
  addTo(b, 'oil_filter', [cylY(0.06, 0.2, kit.accent(spec.paint), [cx + ew * 0.3, ey - h * 0.1, cz + d * 0.3], 12)], [cx + ew * 0.3, ey, cz + d * 0.3]);
  addTo(b, 'fuel_filter', [cylY(0.05, 0.18, kit.metal('aluminum'), [cx - ew * 0.3, ey - h * 0.1, cz + d * 0.3], 12)], [cx - ew * 0.3, ey, cz + d * 0.3]);
  addTo(b, 'battery', [box(0.35, 0.25, 0.22, kit.plastic('black'), [o.x1 - 0.3, o.y0 + 0.2, o.z0 + 0.2])], [o.x1 - 0.3, o.y0 + 0.2, o.z0 + 0.2]);
  addTo(
    b,
    'hydraulic_pump',
    [rbox(ctx, 0.35, 0.3, 0.3, 0.04, kit.metal('aluminum'), [o.x1 - 0.25, ey, cz]), cylZ(0.08, 0.2, kit.metal('steel'), [o.x1 - 0.25, ey, cz + 0.22], 12)],
    [o.x1 - 0.25, ey, cz],
  );
  addTo(b, 'hydraulic_oil', [box(0.4, h * 0.6, 0.3, kit.metal('steel'), [o.x1 - 0.3, o.y0 + h * 0.4, o.z1 - 0.25]), cylY(0.07, 0.22, kit.accent(spec.paint), [o.x1 - 0.3, o.y0 + h * 0.8, o.z1 - 0.25], 12)], [o.x1 - 0.3, o.y0 + h * 0.4, o.z1 - 0.25]);
  const ft = o.fuelTankAt ?? [o.x0 + 0.35, o.y0 + h * 0.35, o.z1 - 0.3];
  const fs = o.fuelTankSize ?? [0.5, h * 0.5, 0.4];
  addTo(b, 'fuel_tank_heavy', [box(fs[0], fs[1], fs[2], kit.metal('steel'), ft), cylY(0.05, 0.06, kit.chrome(), [ft[0], ft[1] + fs[1] / 2 + 0.03, ft[2]], 10)], ft);
}

/** Luces traseras (stops) en una cara posterior en x = `x`. */
export function rearLights(b: MachineBuild, x: number, y: number, zHalf: number): void {
  const kit = b.ctx.materials;
  const parts: Object3D[] = [];
  for (const s of [1, -1]) {
    parts.push(box(0.03, 0.1, 0.18, kit.light('tail'), [x - 0.01, y, s * zHalf]));
    parts.push(box(0.03, 0.1, 0.18, kit.light('head'), [x - 0.01, y + 0.14, s * zHalf]));
  }
  addTo(b, 'taillight', parts, [x, y, 0]);
}
