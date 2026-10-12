/**
 * heavy/index.ts — Plantillas de camiones de carretera sobre truckKit.ts.
 *
 *   heavy-truck    Furgon, cabina avanzada (tipo NPR/FVR), eje trasero sencillo.
 *   heavy-flatbed  Estacas, cabina avanzada, eje trasero sencillo.
 *   heavy-dump     Volqueta, cabina convencional, doble troque.
 *   heavy-tractor  Tractomula, cabina convencional con dormitorio, doble troque.
 *
 * Sin marcas: las medidas por defecto son de clase (fichas publicas tipicas de cada
 * tipo en Colombia), no de un modelo.
 */
import type { Object3D } from 'three/webgpu';
import type { BuiltVehicle, VehicleSpec, VehicleTemplate } from '../../contracts';
import { mesh, roundedBox } from '../common/geometry';
import { addTo, box, buildTruckBase, cylY, finishTruck, type CabStyle, type TruckBuild } from './truckKit';

const CAB_VARIANTS: CabStyle[] = ['cabover', 'conventional'];

function cabOf(spec: VehicleSpec, fallback: CabStyle): CabStyle {
  const v = spec.variants?.cab;
  return v === 'cabover' || v === 'conventional' ? v : fallback;
}

/** Largueros del subchasis que reciben la carroceria. */
function subframe(b: TruckBuild, x0: number, x1: number, y: number): Object3D[] {
  const kit = b.ctx.materials;
  const t = b.layout;
  const out: Object3D[] = [];
  for (const s of [1, -1]) out.push(box(x0 - x1, 0.12, 0.1, kit.metal('dark'), [(x0 + x1) / 2, y - 0.06, s * t.frameZ]));
  return out;
}

// ---------------------------------------------------------------------------

function cargoBox(b: TruckBuild): void {
  const kit = b.ctx.materials;
  const t = b.layout;
  const x0 = t.bedStartX;
  const x1 = t.xRear + 0.02;
  const y0 = t.frameTop + 0.14;
  const y1 = t.H;
  const len = x0 - x1;
  const cx = (x0 + x1) / 2;
  const h = y1 - y0;
  const paint = kit.paint(b.spec.paint);
  const parts: Object3D[] = [
    ...subframe(b, x0, x1, y0),
    mesh(roundedBox(len, h, t.W - 0.01, 0.03, b.ctx.lod === 'low' ? 1 : 2), paint, [cx, y0 + h / 2, 0]),
  ];
  // Rieles superior e inferior: solo en los bordes (una losa entera sobre el techo
  // queda coplanar con la caja y parpadea).
  for (const s of [1, -1]) {
    parts.push(box(len + 0.02, 0.07, 0.04, kit.metal('aluminum'), [cx, y1 - 0.035, s * (t.halfW - 0.005)]));
    parts.push(box(len + 0.02, 0.1, 0.04, kit.metal('aluminum'), [cx, y0 + 0.05, s * (t.halfW - 0.005)]));
  }
  for (const x of [x0 + 0.005, x1 - 0.005]) parts.push(box(0.04, 0.07, t.W + 0.01, kit.metal('aluminum'), [x, y1 - 0.035, 0]));
  const ribs = b.ctx.lod === 'low' ? 4 : 9;
  for (let i = 1; i < ribs; i++) {
    const x = x0 - (len * i) / ribs;
    for (const s of [1, -1]) parts.push(box(0.05, h - 0.18, 0.012, kit.metal('aluminum'), [x, y0 + h / 2, s * (t.halfW + 0.002)]));
  }
  // Puertas traseras: costura central, bisagras y barras de cierre.
  const rx = x1 - 0.002;
  parts.push(box(0.012, h - 0.12, 0.02, kit.plastic('black'), [rx, y0 + h / 2, 0]));
  for (const z of [-0.55, -0.2, 0.2, 0.55]) parts.push(box(0.03, h - 0.3, 0.035, kit.metal('steel'), [rx - 0.015, y0 + h / 2, z * (t.halfW / 1.2)]));
  // Luces de galibo laterales.
  for (const s of [1, -1]) for (const k of [0.15, 0.5, 0.85]) parts.push(box(0.08, 0.04, 0.012, b.ctx.materials.light('turn'), [x0 - len * k, y0 + 0.2, s * (t.halfW + 0.008)]));
  addTo(b, 'cargo_box', parts, [cx, y0 + h / 2, 0]);
}

function stakeBed(b: TruckBuild): void {
  const kit = b.ctx.materials;
  const t = b.layout;
  const x0 = t.bedStartX;
  const x1 = t.xRear + 0.02;
  const deckY = t.frameTop + 0.14;
  const len = x0 - x1;
  const cx = (x0 + x1) / 2;
  // La cabecera delantera sobresale 0.15 m: es lo mas alto del camion.
  const top = t.H - 0.15;
  const paint = kit.paint(b.spec.paint);
  const post = kit.metal('dark');
  const parts: Object3D[] = [...subframe(b, x0, x1, deckY), box(len, 0.1, t.W - 0.02, kit.plastic('textured'), [cx, deckY + 0.05, 0])];
  const posts = Math.max(3, Math.round(len / 1.1));
  const boards = b.ctx.lod === 'low' ? 2 : 4;
  for (const s of [1, -1]) {
    const z = s * (t.halfW - 0.04);
    for (let i = 0; i <= posts; i++) parts.push(box(0.08, top - deckY, 0.08, post, [x0 - (len * i) / posts, (top + deckY) / 2, z]));
    for (let k = 0; k < boards; k++) {
      const y = deckY + 0.25 + ((top - deckY - 0.35) * k) / Math.max(1, boards - 1);
      parts.push(box(len, 0.14, 0.04, paint, [cx, y, z]));
    }
  }
  // Estacas delanteras (cabecera mas alta) y compuerta trasera baja.
  for (const z of [-0.5, 0, 0.5]) parts.push(box(0.08, top - deckY + 0.15, 0.08, post, [x0, (top + 0.15 + deckY) / 2, z * t.halfW]));
  for (let k = 0; k < boards; k++) {
    const y = deckY + 0.25 + ((top - deckY - 0.35) * k) / Math.max(1, boards - 1);
    parts.push(box(0.04, 0.14, t.W - 0.1, paint, [x0, y, 0]));
  }
  parts.push(box(0.05, 0.5, t.W - 0.1, paint, [x1, deckY + 0.3, 0]));
  addTo(b, 'stake_bed', parts, [cx, (deckY + top) / 2, 0]);
}

function dumpBody(b: TruckBuild): void {
  const kit = b.ctx.materials;
  const t = b.layout;
  const x0 = t.bedStartX - 0.05;
  const x1 = t.xRear + 0.05;
  const floorY = t.frameTop + 0.22;
  const top = Math.min(t.H - 0.35, floorY + 1.25);
  const h = top - floorY;
  const len = x0 - x1;
  const cx = (x0 + x1) / 2;
  const paint = kit.paint(b.spec.paint);
  const accent = kit.accent(b.spec.paint);
  const wall = 0.06;
  const halfW = t.halfW - 0.01;
  const parts: Object3D[] = [
    ...subframe(b, x0, x1, floorY - 0.02),
    box(len, wall, halfW * 2, paint, [cx, floorY + wall / 2, 0]),
    box(wall, h, halfW * 2, paint, [x0 - wall / 2, floorY + h / 2, 0]),
    box(wall * 1.5, h + 0.05, halfW * 2, paint, [x1 + wall, floorY + h / 2, 0]),
  ];
  for (const s of [1, -1]) {
    parts.push(box(len, h, wall, paint, [cx, floorY + h / 2, s * (halfW - wall / 2)]));
    // Borde superior y costillas verticales de refuerzo.
    parts.push(box(len + 0.04, 0.09, wall + 0.06, accent, [cx, top - 0.02, s * (halfW - wall / 2)]));
    const ribs = b.ctx.lod === 'low' ? 3 : 6;
    for (let i = 0; i <= ribs; i++) parts.push(box(0.07, h - 0.05, 0.05, accent, [x0 - 0.1 - ((len - 0.2) * i) / ribs, floorY + h / 2, s * (halfW + 0.02)]));
    // Bisagra de la compuerta.
    parts.push(box(0.12, 0.12, 0.12, kit.metal('dark'), [x1 + 0.05, top + 0.02, s * (halfW - 0.1)]));
  }
  // Visera que protege la cabina.
  const canopyLen = Math.min(0.9, Math.max(0.3, x0 - t.cabBackX + 0.55));
  parts.push(box(canopyLen, 0.05, halfW * 2, paint, [x0 + canopyLen / 2, top + 0.02, 0]));
  addTo(b, 'dump_body', parts, [cx, floorY + h / 2, 0]);

  // Cilindro telescopico de volteo entre la cabina y el volco.
  const cylX0 = x0 + 0.17;
  const stages = [0.16, 0.13, 0.1, 0.075];
  const cyl: Object3D[] = [];
  const stageH = (h - 0.1) / stages.length;
  stages.forEach((r, i) => cyl.push(cylY(r, stageH + 0.06, i === 0 ? kit.metal('dark') : kit.chrome(), [cylX0, floorY + stageH * (i + 0.5), 0], 18)));
  addTo(b, 'dump_cylinder', cyl, [cylX0, floorY + h / 2, 0]);
}

function fifthWheel(b: TruckBuild): void {
  const kit = b.ctx.materials;
  const t = b.layout;
  const fx = (t.rearAxles[0] + t.rearAxles[t.rearAxles.length - 1]) / 2 + 0.2;
  const fy = t.frameTop + 0.13;
  addTo(
    b,
    'fifth_wheel',
    [
      mesh(roundedBox(0.95, 0.09, 0.95, 0.03, 1), kit.metal('dark'), [fx, fy, 0]),
      box(0.4, 0.1, 0.22, kit.metal('steel'), [fx - 0.35, fy + 0.005, 0]),
      ...[1, -1].map((s) => box(0.3, 0.13, 0.1, kit.metal('dark'), [fx, fy - 0.1, s * 0.38])),
      // Placa antideslizante detras de la cabina.
      box(Math.max(0.3, t.bedStartX - (fx + 0.6)), 0.03, t.frameZ * 2 + 0.3, kit.metal('aluminum'), [(t.bedStartX + fx + 0.6) / 2, t.frameTop + 0.03, 0]),
    ],
    [fx, fy, 0],
  );
  // Guardafangos traseros tipo cuarto de rueda sobre el troque.
  const fenders: Object3D[] = [];
  for (const s of [1, -1]) fenders.push(box(t.rearAxles.length > 1 ? 2.2 : 1.1, 0.04, t.tireWR * 2 + 0.12, kit.plastic('black'), [fx - 0.2, t.rR * 2 + 0.12, s * (t.tr / 2)]));
  addTo(b, 'body', fenders);
}

// ---------------------------------------------------------------------------

const RIMS = { rim_fl: ['disc', 'spokes'], rim_fr: ['disc', 'spokes'], rim_rl: ['disc', 'spokes'], rim_rr: ['disc', 'spokes'] };

export const TRUCK: VehicleTemplate = {
  id: 'heavy-truck',
  family: 'heavy',
  body: 'truck',
  label: 'Camión furgón',
  defaults: {
    family: 'heavy',
    body: 'truck',
    dims: { lengthMm: 7200, widthMm: 2350, heightMm: 3350, wheelbaseMm: 4175, trackFrontMm: 1680, trackRearMm: 1650, groundClearanceMm: 210 },
    tireFront: { widthMm: 215, aspectPct: 75, rimIn: 17.5 },
    tireRear: { widthMm: 215, aspectPct: 75, rimIn: 17.5 },
  },
  shapeParams: [],
  variants: { ...RIMS, cab: CAB_VARIANTS },
  build(spec, ctx): BuiltVehicle {
    const b = buildTruckBase(spec, ctx, { cab: cabOf(spec, 'cabover'), tandem: false }, 'heavy-truck');
    cargoBox(b);
    return finishTruck(b);
  },
};

export const FLATBED: VehicleTemplate = {
  id: 'heavy-flatbed',
  family: 'heavy',
  body: 'flatbed',
  label: 'Camión de estacas',
  defaults: {
    family: 'heavy',
    body: 'flatbed',
    dims: { lengthMm: 7000, widthMm: 2300, heightMm: 2750, wheelbaseMm: 4175, trackFrontMm: 1680, trackRearMm: 1650, groundClearanceMm: 210 },
    tireFront: { widthMm: 215, aspectPct: 75, rimIn: 17.5 },
    tireRear: { widthMm: 215, aspectPct: 75, rimIn: 17.5 },
  },
  shapeParams: [],
  variants: { ...RIMS, cab: CAB_VARIANTS },
  build(spec, ctx): BuiltVehicle {
    const b = buildTruckBase(spec, ctx, { cab: cabOf(spec, 'cabover'), tandem: false }, 'heavy-flatbed');
    stakeBed(b);
    return finishTruck(b);
  },
};

export const DUMP: VehicleTemplate = {
  id: 'heavy-dump',
  family: 'heavy',
  body: 'dump',
  label: 'Volqueta doble troque',
  defaults: {
    family: 'heavy',
    body: 'dump',
    dims: { lengthMm: 8200, widthMm: 2550, heightMm: 3450, wheelbaseMm: 4900, trackFrontMm: 2050, trackRearMm: 1850, groundClearanceMm: 270 },
    tireFront: { widthMm: 295, aspectPct: 80, rimIn: 22.5 },
    tireRear: { widthMm: 295, aspectPct: 80, rimIn: 22.5 },
  },
  shapeParams: [],
  variants: { ...RIMS, cab: CAB_VARIANTS },
  build(spec, ctx): BuiltVehicle {
    const b = buildTruckBase(spec, ctx, { cab: cabOf(spec, 'conventional'), tandem: true }, 'heavy-dump');
    dumpBody(b);
    return finishTruck(b);
  },
};

export const TRACTOR: VehicleTemplate = {
  id: 'heavy-tractor',
  family: 'heavy',
  body: 'tractor',
  label: 'Tractomula',
  defaults: {
    family: 'heavy',
    body: 'tractor',
    dims: { lengthMm: 7800, widthMm: 2550, heightMm: 3800, wheelbaseMm: 5300, trackFrontMm: 2050, trackRearMm: 1850, groundClearanceMm: 270 },
    tireFront: { widthMm: 295, aspectPct: 80, rimIn: 22.5 },
    tireRear: { widthMm: 295, aspectPct: 80, rimIn: 22.5 },
  },
  shapeParams: [],
  variants: { ...RIMS, cab: CAB_VARIANTS },
  build(spec, ctx): BuiltVehicle {
    const b = buildTruckBase(spec, ctx, { cab: cabOf(spec, 'conventional'), tandem: true, sleeper: true }, 'heavy-tractor');
    fifthWheel(b);
    return finishTruck(b);
  },
};

export const HEAVY_TEMPLATES: VehicleTemplate[] = [TRUCK, FLATBED, DUMP, TRACTOR];
