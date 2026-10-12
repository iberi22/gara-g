/**
 * trail.ts — Motocicleta trail / doble proposito.
 *
 * Silueta: la mas alta y la mas larga de las cuatro. Lo que la delata sin marcas es la
 * horquilla larga con protectores, el manubrio alto y ancho, la rueda delantera grande de
 * 21", el escape alto bajo la cola y el guardabarros delantero alto.
 *
 * Ficha por defecto (mm): 2200 x 850 x 1300, entre ejes 1480, sillin 870,
 * 90/90-21 + 150/70-18. La rueda de 21 pulgadas (radio ~348 mm) frente a la trasera de 18
 * (~321 mm) es la combinacion que mas cambia el perfil.
 *
 * Diferencias mecanicas con el resto:
 *   - `variants.suspensionTravel` (0..1) ALARGA la horquilla y sube la direccion. No mueve
 *     la rueda: el piso sigue en y = 0, porque una moto estatica siempre apoya la llanta.
 *     Para eso el esqueleto (skeleton.ts) anade el recorrido a `steerTopY`.
 *   - `variants.forkKind` permite horquilla telescopica o invertida.
 */
import type { BuiltVehicle, ShapeParamDef, VehicleSpec, VehicleTemplate } from '../../contracts';
import { MotoAssembly } from './assembly';
import { box } from './box';
import { frameGeometry } from './chassis';
import { makeSkeleton, shapeParam, variantOf } from './skeleton';
import {
  bodyLoft,
  driveGeometry,
  engineGeometry,
  exhaustGeometry,
  fenderGeometry,
  forkGeometry,
  handlebarGeometry,
  headlightGeometry,
  internalParts,
  MIRROR_DROP,
  strut,
  swingarmGeometry,
  taillightGeometry,
  type Buckets,
} from './motoKit';
import { tube, type P2 } from '../common/geometry';
import { mm } from '../common/units';

const SHAPE_PARAMS: ShapeParamDef[] = [
  { id: 'suspensionTravel', label: 'Recorrido de suspension', default: 0.6, hint: 'Cuanto se alarga la horquilla' },
  { id: 'tankVolume', label: 'Volumen del tanque', default: 0.5, hint: 'Volumen del depósito' },
  { id: 'tailRise', label: 'Elevacion de la cola', default: 0.4, hint: 'Cuanto sube la cola' },
  { id: 'handlebarHeight', label: 'Altura del manubrio', default: 0.6, hint: 'Manubrio alto de campo a traves' },
];

const TR = {
  suspensionTravel: { id: 'suspensionTravel', default: 0.6 },
  tankVolume: { id: 'tankVolume', default: 0.5 },
  tailRise: { id: 'tailRise', default: 0.4 },
  handlebarHeight: { id: 'handlebarHeight', default: 0.6 },
} as const;

interface TrailAnchors {
  engineX: number;
  engineY: number;
  engineL: number;
  engineH: number;
  engineW: number;
  pivot: P2;
  seatTop: number;
  tankBottom: number;
}

/** Anclajes: motor vertical y alto (el trail va de pie), entre ejes largo. */
function trailAnchors(sk: ReturnType<typeof makeSkeleton>, seatTop: number): TrailAnchors {
  const engineX = sk.axleR[0] + sk.wb * 0.5;
  const engineY = sk.rF * 1.06;
  return {
    engineX,
    engineY,
    engineL: sk.wb * 0.26,
    engineH: sk.rF * 1.3,
    engineW: Math.min(0.29, sk.wb * 0.19),
    pivot: [sk.axleR[0] + sk.wb * 0.21, engineY - sk.rF * 0.34],
    seatTop,
    tankBottom: engineY + sk.rF * 1.02,
  };
}

/** Tanque trail: alto, anguloso y con "hombro" — la silueta de un deposito de trail. */
function trailTankGeometry(a: TrailAnchors, tankV: number, pts: number): Buckets {
  const baseY = a.tankBottom;
  const halfBase = 0.115 + tankV * 0.05;
  const topY = baseY + 0.16 + tankV * 0.09;
  return {
    paint: [
      bodyLoft({
        points: pts,
        sections: [
          { x: a.engineX - 0.3, halfWidthBottom: halfBase * 0.7, halfWidthTop: halfBase * 0.66, yBottom: baseY + 0.02, yTop: baseY + 0.12, n: 3 },
          { x: a.engineX - 0.17, halfWidthBottom: halfBase * 0.98, halfWidthTop: halfBase * 0.92, yBottom: baseY, yTop: topY - 0.02, n: 4 },
          { x: a.engineX - 0.02, halfWidthBottom: halfBase, halfWidthTop: halfBase * 0.86, yBottom: baseY, yTop: topY, n: 4 },
          { x: a.engineX + 0.12, halfWidthBottom: halfBase * 0.9, halfWidthTop: halfBase * 0.7, yBottom: baseY + 0.01, yTop: topY - 0.03, n: 4 },
          { x: a.engineX + 0.23, halfWidthBottom: halfBase * 0.6, halfWidthTop: halfBase * 0.4, yBottom: baseY + 0.05, yTop: topY - 0.07, n: 3 },
        ],
      }),
    ],
  };
}

/** Cola trail: larga, con subchasis visible y poco inclinada. */
function trailTailGeometry(sk: ReturnType<typeof makeSkeleton>, a: TrailAnchors, tailRise: number, pts: number): Buckets {
  const rise = tailRise * 0.07;
  const tailTop = a.seatTop + rise + 0.085;
  return {
    paint: [
      bodyLoft({
        points: pts,
        sections: [
          { x: a.engineX - 0.14, halfWidthBottom: 0.11, halfWidthTop: 0.095, yBottom: a.seatTop - 0.06, yTop: a.seatTop + 0.02, n: 3 },
          { x: a.engineX - 0.3, halfWidthBottom: 0.13, halfWidthTop: 0.11, yBottom: a.seatTop - 0.05, yTop: a.seatTop + 0.055 + rise * 0.6, n: 4 },
          { x: a.engineX - 0.48, halfWidthBottom: 0.115, halfWidthTop: 0.09, yBottom: a.seatTop - 0.04, yTop: tailTop, n: 4 },
          { x: sk.axleR[0] + 0.18, halfWidthBottom: 0.08, halfWidthTop: 0.05, yBottom: a.seatTop - 0.03, yTop: tailTop - 0.02, n: 3 },
          { x: sk.axleR[0] + 0.04, halfWidthBottom: 0.05, halfWidthTop: 0.03, yBottom: a.seatTop - 0.015, yTop: tailTop - 0.035, n: 3 },
        ],
      }),
    ],
  };
}

/**
 * Protectores de horquilla: la "banana" de plastico sobre la barra de suspension. Es
 * el detalle que mas dice "trail" de una moto y lo mas visible en el perfil.
 */
function forkGuardsGeometry(sk: ReturnType<typeof makeSkeleton>, halfZ: number): Buckets {
  const out: Buckets = {};
  const topY = sk.steerTopY - 0.1;
  const botY = sk.axleF[1] + sk.rF * 0.12;
  for (const s of [1, -1]) {
    out.plastic = [
      ...(out.plastic ?? []),
      strut([sk.forkAt(topY)[0], topY, s * halfZ], [sk.forkAt(botY)[0], botY, s * halfZ], 0.04, 10, 0.034),
    ];
  }
  return out;
}

/** Subchasis: celosia que une el chasis con el asiento y la cola. */
function trailSubframe(sk: ReturnType<typeof makeSkeleton>, a: TrailAnchors, high: boolean): Buckets {
  const out: Buckets = {};
  const z = 0.08;
  const y0 = a.pivot[1] + a.engineH * 0.16;
  for (const s of [1, -1]) {
    out.dark = [
      ...(out.dark ?? []),
      tube(
        [
          [a.pivot[0] + 0.05, y0, s * z],
          [a.pivot[0] - 0.16, a.seatTop - 0.06, s * z * 0.95],
          [sk.axleR[0] + 0.34, a.seatTop - 0.05, s * z * 0.8],
          [sk.axleR[0] + 0.1, a.seatTop - 0.025, s * z * 0.6],
        ],
        0.015,
        { segments: 36, radial: 8 },
      ),
    ];
  }
  if (high) {
    for (const x of [a.pivot[0] - 0.05, a.pivot[0] - 0.2, sk.axleR[0] + 0.28, sk.axleR[0] + 0.14]) {
      out.dark = [...(out.dark ?? []), strut([x, a.seatTop - 0.055, -z * 0.85], [x, a.seatTop - 0.055, z * 0.85], 0.011, 6)];
    }
  }
  return out;
}

export const TRAIL: VehicleTemplate = {
  id: 'moto-trail',
  family: 'moto',
  body: 'trail',
  label: 'Moto trail / doble propósito',
  defaults: {
    family: 'moto',
    body: 'trail',
    dims: { lengthMm: 2200, widthMm: 850, heightMm: 1300, wheelbaseMm: 1480, seatHeightMm: 870, groundClearanceMm: 250 },
    tireFront: { widthMm: 90, aspectPct: 90, rimIn: 21 },
    tireRear: { widthMm: 150, aspectPct: 70, rimIn: 18 },
  },
  shapeParams: SHAPE_PARAMS,
  variants: {
    exhaust: ['under', 'high'],
    fork: ['telescopica', 'invertida'],
    rim_front: ['mesh', 'spokes', 'disc'],
    rim_rear: ['mesh', 'spokes', 'disc'],
  },

  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const high = ctx.lod === 'high';
    const pts = high ? 26 : 14;
    const width = mm(spec.dims.widthMm);
    const height = mm(spec.dims.heightMm);
    const seatTop = mm(spec.dims.seatHeightMm ?? 870);
    const mirrorTopY = height;
    const mirrorHalf = width / 2;

    // El recorrido de suspension ALARGA la horquilla (subida `steerTopY`), no baja la
    // rueda: el piso tiene que seguir en y = 0. Ver skeleton.ts.
    const travel = shapeParam(spec, TR.suspensionTravel);
    const sk = makeSkeleton(spec, { rakeDeg: 26.5, forkOffsetMm: 34, steerTopY: 0.6, travelRangeM: 0.16 });
    const a = trailAnchors(sk, seatTop);
    const tankV = shapeParam(spec, TR.tankVolume);
    const tailRise = shapeParam(spec, TR.tailRise);
    const forkKind = variantOf(spec, 'fork', ['telescopica', 'invertida'], 'invertida') === 'invertida' ? 'invertida' : 'telescopica';
    // Manubrio alto de trail: claramente por encima de la linea del asiento/tanque, pero
    // SIEMPRE por debajo de los espejos (que son los que fijan el alto de la ficha).
    // Un trail real lleva la barra a 1050-1100 mm con sillin en 870.
    const barY = Math.min(
      mirrorTopY - 0.19,
      seatTop + 0.16 + shapeParam(spec, TR.handlebarHeight) * 0.07 + travel * 0.055,
    );

    const asm = new MotoAssembly({ templateId: TRAIL.id, spec, ctx, sk });
    // Radios de alambre: `mesh` es el estilo mas cercano a un rin de trial.
    asm.wheels({ frontStyle: 'mesh', rearStyle: 'mesh', frontSpokes: 16, rearSpokes: 16 });

    asm.add(
      'frame',
      frameGeometry({ sk, ctx, kind: 'cradle', topY: a.engineY + a.engineH * 0.52, engineLowY: a.engineY - a.engineH * 0.42, engineX: a.engineX, pivot: a.pivot, halfZ: 0.125 }),
    );
    asm.add('frame', trailSubframe(sk, a, high));
    asm.add(
      'engine',
      engineGeometry({ sk, ctx, center: [a.engineX, a.engineY], length: a.engineL, height: a.engineH, width: a.engineW, layout: 'inline', fins: 4 }),
    );
    const rear = swingarmGeometry({ sk, ctx, pivot: a.pivot, shockTop: [a.engineX - 0.22, a.engineY + a.engineH * 0.72], halfZ: 0.098 });
    asm.add('swingarm', rear.swingarm);
    asm.add('shock_rear', rear.shock);
    asm.focusOn('shock_rear', [a.engineX - 0.12, a.engineY + a.engineH * 0.5, 0]);
    asm.add('drive', driveGeometry({ sk, ctx, kind: 'chain', engineCenter: [a.engineX, a.engineY], rearTireWidth: mm(spec.tireRear.widthMm) }));
    // Escape alto bajo la cola: es la ruta del trail, la del naked es lateral.
    const style = variantOf(spec, 'exhaust', ['under', 'high'], 'high') === 'high' ? 'high' : 'under';
    asm.add(
      'exhaust',
      exhaustGeometry({
        sk,
        ctx,
        style,
        engineCenter: [a.engineX, a.engineY],
        pipeR: 0.023,
        headerEnd: [a.engineX + a.engineL * 0.6, a.engineY + 0.04],
        // El colector alto sale por debajo de la cola, no por detras de la rueda: si
        // llega mas atras que el eje, en el perfil se ve flotando desconectado.
        outY: style === 'high' ? a.seatTop - 0.01 : sk.rR * 0.5,
        side: -1,
      }),
    );
    const forkZ = 0.082;
    asm.add('fork', forkGeometry({ sk, ctx, kind: forkKind, halfZ: forkZ }));
    asm.add('bodywork', forkGuardsGeometry(sk, forkZ));
    const bar = handlebarGeometry({
      sk,
      ctx,
      barY,
      halfWidth: mirrorHalf - 0.07,
      riserHalf: 0.135,
      shape: 'wide',
      mirrorHalf,
      mirrorTopY,
    });
    asm.add('handlebar', bar.handlebar);
    asm.add('mirrors', bar.mirrors);

    // Carroceria: tanque, cola, sillin y guardabarros (el delantero alto es clave).
    asm.add('fuel_tank', trailTankGeometry(a, tankV, pts));
    asm.add('bodywork', trailTailGeometry(sk, a, tailRise, pts));
    const stepRise = 0.03 * (0.6 + 0.4 * tailRise);
    asm.add(
      'seat',
      {
        seat: [
          bodyLoft({
            points: Math.max(10, pts - 6),
            sections: [
              { x: a.engineX - 0.1, halfWidthBottom: 0.09, halfWidthTop: 0.075, yBottom: a.seatTop - 0.05, yTop: a.seatTop, n: 3 },
              { x: a.engineX - 0.22, halfWidthBottom: 0.115, halfWidthTop: 0.1, yBottom: a.seatTop - 0.045, yTop: a.seatTop, n: 4 },
              { x: a.engineX - 0.36, halfWidthBottom: 0.12, halfWidthTop: 0.1, yBottom: a.seatTop - 0.035, yTop: a.seatTop, n: 4 },
              { x: a.engineX - 0.5, halfWidthBottom: 0.1, halfWidthTop: 0.075, yBottom: a.seatTop - 0.02, yTop: a.seatTop + stepRise * 0.7, n: 3 },
              { x: a.engineX - 0.6, halfWidthBottom: 0.06, halfWidthTop: 0.04, yBottom: a.seatTop, yTop: a.seatTop + stepRise, n: 3 },
            ],
          }),
        ],
      },
    );
    // Guardabarros delantero alto y con faldon: el rasgo de un trail. El radio es mayor
    // que el de la llanta (695 mm) y el arco arranca bien por delante, de modo que se ve
    // como un guardabarros y no como una hugging cercana a la llanta.
    const frontFR = sk.rF + 0.075;
    const frontF = fenderGeometry({ center: sk.axleF, radius: frontFR, width: 0.2, a0: 0.35, a1: 2.35, thickness: 0.012 });
    asm.add('bodywork', { paint: [frontF] });
    // Puntal del guardabarros delantero a la horquilla.
    // Puntal del guardabarros: de la horquilla al arco, por delante.
    asm.add('bodywork', {
      alu: [
        strut(
          [sk.axleF[0] + frontFR * 0.62, sk.axleF[1] + frontFR * 0.78, 0.1],
          [sk.forkAt(sk.axleF[1] + sk.rF * 0.62)[0], sk.axleF[1] + sk.rF * 0.62, forkZ + 0.03],
          0.012,
          8,
        ),
      ],
    });
    const rearFR = sk.rR + 0.03;
    asm.add('bodywork', {
      plastic: [fenderGeometry({ center: sk.axleR, radius: rearFR, width: 0.21, a0: 0.4, a1: 1.75, thickness: 0.01, skew: -0.03 })],
    });
    asm.add('bodywork', {
      alu: [strut([sk.axleR[0] + rearFR * 0.7, sk.axleR[1] + rearFR * 0.68, 0.1], [sk.axleR[0] + 0.18, sk.axleR[1] + 0.03, 0.095], 0.01, 8)],
    });
    // Portapaquetas trasero: el detalle que dice "trail" en el perfil.
    asm.add('bodywork', { alu: [box(0.14, 0.008, 0.16, 0.004, 1).translate(sk.axleR[0] + 0.28, a.seatTop + 0.02 + tailRise * 0.07, 0)] });

    // Luces: faro alto montado en el guardabarros, como en un trail.
    const headAt: P2 = [sk.forkAt(sk.axleF[1] + sk.rF * 0.95)[0] + 0.03, sk.axleF[1] + sk.rF * 0.92];
    asm.add('headlight', headlightGeometry({ ctx, center: headAt, radius: 0.062 }));
    asm.add('taillight', taillightGeometry({ ctx, at: [sk.axleR[0] + 0.06, a.seatTop + 0.055 + tailRise * 0.07, 0] }));

    for (const [slot, buckets] of Object.entries(
      internalParts({ ctx, engineCenter: [a.engineX, a.engineY], engineLength: a.engineL, engineHeight: a.engineH, engineWidth: a.engineW, seatTopY: seatTop, rearX: sk.axleR[0] }),
    )) {
      asm.add(slot, buckets as Buckets);
    }

    asm.focusOn('fuel_tank', [a.engineX, a.tankBottom + 0.12, 0]);
    asm.focusOn('bodywork', [sk.axleF[0] + sk.rF * 0.5, sk.axleF[1] + sk.rF * 0.9, 0]);
    asm.focusOn('seat', [a.engineX - 0.3, seatTop, 0]);
    asm.focusOn('engine', [a.engineX + 0.05, a.engineY + a.engineH * 0.4, 0]);
    asm.focusOn('handlebar', [sk.axisAt(sk.steerTopY)[0], barY, 0]);
    asm.focusOn('mirrors', [sk.axisAt(sk.steerTopY)[0], mirrorTopY - MIRROR_DROP, mirrorHalf]);
    asm.focusOn('exhaust', [sk.axleR[0] + 0.2, a.seatTop + 0.02, -0.08]);
    asm.focusOn('drive', [a.engineX - 0.2, a.engineY - sk.rR * 0.1, 0.09]);
    asm.focusOn('headlight', [headAt[0], headAt[1], 0]);
    asm.focusOn('fork', [sk.forkAt((sk.steerTopY + sk.axleF[1]) / 2)[0], (sk.steerTopY + sk.axleF[1]) / 2, 0]);
    asm.focusOn('frame', [a.engineX - 0.1, a.engineY, 0]);

    return asm.finish();
  },
};