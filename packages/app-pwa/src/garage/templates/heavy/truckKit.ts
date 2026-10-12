/**
 * truckKit.ts — Base comun de los camiones de carretera (familia 'heavy').
 *
 * Construye todo lo que comparten furgon, estacas, volqueta y tractomula: ruedas
 * (delanteras sencillas y traseras dobles, con troque sencillo o doble), chasis de
 * vigas, suspension de ballestas, cabina (avanzada "cabover" tipo NPR/FVR o
 * convencional de trompa larga tipo T800), luces, espejos, tanque, bateria, escape y
 * mecanica interna. Cada plantilla agrega solo su carroceria trasera y llama
 * finishTruck(), que fusiona las mallas por material (collapse.ts) para no pasarse de
 * draw calls.
 *
 * Medidas: dims.lengthMm/heightMm/widthMm son las de la ficha; el entre ejes es del
 * eje delantero al CENTRO del troque trasero (asi lo publican las fichas de doble
 * troque), y los dos ejes traseros quedan a +-TANDEM_SPREAD/2 de ese centro.
 */
import { BoxGeometry, CylinderGeometry, Group, type Object3D } from 'three/webgpu';
import type { BuiltVehicle, PartSlotId, TemplateContext, VehicleSpec } from '../../contracts';
import { collapseParts } from '../common/collapse';
import { countTriangles, extrudeProfile, mesh, roundedBox, tube, type P2, type P3 } from '../common/geometry';
import { mm } from '../common/units';
import { buildWheel, placeWheel } from '../common/wheel';

export type CabStyle = 'cabover' | 'conventional';

/** Separacion entre los dos ejes de un doble troque (m). */
export const TANDEM_SPREAD = 1.32;

export interface TruckOptions {
  cab: CabStyle;
  /** Doble troque (dos ejes traseros). */
  tandem: boolean;
  /** Cabina dormitorio (solo convencional). */
  sleeper?: boolean;
}

export interface TruckLayout {
  L: number;
  W: number;
  H: number;
  halfW: number;
  wb: number;
  tf: number;
  tr: number;
  xFront: number;
  xRear: number;
  rF: number;
  rR: number;
  tireWR: number;
  /** Cara superior de las vigas del chasis. */
  frameTop: number;
  /** Medio ancho entre vigas (centro de cada viga). */
  frameZ: number;
  rearAxles: number[];
  cabStyle: CabStyle;
  cabFrontX: number;
  cabBackX: number;
  cabHalfW: number;
  cabRoofY: number;
  /** X desde donde puede empezar la carroceria trasera (detras de cabina y escape). */
  bedStartX: number;
}

export interface TruckBuild {
  root: Group;
  parts: Map<PartSlotId, Object3D>;
  focusPoints: Record<PartSlotId, P3>;
  layout: TruckLayout;
  spec: VehicleSpec;
  ctx: TemplateContext;
}

/** Agrega `children` a la ranura (crea el grupo si no existe) y fija su foco si se da. */
export function addTo(b: TruckBuild, slot: PartSlotId, children: Object3D[], focus?: P3): void {
  let g = b.parts.get(slot) as Group | undefined;
  if (!g) {
    g = new Group();
    g.name = `part:${slot}`;
    b.parts.set(slot, g);
  }
  for (const c of children) g.add(c);
  if (focus) b.focusPoints[slot] = focus;
}

/** Caja recta (sin redondeo): barata en triangulos para piezas chicas. */
export function box(w: number, h: number, d: number, material: unknown, at: P3): ReturnType<typeof mesh> {
  return mesh(new BoxGeometry(w, h, d), material, at);
}

/** Cilindro con eje en X (tanques, ejes longitudinales). */
export function cylX(r: number, len: number, material: unknown, at: P3, seg = 20): ReturnType<typeof mesh> {
  const g = new CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return mesh(g, material, at);
}

/** Cilindro con eje en Z (ejes de ruedas, rodillos). */
export function cylZ(r: number, len: number, material: unknown, at: P3, seg = 20): ReturnType<typeof mesh> {
  const g = new CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return mesh(g, material, at);
}

/** Cilindro vertical (eje Y). */
export function cylY(r: number, len: number, material: unknown, at: P3, seg = 20): ReturnType<typeof mesh> {
  return mesh(new CylinderGeometry(r, r, len, seg), material, at);
}

/** Panel plano inclinado entre dos puntos del perfil lateral (parabrisas, rejillas). */
export function slantPanel(
  p1: P2,
  p2: P2,
  widthZ: number,
  thickness: number,
  material: unknown,
  outward = 0.006,
): ReturnType<typeof mesh> {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  // Normal hacia fuera del perfil (adelante/arriba cuando p1 esta abajo y p2 arriba).
  const nx = dy / len;
  const ny = -dx / len;
  const m = mesh(new BoxGeometry(len, thickness, widthZ), material, [
    (p1[0] + p2[0]) / 2 + nx * outward,
    (p1[1] + p2[1]) / 2 + ny * outward,
    0,
  ]);
  m.rotation.z = Math.atan2(dy, dx);
  return m;
}

/** Puntos de un arco (centro cx,cy; radio r; de a0 a a1 en radianes). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ruedas
// ---------------------------------------------------------------------------

function buildWheels(b: TruckBuild): void {
  const { spec, ctx, layout } = b;
  const paint = spec.paint;
  const style = (spec.variants?.rim_fl as 'disc' | 'spokes' | undefined) ?? 'disc';
  const lowCtx: TemplateContext = { ...ctx, lod: 'low' };

  for (const side of [1, -1] as const) {
    const tag = side === 1 ? 'l' : 'r';
    // Delantera sencilla.
    const wf = buildWheel({ tire: spec.tireFront, family: 'heavy', style, paint, side }, ctx);
    const posF: P3 = [layout.wb / 2, layout.rF, (side * layout.tf) / 2];
    placeWheel(wf, posF);
    addTo(b, `tire_f${tag}`, [wf.tire], posF);
    addTo(b, `rim_f${tag}`, [wf.rim], posF);
    addTo(b, `brake_f${tag}`, [wf.brake], posF);

    // Traseras dobles en cada eje: la exterior en el LOD pedido, la interior en low
    // (casi no se ve y son la mitad de los triangulos del vehiculo).
    const gap = 0.02;
    for (const ax of layout.rearAxles) {
      const zOuter = side * (layout.tr / 2 + layout.tireWR / 2 + gap / 2);
      const zInner = side * (layout.tr / 2 - layout.tireWR / 2 - gap / 2);
      const outer = buildWheel({ tire: spec.tireRear, family: 'heavy', style, paint, side, rear: true }, ctx);
      const inner = buildWheel({ tire: spec.tireRear, family: 'heavy', style: 'disc', paint, side, rear: true }, lowCtx);
      placeWheel(outer, [ax, layout.rR, zOuter]);
      placeWheel(inner, [ax, layout.rR, zInner]);
      const focus: P3 = [layout.rearAxles[0], layout.rR, side * (layout.tr / 2 + layout.tireWR / 2)];
      addTo(b, `tire_r${tag}`, [outer.tire, inner.tire], focus);
      addTo(b, `rim_r${tag}`, [outer.rim, inner.rim], focus);
      addTo(b, `brake_r${tag}`, [inner.brake], focus);
    }
  }
}

// ---------------------------------------------------------------------------
// Chasis, suspension y mecanica
// ---------------------------------------------------------------------------

function leafSpring(cx: number, z: number, yAxle: number, yFrame: number, length: number, kit: TemplateContext['materials']): Object3D[] {
  const out: Object3D[] = [];
  const leaves = 5;
  const top = yFrame - 0.06;
  const span = Math.max(0.06, top - yAxle - 0.05);
  for (let i = 0; i < leaves; i++) {
    const len = length * (1 - i * 0.14);
    out.push(box(len, 0.018, 0.075, kit.metal('dark'), [cx, yAxle + 0.05 + span * (1 - i / leaves) * 0.6, z]));
  }
  // Grilletes a la viga.
  for (const s of [-1, 1]) out.push(box(0.05, top - yAxle - 0.02, 0.06, kit.metal('steel'), [cx + (s * length) / 2, (top + yAxle + 0.05) / 2 + 0.02, z]));
  return out;
}

function buildChassis(b: TruckBuild): void {
  const { ctx, layout: t } = b;
  const kit = ctx.materials;
  const railH = 0.27;
  const railY = t.frameTop - railH / 2;
  const x0 = t.xFront - 0.28;
  const x1 = t.xRear + 0.06;
  const railLen = x0 - x1;
  const rails: Object3D[] = [];
  for (const s of [1, -1]) rails.push(box(railLen, railH, 0.07, kit.metal('dark'), [(x0 + x1) / 2, railY, s * t.frameZ]));
  const crossCount = ctx.lod === 'low' ? 4 : 7;
  for (let i = 0; i <= crossCount; i++) {
    const x = x0 - (railLen * i) / crossCount;
    rails.push(box(0.08, 0.18, t.frameZ * 2, kit.metal('dark'), [x, railY, 0]));
  }
  // Tanques de aire del freno (cilindros bajo la viga derecha).
  rails.push(cylX(0.11, 0.7, kit.metal('dark'), [t.cabBackX - 0.6, railY - 0.2, -(t.frameZ + 0.2)], 16));
  rails.push(cylX(0.11, 0.7, kit.metal('dark'), [t.cabBackX - 1.4, railY - 0.2, -(t.frameZ + 0.2)], 16));
  // Guardafangos/loderas traseras: los "faldones" negros detras de las ruedas.
  for (const s of [1, -1]) {
    const lastAxle = Math.min(...t.rearAxles);
    rails.push(box(0.012, 0.55, t.tireWR * 2 + 0.06, kit.plastic('black'), [lastAxle - t.rR - 0.18, t.rR * 0.75, s * (t.tr / 2)]));
  }
  addTo(b, 'chassis_frame', rails, [(x0 + x1) / 2, railY, 0]);

  // Suspension: ballestas + ejes.
  const front: Object3D[] = [];
  for (const s of [1, -1]) front.push(...leafSpring(t.wb / 2, s * t.frameZ, t.rF, t.frameTop - railH, 1.3, kit));
  front.push(cylZ(0.06, t.tf - 0.25, kit.metal('dark'), [t.wb / 2, t.rF, 0], 12));
  for (const s of [1, -1]) front.push(cylY(0.035, t.frameTop - t.rF - 0.2, kit.metal('steel'), [t.wb / 2 - 0.35, (t.frameTop + t.rF) / 2 - 0.05, s * (t.frameZ + 0.1)], 10));
  addTo(b, 'suspension_front', front, [t.wb / 2, (t.rF + t.frameTop) / 2, t.frameZ]);

  const rear: Object3D[] = [];
  const rc = t.rearAxles.reduce((a, c) => a + c, 0) / t.rearAxles.length;
  const springLen = t.rearAxles.length > 1 ? TANDEM_SPREAD + 0.35 : 1.4;
  for (const s of [1, -1]) rear.push(...leafSpring(rc, s * t.frameZ, t.rR, t.frameTop - railH, springLen, kit));
  for (const ax of t.rearAxles) {
    rear.push(cylZ(0.075, t.tr - 0.1, kit.metal('dark'), [ax, t.rR, 0], 14));
    // Diferencial (la "pera" del eje).
    rear.push(mesh(roundedBox(0.42, 0.36, 0.42, 0.12, ctx.lod === 'low' ? 1 : 2), kit.metal('dark'), [ax + 0.08, t.rR, 0]));
  }
  addTo(b, 'suspension_rear', rear, [rc, (t.rR + t.frameTop) / 2, t.frameZ]);

  // Cardan: del motor al primer diferencial (en el embrague, que es la transmision interna).
  const engineX = t.cabStyle === 'cabover' ? t.wb / 2 - 0.15 : t.wb / 2 + 0.05;
  const shaftFrom: P3 = [engineX - 1.0, t.frameTop - 0.32, 0];
  const shaftTo: P3 = [Math.max(...t.rearAxles) + 0.25, t.rR + 0.02, 0];
  addTo(
    b,
    'clutch',
    [
      mesh(roundedBox(0.5, 0.5, 0.5, 0.08, 1), kit.metal('aluminum'), [engineX - 0.8, t.frameTop - 0.18, 0]),
      mesh(tube([shaftFrom, shaftTo], 0.05, { radial: 8, segments: 4 }), kit.metal('steel')),
    ],
    [engineX - 0.8, t.frameTop - 0.18, 0],
  );
}

function buildMechanicals(b: TruckBuild): void {
  const { ctx, layout: t } = b;
  const kit = ctx.materials;
  const conventional = t.cabStyle === 'conventional';
  const ex = conventional ? t.wb / 2 + 0.05 : t.wb / 2 - 0.15;
  const ey = t.frameTop + 0.2;

  // Motor diesel en linea: bloque, culata, tapa de valvulas, turbo y radiador.
  addTo(
    b,
    'engine',
    [
      mesh(roundedBox(1.05, 0.62, 0.62, 0.05, 1), kit.metal('dark'), [ex, ey, 0]),
      mesh(roundedBox(0.98, 0.16, 0.52, 0.04, 1), kit.metal('aluminum'), [ex, ey + 0.39, 0]),
      mesh(roundedBox(0.9, 0.08, 0.4, 0.03, 1), kit.accent(b.spec.paint), [ex, ey + 0.5, 0]),
      cylZ(0.13, 0.16, kit.metal('steel'), [ex - 0.3, ey + 0.25, -0.38], 16),
      box(0.08, 0.8, 0.9, kit.metal('dark'), [ex + 0.65, ey + 0.15, 0]),
    ],
    [ex, ey + 0.2, 0],
  );
  addTo(b, 'engine_oil', [mesh(roundedBox(0.8, 0.2, 0.46, 0.05, 1), kit.metal('steel'), [ex, ey - 0.4, 0])], [ex, ey - 0.4, 0]);
  addTo(b, 'oil_filter', [cylY(0.06, 0.22, kit.accent(b.spec.paint), [ex + 0.2, ey - 0.12, 0.38], 14)], [ex + 0.2, ey - 0.12, 0.38]);
  addTo(b, 'fuel_filter', [cylY(0.05, 0.2, kit.metal('aluminum'), [ex - 0.2, ey - 0.08, 0.38], 14)], [ex - 0.2, ey - 0.08, 0.38]);

  // Filtro de aire: en convencional son los dos "tarros" a los lados del capo; en
  // cabover va vertical detras de la cabina.
  if (conventional) {
    const parts: Object3D[] = [];
    const z = Math.min(t.cabHalfW + 0.12, t.halfW - 0.19);
    for (const s of [1, -1]) parts.push(cylY(0.17, 0.62, kit.metal('aluminum'), [t.cabFrontX + 0.25, t.frameTop + 0.75, s * z], 20));
    addTo(b, 'air_filter', parts, [t.cabFrontX + 0.25, t.frameTop + 0.75, z]);
  } else {
    addTo(b, 'air_filter', [cylY(0.16, 0.75, kit.plastic('black'), [t.cabBackX - 0.2, t.frameTop + 0.7, t.cabHalfW - 0.25], 18)], [t.cabBackX - 0.2, t.frameTop + 0.7, t.cabHalfW - 0.25]);
  }

  // Bateria: caja con tapa en el lado derecho del chasis.
  const bx = t.cabBackX - 0.45;
  const bz = -(t.frameZ + 0.3);
  addTo(
    b,
    'battery',
    [
      mesh(roundedBox(0.6, 0.38, 0.42, 0.03, 1), kit.metal('steel'), [bx, t.frameTop - 0.42, bz]),
      box(0.62, 0.03, 0.44, kit.plastic('black'), [bx, t.frameTop - 0.22, bz]),
    ],
    [bx, t.frameTop - 0.42, bz],
  );

  // Tanque de combustible: cilindro de aluminio con zunchos, lado izquierdo.
  const tankLen = Math.min(1.3, Math.max(0.7, (t.cabBackX - (t.rearAxles[0] + t.rR + 0.25)) * 0.8));
  const tx = t.cabBackX - 0.25 - tankLen / 2;
  const tr = 0.3;
  const tz = t.frameZ + 0.1 + tr;
  const ty = t.frameTop - 0.15 - tr * 0.6;
  addTo(
    b,
    'fuel_tank_heavy',
    [
      cylX(tr, tankLen, kit.metal('aluminum'), [tx, ty, tz], ctx.lod === 'low' ? 14 : 28),
      cylX(tr + 0.012, 0.05, kit.metal('dark'), [tx - tankLen * 0.32, ty, tz], 14),
      cylX(tr + 0.012, 0.05, kit.metal('dark'), [tx + tankLen * 0.32, ty, tz], 14),
      cylY(0.06, 0.05, kit.chrome(), [tx + tankLen * 0.3, ty + tr + 0.02, tz], 12),
    ],
    [tx, ty, tz],
  );

  // Escape: chimeneas cromadas (convencional) o silenciador bajo el chasis (cabover).
  if (conventional) {
    const parts: Object3D[] = [];
    const sx = t.cabBackX - 0.12;
    for (const s of [1, -1]) {
      const z = s * (t.cabHalfW - 0.08);
      // Las chimeneas son lo mas alto del camion: llegan justo a la altura de ficha.
      parts.push(cylY(0.075, t.H - t.frameTop, kit.chrome(), [sx, (t.H + t.frameTop) / 2, z], 16));
      parts.push(cylY(0.11, 0.9, kit.metal('brushed'), [sx, t.cabRoofY - 0.6, z], 16));
    }
    addTo(b, 'exhaust', parts, [sx, t.cabRoofY, t.cabHalfW - 0.08]);
  } else {
    const mx = t.cabBackX - 0.5;
    const mz = -(t.frameZ + 0.32);
    addTo(
      b,
      'exhaust',
      [
        cylX(0.17, 0.7, kit.metal('brushed'), [mx - 0.7, t.frameTop - 0.5, mz], 18),
        mesh(tube([[ex - 0.4, ey, -0.35], [mx - 0.2, t.frameTop - 0.5, mz]], 0.045, { radial: 8, segments: 6 }), kit.metal('steel')),
        cylX(0.05, 0.3, kit.metal('dark'), [mx - 1.2, t.frameTop - 0.5, mz], 10),
      ],
      [mx - 0.7, t.frameTop - 0.5, mz],
    );
  }

  // Luces traseras: barra con stops, direccionales y bomper antiempotramiento.
  const rx = t.xRear + 0.02;
  const lights: Object3D[] = [];
  for (const s of [1, -1]) {
    lights.push(box(0.04, 0.12, 0.26, kit.light('tail'), [rx, t.frameTop - 0.32, s * (t.halfW - 0.25)]));
    lights.push(box(0.04, 0.08, 0.1, kit.light('turn'), [rx, t.frameTop - 0.32, s * (t.halfW - 0.45)]));
  }
  lights.push(box(0.06, 0.16, t.halfW * 1.6, kit.metal('dark'), [rx - 0.03, t.frameTop - 0.32, 0]));
  addTo(b, 'taillight', lights, [rx, t.frameTop - 0.32, 0]);
  addTo(
    b,
    'bumper_rear',
    [
      box(0.1, 0.12, t.halfW * 1.75, kit.metal('steel'), [t.xRear + 0.12, 0.55, 0]),
      ...[1, -1].map((s) => box(0.06, t.frameTop - 0.6, 0.06, kit.metal('dark'), [t.xRear + 0.14, (t.frameTop + 0.55) / 2 - 0.1, s * t.frameZ])),
    ],
    [t.xRear + 0.12, 0.55, 0],
  );
}

// ---------------------------------------------------------------------------
// Cabinas
// ---------------------------------------------------------------------------

/** Cabina avanzada (el conductor va sobre el eje delantero). */
function buildCabover(b: TruckBuild): void {
  const { ctx, spec, layout: t } = b;
  const kit = ctx.materials;
  const bev = 0.04;
  const xf = t.cabFrontX;
  const xb = t.cabBackX;
  const roof = t.cabRoofY;
  const y0 = Math.max(0.32, t.rF * 0.92);
  const belt = y0 + (roof - y0) * 0.5;
  const archX = t.wb / 2;
  const rA = t.rF + 0.07;
  const dy = y0 - t.rF;
  const dx0 = Math.sqrt(Math.max(0, rA * rA - dy * dy));
  const a0 = Math.atan2(dy, dx0);
  const n = ctx.lod === 'low' ? 8 : 16;

  const profile: P2[] = [
    [xb + bev, y0 + 0.15],
    [xb + bev, roof - bev - 0.05],
    [xb + bev + 0.06, roof - bev],
    [xf - 0.32, roof - bev],
    [xf - 0.2, roof - bev - 0.09],
    [xf - bev - 0.03, belt],
    [xf - bev, belt - 0.12],
    [xf - bev, y0 + bev + 0.06],
    [xf - bev - 0.06, y0 + bev],
    ...arc(archX, t.rF, rA + bev, a0, Math.PI - a0, n),
    [xb + bev + 0.1, y0 + bev],
  ];
  const cabW = t.cabHalfW * 2;
  const shell = mesh(extrudeProfile(profile, { depth: cabW, bevel: bev, bevelSegments: ctx.lod === 'low' ? 1 : 3, curveSegments: 8 }), kit.paint(spec.paint));
  const visor = box(0.24, 0.04, cabW * 0.9, kit.plastic('black'), [xf - 0.18, roof - 0.05, 0]);
  visor.rotation.z = -0.25;
  const roofLights: Object3D[] = [];
  for (const z of [-0.25, 0, 0.25]) roofLights.push(box(0.05, 0.04, 0.09, kit.light('turn'), [xf - 0.3, roof + 0.015, z]));
  addTo(b, 'cab', [shell, visor], [(xf + xb) / 2, (y0 + roof) / 2, 0]);

  // Vidrios: parabrisas inclinado y ventanas de puerta.
  const glass: Object3D[] = [slantPanel([xf - 0.03, belt + 0.03], [xf - 0.19, roof - 0.13], cabW * 0.86, 0.012, kit.glass('tinted'), 0.004)];
  for (const s of [1, -1]) {
    glass.push(box(0.78, roof - belt - 0.2, 0.012, kit.glass('tinted'), [xf - 0.62, (roof + belt) / 2 - 0.04, s * (t.cabHalfW + 0.002)]));
    glass.push(box(0.22, 0.35, 0.012, kit.glass('tinted'), [xf - 0.12, belt + 0.1, s * (t.cabHalfW - 0.05)]));
  }
  glass.push(box(0.012, 0.42, cabW * 0.5, kit.glass('tinted'), [xb - 0.002, belt + 0.25, 0]));
  addTo(b, 'glass', glass, [xf - 0.1, belt + 0.3, 0]);

  // Frente (en cabover la "trompa" es la parrilla basculante).
  const front: Object3D[] = [box(0.03, belt - y0 - 0.38, cabW * 0.62, kit.plastic('black'), [xf + 0.005, (belt + y0) / 2 - 0.02, 0])];
  const bars = ctx.lod === 'low' ? 3 : 5;
  for (let i = 0; i < bars; i++) {
    const y = y0 + 0.28 + ((belt - y0 - 0.5) * i) / Math.max(1, bars - 1);
    front.push(box(0.035, 0.03, cabW * 0.6, kit.accent(spec.paint), [xf + 0.012, y, 0]));
  }
  addTo(b, 'hood', front, [xf, (belt + y0) / 2, 0]);

  // Luces delanteras en las esquinas bajas + direccionales.
  const lights: Object3D[] = [...roofLights];
  for (const s of [1, -1]) {
    lights.push(box(0.04, 0.17, 0.32, kit.light('head'), [xf + 0.005, y0 + 0.32, s * (t.cabHalfW - 0.25)]));
    lights.push(box(0.04, 0.1, 0.1, kit.light('turn'), [xf + 0.005, y0 + 0.32, s * (t.cabHalfW - 0.06)]));
  }
  addTo(b, 'headlight', lights, [xf, y0 + 0.32, t.cabHalfW - 0.25]);

  // Puertas: costuras, manija y escalones.
  for (const s of [1, -1] as const) {
    const z = s * (t.cabHalfW + 0.003);
    const dx0d = xf - 1.12;
    const dx1d = xf - 0.08;
    const dyTop = roof - 0.08;
    const dyBot = t.rF * 2 + 0.12;
    const seam = kit.plastic('black');
    const door: Object3D[] = [
      box(0.012, dyTop - dyBot, 0.006, seam, [dx0d, (dyTop + dyBot) / 2, z]),
      box(0.012, dyTop - dyBot, 0.006, seam, [dx1d, (dyTop + dyBot) / 2, z]),
      box(dx1d - dx0d, 0.012, 0.006, seam, [(dx0d + dx1d) / 2, dyBot, z]),
      box(0.16, 0.035, 0.02, kit.chrome(), [dx0d + 0.2, belt - 0.05, s * (t.cabHalfW + 0.012)]),
    ];
    addTo(b, s === 1 ? 'door_fl' : 'door_fr', door, [(dx0d + dx1d) / 2, (dyTop + dyBot) / 2, z]);
  }
  buildMirrors(b, xf - 0.12, belt + 0.12);

  // Bomper delantero.
  addTo(
    b,
    'bumper_front',
    [
      mesh(roundedBox(0.2, 0.3, cabW + 0.02, 0.04, ctx.lod === 'low' ? 1 : 2), kit.metal('dark'), [xf + 0.06, y0 + 0.02, 0]),
      ...[1, -1].map((s) => box(0.05, 0.08, 0.14, kit.light('drl'), [xf + 0.165, y0 + 0.04, s * (t.cabHalfW - 0.3)])),
    ],
    [xf + 0.06, y0, 0],
  );

  // Carroceria baja: escalones detras del arco y faldon.
  const body: Object3D[] = [];
  for (const s of [1, -1]) {
    const sx = archX - rA - 0.22;
    body.push(box(0.36, 0.035, 0.22, kit.metal('aluminum'), [sx, y0 - 0.05, s * (t.cabHalfW - 0.12)]));
    body.push(box(0.36, 0.035, 0.22, kit.metal('aluminum'), [sx, y0 - 0.33, s * (t.cabHalfW - 0.12)]));
    body.push(box(0.035, 0.32, 0.22, kit.metal('dark'), [sx - 0.18, y0 - 0.19, s * (t.cabHalfW - 0.12)]));
  }
  addTo(b, 'body', body, [archX - rA - 0.2, y0, t.cabHalfW]);
}

/** Cabina convencional de trompa larga (motor delante de la cabina). */
function buildConventional(b: TruckBuild): void {
  const { ctx, spec, layout: t } = b;
  const kit = ctx.materials;
  const lowLod = ctx.lod === 'low';
  const xg = t.xFront - 0.24; // cara de la parrilla
  const cowl = t.cabFrontX;
  const hoodTop = t.frameTop + 1.0;
  const hoodW = Math.min(1.25, t.cabHalfW * 2 * 0.58);
  const bev = 0.06;
  const paint = kit.paint(spec.paint);

  // Capo: perfil lateral extruido, con la nariz redondeada.
  const hoodProfile: P2[] = [
    [xg - bev, t.frameTop + 0.02],
    [xg - bev, hoodTop - 0.16],
    [xg - 0.14, hoodTop - bev],
    [cowl + 0.02, hoodTop + 0.06 - bev],
    [cowl + 0.02, t.frameTop + 0.02],
  ];
  const hood = mesh(extrudeProfile(hoodProfile, { depth: hoodW, bevel: bev, bevelSegments: lowLod ? 1 : 3 }), paint);
  // Parrilla cromada alta con rejilla oscura.
  const grilleH = hoodTop - t.frameTop - 0.22;
  const grilleY = t.frameTop + 0.06 + grilleH / 2;
  const hoodParts: Object3D[] = [
    hood,
    box(0.05, grilleH + 0.06, hoodW * 0.94, kit.chrome(), [xg + 0.005, grilleY, 0]),
    box(0.04, grilleH - 0.06, hoodW * 0.8, kit.plastic('black'), [xg + 0.022, grilleY, 0]),
  ];
  const slats = lowLod ? 4 : 9;
  for (let i = 0; i < slats; i++) {
    const y = grilleY - grilleH / 2 + 0.06 + ((grilleH - 0.12) * i) / (slats - 1);
    hoodParts.push(box(0.02, 0.02, hoodW * 0.78, kit.chrome(), [xg + 0.04, y, 0]));
  }
  addTo(b, 'hood', hoodParts, [(xg + cowl) / 2, hoodTop, 0]);

  // Guardabarros delanteros: banda en arco a cada lado del capo.
  const archX = t.wb / 2;
  const ri = t.rF + 0.07;
  const ro = ri + 0.13;
  const fenderW = Math.max(0.3, t.halfW - hoodW / 2 - 0.02);
  const n = lowLod ? 8 : 18;
  const outer = arc(archX, t.rF, ro, 0, Math.PI, n).map(([x, y]) => [Math.min(x, xg - 0.05), t.rF + (y - t.rF) * 0.9] as P2);
  const inner = arc(archX, t.rF, ri, Math.PI, 0, n);
  const fenderProfile: P2[] = [...outer, [archX - ro, t.rF - 0.05], ...inner, [archX + ro, t.rF - 0.05]];
  const body: Object3D[] = [];
  for (const s of [1, -1]) {
    const f = mesh(extrudeProfile(fenderProfile, { depth: fenderW, bevel: 0.025, bevelSegments: lowLod ? 1 : 2, curveSegments: 6 }), paint);
    f.position.z = s * (hoodW / 2 + fenderW / 2 - 0.03);
    body.push(f);
    // Escalones de la cabina sobre su caja (que va atornillada a la viga).
    const sz = s * (t.cabHalfW - 0.1);
    body.push(box(0.5, 0.035, 0.26, kit.metal('aluminum'), [cowl - 0.35, t.frameTop - 0.15, sz]));
    body.push(box(0.5, 0.035, 0.26, kit.metal('aluminum'), [cowl - 0.35, t.frameTop - 0.48, sz]));
    body.push(box(0.5, 0.5, 0.04, kit.metal('dark'), [cowl - 0.35, t.frameTop - 0.33, s * (t.cabHalfW - 0.22)]));
    body.push(box(0.04, 0.5, 0.26, kit.metal('dark'), [cowl - 0.6, t.frameTop - 0.33, sz]));
    body.push(box(0.04, 0.5, 0.26, kit.metal('dark'), [cowl - 0.1, t.frameTop - 0.33, sz]));
    body.push(box(0.1, 0.06, s * (t.cabHalfW - 0.22) - s * t.frameZ, kit.metal('dark'), [cowl - 0.35, t.frameTop - 0.1, (s * (t.cabHalfW - 0.22) + s * t.frameZ) / 2]));
  }
  addTo(b, 'body', body, [archX, t.rF + ro * 0.8, hoodW / 2 + fenderW / 2]);

  // Luces: farolas en los guardabarros, direccionales y luces de galibo en el techo.
  const lights: Object3D[] = [];
  const hlX = Math.min(xg - 0.12, archX + ro * 0.8);
  for (const s of [1, -1]) {
    const z = s * (hoodW / 2 + fenderW * 0.42);
    lights.push(box(0.12, 0.16, 0.3, kit.light('head'), [hlX, t.rF + ro * 0.62, z]));
    lights.push(box(0.1, 0.07, 0.12, kit.light('turn'), [hlX - 0.05, t.rF + ro * 0.84, z]));
  }
  for (const z of [-0.3, -0.15, 0, 0.15, 0.3]) lights.push(box(0.05, 0.04, 0.08, kit.light('turn'), [cowl - 0.22, t.cabRoofY + 0.015, z]));
  addTo(b, 'headlight', lights, [hlX, t.rF + ro * 0.62, hoodW / 2 + fenderW * 0.42]);

  // Cabina: perfil con parabrisas inclinado.
  const xf = cowl;
  const xb = t.cabBackX;
  const roof = t.cabRoofY;
  const floor = t.frameTop + 0.05;
  const belt = hoodTop + 0.18;
  const cbev = 0.05;
  const cabProfile: P2[] = [
    [xb + cbev, floor],
    [xb + cbev, roof - cbev - 0.06],
    [xb + cbev + 0.08, roof - cbev],
    [xf - 0.45, roof - cbev],
    [xf - 0.36, roof - cbev - 0.05],
    [xf - cbev - 0.02, belt],
    [xf - cbev, belt - 0.06],
    [xf - cbev, floor],
  ];
  const cabW = t.cabHalfW * 2;
  const shell = mesh(extrudeProfile(cabProfile, { depth: cabW, bevel: cbev, bevelSegments: lowLod ? 1 : 3 }), paint);
  addTo(b, 'cab', [shell], [(xf + xb) / 2, (floor + roof) / 2, 0]);

  const glass: Object3D[] = [slantPanel([xf - 0.02, belt + 0.03], [xf - 0.34, roof - 0.1], cabW * 0.86, 0.012, kit.glass('tinted'), 0.004)];
  for (const s of [1, -1]) glass.push(box(0.75, roof - belt - 0.2, 0.012, kit.glass('tinted'), [xf - 0.62, (roof + belt) / 2 - 0.03, s * (t.cabHalfW + 0.002)]));
  glass.push(box(0.012, 0.36, cabW * 0.45, kit.glass('tinted'), [xb - 0.002, belt + 0.25, 0]));
  addTo(b, 'glass', glass, [xf - 0.2, belt + 0.3, 0]);

  for (const s of [1, -1] as const) {
    const z = s * (t.cabHalfW + 0.003);
    const d0 = xf - 1.15;
    const d1 = xf - 0.07;
    const top = roof - 0.1;
    const bot = floor + 0.04;
    const seam = kit.plastic('black');
    addTo(
      b,
      s === 1 ? 'door_fl' : 'door_fr',
      [
        box(0.012, top - bot, 0.006, seam, [d0, (top + bot) / 2, z]),
        box(0.012, top - bot, 0.006, seam, [d1, (top + bot) / 2, z]),
        box(0.16, 0.035, 0.02, kit.chrome(), [d0 + 0.2, belt - 0.08, s * (t.cabHalfW + 0.012)]),
      ],
      [(d0 + d1) / 2, (top + bot) / 2, z],
    );
  }
  buildMirrors(b, xf - 0.1, belt + 0.15);

  // Bomper cromado.
  addTo(
    b,
    'bumper_front',
    [mesh(roundedBox(0.24, 0.32, t.halfW * 2 - 0.08, 0.05, lowLod ? 1 : 2), kit.chrome(), [t.xFront - 0.12, t.rF + 0.02, 0])],
    [t.xFront - 0.12, t.rF, 0],
  );
}

function buildMirrors(b: TruckBuild, x: number, y: number): void {
  const kit = b.ctx.materials;
  const t = b.layout;
  const parts: Object3D[] = [];
  for (const s of [1, -1]) {
    const zArm0 = s * (t.cabHalfW - 0.02);
    const zHead = s * (t.cabHalfW + 0.26);
    parts.push(mesh(tube([[x, y - 0.25, zArm0], [x + 0.05, y - 0.2, zHead], [x + 0.05, y + 0.3, zHead]], 0.014, { radial: 6, segments: 8 }), kit.metal('dark')));
    parts.push(mesh(roundedBox(0.06, 0.4, 0.2, 0.02, 1), kit.plastic('black'), [x + 0.05, y + 0.05, zHead]));
    parts.push(box(0.008, 0.36, 0.17, kit.glass('visor'), [x + 0.02, y + 0.05, zHead]));
    parts.push(mesh(roundedBox(0.05, 0.16, 0.16, 0.02, 1), kit.plastic('black'), [x + 0.05, y - 0.25, zHead]));
  }
  addTo(b, 'mirrors', parts, [x, y, t.cabHalfW + 0.26]);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function truckLayout(spec: VehicleSpec, opts: TruckOptions): TruckLayout {
  const L = mm(spec.dims.lengthMm);
  const W = mm(spec.dims.widthMm);
  const H = mm(spec.dims.heightMm);
  const wb = mm(spec.dims.wheelbaseMm);
  const tf = mm(spec.dims.trackFrontMm ?? Math.round(spec.dims.widthMm * 0.82));
  const tireWR = mm(spec.tireRear.widthMm);
  const trDefault = W - tireWR * 2 - 0.08;
  const tr = Math.min(mm(spec.dims.trackRearMm ?? Math.round(trDefault * 1000)), trDefault);
  const rF = mm((spec.tireFront.rimIn * 25.4) / 2 + (spec.tireFront.widthMm * spec.tireFront.aspectPct) / 100);
  const rR = mm((spec.tireRear.rimIn * 25.4) / 2 + (spec.tireRear.widthMm * spec.tireRear.aspectPct) / 100);
  const frameTop = rR + 0.41;
  const rearAxles = opts.tandem ? [-wb / 2 + TANDEM_SPREAD / 2, -wb / 2 - TANDEM_SPREAD / 2] : [-wb / 2];
  const rearReach = Math.min(...rearAxles) - rR - 0.35;

  // Voladizo delantero: cabover ~1.2 m (la cabina va sobre el eje), convencional ~1.0 m.
  const fo = opts.cab === 'cabover' ? Math.max(rF + 0.55, 1.15) : Math.max(rF + 0.45, 0.95);
  let xFront = wb / 2 + fo;
  let xRear = xFront - L;
  if (xRear > rearReach) {
    // Ficha mas corta que la mecanica: se respeta el largo moviendo el frente.
    xRear = rearReach;
    xFront = xRear + L;
  }

  // La cabina es mas angosta que un furgon o un volco (que llegan al ancho de ficha).
  const cabHalfW = opts.cab === 'cabover' ? Math.min(W * 0.97, 2.2) / 2 : Math.min(W * 0.88, 2.15) / 2;
  let cabFrontX: number;
  let cabBackX: number;
  let cabRoofY: number;
  if (opts.cab === 'cabover') {
    cabFrontX = xFront - 0.16;
    cabBackX = cabFrontX - 1.75;
    cabRoofY = Math.min(H, frameTop + 1.95);
  } else {
    cabFrontX = xFront - 0.24 - 1.85; // parrilla → cowl
    cabBackX = cabFrontX - (opts.sleeper ? 2.6 : 1.6);
    cabRoofY = Math.min(H - 0.3, frameTop + (opts.sleeper ? 2.35 : 2.1));
  }
  const bedStartX = cabBackX - (opts.cab === 'conventional' ? 0.32 : 0.12);

  return {
    L,
    W,
    H,
    halfW: W / 2,
    wb,
    tf,
    tr,
    xFront,
    xRear,
    rF,
    rR,
    tireWR,
    frameTop,
    frameZ: 0.43,
    rearAxles,
    cabStyle: opts.cab,
    cabFrontX,
    cabBackX,
    cabHalfW,
    cabRoofY,
    bedStartX,
  };
}

/** Construye todo menos la carroceria trasera. */
export function buildTruckBase(spec: VehicleSpec, ctx: TemplateContext, opts: TruckOptions, name: string): TruckBuild {
  const root = new Group();
  root.name = `vehicle:${name}`;
  const b: TruckBuild = { root, parts: new Map(), focusPoints: {}, layout: truckLayout(spec, opts), spec, ctx };
  buildWheels(b);
  buildChassis(b);
  buildMechanicals(b);
  if (opts.cab === 'cabover') buildCabover(b);
  else buildConventional(b);
  return b;
}

/** Fusiona cada ranura por material, la cuelga de la raiz y cuenta triangulos. */
export function finishTruck(b: TruckBuild): BuiltVehicle {
  const collapsed = collapseParts(b.parts);
  for (const g of collapsed.values()) b.root.add(g);
  return { root: b.root, parts: collapsed, focusPoints: b.focusPoints, triangles: countTriangles(b.root) };
}
