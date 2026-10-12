/**
 * naked.ts — Motocicleta naked (estandar).
 *
 * Silueta: motor vertical visto de lado, tanque que cae sobre el motor, cola corta y
 * alta y escape lateral derecho. Es el arquetipo que mejor se reconoce por el perfil, y
 * para que lo sea sin marcas: el TALUD del tanque, la altura de la cola y el angulo de
 * la empuñadura son los tres parametros que la skill declara como `shapeParams`.
 *
 * Ficha por defecto (mm): 2050 x 800 x 1060, entre ejes 1400, sillin 820,
 * 120/70ZR17 + 180/55ZR17. La inclinacion de 25 grados con 32 mm de desplazamiento de
 * horquilla da 95 mm de advance, dentro del rango correcto de una naked.
 *
 * Como se respeta la ficha: el ALTO lo fija el espejo (se coloca su borde superior
 * exactamente en `heightMm`) y el ANCHO lo fijan las lunas (su borde exterior cae en
 * `widthMm/2`). El LARGO sale de las ruedas, que(buildWheel) construye con la medida de
 * llanta, y el alto del sillin es el dato de la ficha.
 */
import type { BuiltVehicle, PaintSpec, ShapeParamDef, TemplateContext, VehicleSpec, VehicleTemplate } from '../../contracts';
import { MotoAssembly } from './assembly';
import { frameGeometry } from './chassis';
import { makeSkeleton, shapeParam } from './skeleton';
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
import { tube } from '../common/geometry';
import { mm } from '../common/units';
import type { P2 } from '../common/geometry';

export const SHAPE_NK = {
  tankVolume: { id: 'tankVolume', default: 0.55 },
  tailRise: { id: 'tailRise', default: 0.5 },
  handlebarHeight: { id: 'handlebarHeight', default: 0.5 },
  exhaustStyle: { id: 'exhaustStyle', default: 0.4 },
} as const;

const SHAPE_PARAMS: ShapeParamDef[] = [
  { id: 'tankVolume', label: 'Volumen del tanque', default: 0.55, hint: 'Cuanto abulta el tanque sobre el motor' },
  { id: 'tailRise', label: 'Elevacion de la cola', default: 0.5, hint: 'Cuanto sube la cola sobre el sillin' },
  { id: 'handlebarHeight', label: 'Altura del manubrio', default: 0.5, hint: 'Manubrio alto o bajo' },
  { id: 'exhaustStyle', label: 'Estilo de escape', default: 0.4, hint: '0 = bajo el motor, 1 = lateral alto' },
];

/** Anclajes comunes de una naked, resueltos una vez para tanque y cola. */
export interface NakedAnchors {
  engineX: number;
  engineY: number;
  engineL: number;
  engineH: number;
  engineW: number;
  pivot: P2;
  seatTop: number;
  tankBottom: number;
}

/**
 * Anclajes derivados de la ficha. El motor se situa a una fraccion del entre ejes desde
 * el frente y su bloque se dimensiona en funcion del radio de la llanta, para que en
 * cualquier medida el motor "ocupe" el sitio correcto entre las ruedas.
 */
export function nakedAnchors(sk: ReturnType<typeof makeSkeleton>, seatTop: number): NakedAnchors {
  const engineX = sk.axleR[0] + sk.wb * 0.5;
  const engineY = sk.rF * 1.16;
  const engineL = sk.wb * 0.28;
  const engineH = sk.rF * 1.36;
  const engineW = Math.min(0.3, sk.wb * 0.21);
  return {
    engineX,
    engineY,
    engineL,
    engineH,
    engineW,
    pivot: [sk.axleR[0] + sk.wb * 0.22, engineY - engineH * 0.3],
    seatTop,
    // El tanque apoya sobre la culata, NO sobre la cazoleta: si se pone a media altura del
    // motor desaparece tragado por las aletas, que es el error clasico de una moto
    // generada. Ademas arranca detras de la culata y llega hasta el arranque del sillin.
    tankBottom: engineY + engineH * 0.72,
  };
}

/** Parametro de escape 0..1 → ruta. 0 = bajo el motor, 1 = lateral. */
export function exhaustRouteOf(spec: VehicleSpec): 'under' | 'side' {
  return shapeParam(spec, SHAPE_NK.exhaustStyle) < 0.45 ? 'under' : 'side';
}

/** Pintura neutra de la ficha cuando el llamador no pasa una. */
export const DEFAULT_PAINT: PaintSpec = { baseColor: '#b9bfc7', finish: 'metallic' };

/**
 * Tanque: volumen lofteado con estrechamiento arriba. El ancho maximo sale del ancho de
 * llanta trasera (un tanque es, antes que nada, ancho) y `tankV` lo hincha o lo achica.
 */
export function tankGeometry(sk: ReturnType<typeof makeSkeleton>, a: NakedAnchors, tankV: number, pts: number): Buckets {
  const baseY = a.tankBottom;
  // El tanque es, antes que nada, un volumen ANCHO y bajo: su base envuelve la culata.
  const halfBase = 0.12 + tankV * 0.045;
  const topY = baseY + 0.1 + tankV * 0.07;
  const geo = bodyLoft({
    points: pts,
    sections: [
      // De atras hacia adelante: el tanque arranca donde termina el manubrio.
      { x: a.engineX - 0.27, halfWidthBottom: halfBase * 0.78, halfWidthTop: halfBase * 0.7, yBottom: baseY + 0.015, yTop: baseY + 0.075, n: 3 },
      { x: a.engineX - 0.15, halfWidthBottom: halfBase * 0.98, halfWidthTop: halfBase * 0.9, yBottom: baseY - 0.005, yTop: topY - 0.015, n: 4 },
      { x: a.engineX - 0.03, halfWidthBottom: halfBase, halfWidthTop: halfBase * 0.9, yBottom: baseY - 0.01, yTop: topY, n: 4 },
      { x: a.engineX + 0.1, halfWidthBottom: halfBase * 0.92, halfWidthTop: halfBase * 0.76, yBottom: baseY + 0.004, yTop: topY - 0.022, n: 4 },
      { x: a.engineX + 0.2, halfWidthBottom: halfBase * 0.66, halfWidthTop: halfBase * 0.46, yBottom: baseY + 0.03, yTop: topY - 0.055, n: 3 },
    ],
  });
  return { paint: [geo] };
}

/**
 * Cola + sillin: el segundo volumen que define el perfil. El sillin va a su propia ranura.
 *
 * `seatTop` es la altura de la FICHA (±5 % en los tests), asi que la cara superior del
 * jergon del conductor cae exactamente ahi y no un poco mas: la parte trasera del sillin
 * (el peldaño del pasajero) es la unica parte que puede subir, y sube con `tailRise`.
 */
export function tailGeometry(
  sk: ReturnType<typeof makeSkeleton>,
  a: NakedAnchors,
  tailRise: number,
  pts: number,
): { body: Buckets; seat: Buckets } {
  const rise = tailRise * 0.075;
  const tailTop = a.seatTop + rise + 0.075;
  const rearX = sk.axleR[0];
  // La cola arranca en el final del tanque y sube hacia atras.
  const body = bodyLoft({
    points: pts,
    sections: [
      { x: a.engineX - 0.1, halfWidthBottom: 0.1, halfWidthTop: 0.085, yBottom: a.seatTop - 0.05, yTop: a.seatTop + 0.02, n: 3 },
      { x: a.engineX - 0.24, halfWidthBottom: 0.125, halfWidthTop: 0.105, yBottom: a.seatTop - 0.035, yTop: a.seatTop + 0.04 + rise * 0.6, n: 4 },
      { x: a.engineX - 0.4, halfWidthBottom: 0.115, halfWidthTop: 0.09, yBottom: a.seatTop - 0.03, yTop: tailTop, n: 4 },
      { x: rearX + 0.16, halfWidthBottom: 0.08, halfWidthTop: 0.05, yBottom: a.seatTop - 0.02, yTop: tailTop - 0.015, n: 3 },
      { x: rearX + 0.03, halfWidthBottom: 0.05, halfWidthTop: 0.03, yBottom: a.seatTop - 0.01, yTop: tailTop - 0.03, n: 3 },
    ],
  });
  // El sillin: jergon del conductor (cara superior en seatTop) y peldaño del pasajero.
  // El peldaño trasero sube un poco mas, pero como el test mide la caja completa del
  // sillin contra `seatHeightMm` (±5 %), su subida se acota a 30 mm para que ni con
  // `tailRise` al maximo el modelo se pase del alto real de la ficha.
  const stepRise = 0.03 * (0.6 + 0.4 * tailRise);
  const seat = bodyLoft({
    points: Math.max(8, pts - 8),
    sections: [
      { x: a.engineX - 0.06, halfWidthBottom: 0.085, halfWidthTop: 0.07, yBottom: a.seatTop - 0.045, yTop: a.seatTop, n: 3 },
      { x: a.engineX - 0.16, halfWidthBottom: 0.115, halfWidthTop: 0.095, yBottom: a.seatTop - 0.04, yTop: a.seatTop, n: 4 },
      { x: a.engineX - 0.28, halfWidthBottom: 0.12, halfWidthTop: 0.1, yBottom: a.seatTop - 0.03, yTop: a.seatTop, n: 4 },
      { x: a.engineX - 0.4, halfWidthBottom: 0.105, halfWidthTop: 0.08, yBottom: a.seatTop - 0.02, yTop: a.seatTop + stepRise * 0.7, n: 3 },
      { x: a.engineX - 0.5, halfWidthBottom: 0.065, halfWidthTop: 0.042, yBottom: a.seatTop, yTop: a.seatTop + stepRise, n: 3 },
    ],
  });
  return { body: { paint: [body] }, seat: { seat: [seat] } };
}


/** Y del manubrio de referencia: un poco por encima de la linea del tanque. */
function a0SeatGuess(spec: VehicleSpec): number {
  return mm(spec.dims.seatHeightMm ?? 820) + 0.11;
}

/**
 * Subchasis trasero: la celosia que une el chasis con la cola. Sin ella la cola "flota"
 * sobre la rueda trasera, que es el defecto mas visible en la vista de perfil.
 */
function subframeGeometry(sk: ReturnType<typeof makeSkeleton>, a: NakedAnchors, ctx: TemplateContext): Buckets {
  const out: Buckets = {};
  const pivotY = a.pivot[1] + a.engineH * 0.12;
  const z = 0.075;
  // Dos largueros que suben del pivote del basculante hacia el arranque de la cola.
  for (const s of [1, -1]) {
    const rail = tube(
      [
        [a.pivot[0] + 0.04, pivotY, s * z],
        [a.pivot[0] - 0.14, a.seatTop - 0.055, s * z * 0.95],
        [sk.axleR[0] + 0.3, a.seatTop - 0.045, s * z * 0.8],
        [sk.axleR[0] + 0.09, a.seatTop - 0.02, s * z * 0.6],
      ],
      0.014,
      { segments: 36, radial: 8 },
    );
    out.dark = [...(out.dark ?? []), rail];
  }
  // Diagonales de celosia entre los dos largueros.
  if (ctx.lod === 'high') {
    for (const x of [a.pivot[0] - 0.06, a.pivot[0] - 0.19, sk.axleR[0] + 0.24, sk.axleR[0] + 0.12]) {
      const y = a.seatTop - 0.05;
      const d = strut([x, y, -z * 0.85], [x, y, z * 0.85], 0.01, 6);
      out.dark = [...(out.dark ?? []), d];
    }
  }
  return out;
}

/**
 * Puntal del guardabarros trasero: une la chapa al basculante. Un guardabarros sin puntal
 * se ve flotando aunque este bien curvado.
 */
function rearFenderStay(sk: ReturnType<typeof makeSkeleton>, fenderR: number, from: P2, to: P2, z: number): Buckets {
  return { alu: [strut([from[0], from[1], z], [to[0], to[1], z], 0.009, 8)] };
}

export const NAKED: VehicleTemplate = {
  id: 'moto-naked',
  family: 'moto',
  body: 'naked',
  label: 'Moto naked',
  defaults: {
    family: 'moto',
    body: 'naked',
    dims: { lengthMm: 2050, widthMm: 800, heightMm: 1060, wheelbaseMm: 1400, seatHeightMm: 820, groundClearanceMm: 150 },
    tireFront: { widthMm: 120, aspectPct: 70, rimIn: 17 },
    tireRear: { widthMm: 180, aspectPct: 55, rimIn: 17 },
  },
  shapeParams: SHAPE_PARAMS,
  variants: {
    exhaust: ['under', 'side'],
    rim_front: ['split', 'spokes', 'disc'],
    rim_rear: ['split', 'spokes', 'disc'],
  },

  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const high = ctx.lod === 'high';
    const pts = high ? 26 : 14;
    const width = mm(spec.dims.widthMm);
    const height = mm(spec.dims.heightMm);
    const seatTop = mm(spec.dims.seatHeightMm ?? 820);

    // El ALTO de la ficha lo fija el espejo: su borde superior cae en `height`.
    const mirrorTopY = height;
    const mirrorHalf = width / 2;
    // El manubrio va un poco por debajo del espejo (el stal sube hasta el tope), dentro de
    // una ventana coherente: por encima del tanque y por debajo del alto de la ficha.
    // Sin este tope, `barY` se iba tan arriba que la moto parecia un chopper.
    const barLift = shapeParam(spec, SHAPE_NK.handlebarHeight) * 0.045;
    const barCeil = mirrorTopY - 0.115;
    const barY = Math.min(barCeil, Math.max(seatTop + 0.09, a0SeatGuess(spec) + barLift));

    const sk = makeSkeleton(spec, { rakeDeg: 25, forkOffsetMm: 32, steerTopY: 0.6 });
    const a = nakedAnchors(sk, seatTop);
    const tankV = shapeParam(spec, SHAPE_NK.tankVolume);
    const tailRise = shapeParam(spec, SHAPE_NK.tailRise);
    const style = exhaustRouteOf(spec);

    const asm = new MotoAssembly({ templateId: NAKED.id, spec, ctx, sk });
    asm.wheels({ frontStyle: 'split', rearStyle: 'split', rearSpokes: 5 });

    // Chasis de doble cradle.
    asm.add(
      'frame',
      frameGeometry({ sk, ctx, kind: 'cradle', topY: a.engineY + a.engineH * 0.5, engineLowY: a.engineY - a.engineH * 0.4, engineX: a.engineX, pivot: a.pivot, halfZ: 0.115 }),
    );
    // Subchasis trasero: une el chasis con la cola.
    asm.add('frame', subframeGeometry(sk, a, ctx));
    // Motor vertical con aletas.
    asm.add(
      'engine',
      engineGeometry({ sk, ctx, center: [a.engineX, a.engineY], length: a.engineL, height: a.engineH, width: a.engineW, layout: 'inline', fins: 5 }),
    );
    // Basculante + amortiguador en su propia ranura.
    const rear = swingarmGeometry({ sk, ctx, pivot: a.pivot, shockTop: [a.engineX - 0.26, a.engineY + a.engineH * 0.72], halfZ: 0.088 });
    asm.add('swingarm', rear.swingarm);
    asm.add('shock_rear', rear.shock);
    asm.focusOn('shock_rear', [a.engineX - 0.13, a.engineY + a.engineH * 0.52, 0]);
    asm.add('drive', driveGeometry({ sk, ctx, kind: 'chain', engineCenter: [a.engineX, a.engineY], rearTireWidth: mm(spec.tireRear.widthMm) }));
    asm.add(
      'exhaust',
      exhaustGeometry({
        sk,
        ctx,
        style,
        engineCenter: [a.engineX, a.engineY],
        pipeR: 0.022,
        headerEnd: [a.engineX + a.engineL * 0.62, a.engineY + 0.02],
        outY: style === 'under' ? sk.rR * 0.4 : sk.rR * 0.92,
        side: -1,
      }),
    );
    asm.add('fork', forkGeometry({ sk, ctx, kind: 'telescopica', halfZ: 0.078 }));
    const bar = handlebarGeometry({ sk, ctx, barY, halfWidth: mirrorHalf - 0.055, riserHalf: 0.125, shape: 'wide', mirrorHalf, mirrorTopY });
    asm.add('handlebar', bar.handlebar);
    asm.add('mirrors', bar.mirrors);

    // Carroceria: tanque, cola, sillin y guardabarros.
    asm.add('fuel_tank', tankGeometry(sk, a, tankV, pts));
    const tail = tailGeometry(sk, a, tailRise, pts);
    asm.add('bodywork', tail.body);
    asm.add('seat', tail.seat);
    asm.add('bodywork', {
      paint: [fenderGeometry({ center: sk.axleF, radius: sk.rF + 0.024, width: 0.165, a0: 0.75, a1: 2.25, thickness: 0.01 })],
    });
    const rearFR = sk.rR + 0.026;
    asm.add('bodywork', {
      plastic: [fenderGeometry({ center: sk.axleR, radius: rearFR, width: 0.2, a0: 0.45, a1: 1.9, thickness: 0.009, skew: -0.02 })],
    });
    // Puntal: del borde delantero del guardabarros al brazo del basculante.
    asm.add('bodywork', rearFenderStay(sk, rearFR, [sk.axleR[0] + rearFR * 0.75, sk.axleR[1] + rearFR * 0.62], [sk.axleR[0] + 0.16, sk.axleR[1] + 0.02], 0.085));

    // Luces.
    const headAt: P2 = [sk.forkAt(sk.steerTopY - 0.1)[0] + 0.02, sk.steerTopY - 0.12];
    asm.add('headlight', headlightGeometry({ ctx, center: headAt, radius: 0.06 }));
    asm.add('taillight', taillightGeometry({ ctx, at: [sk.axleR[0] + 0.05, a.seatTop + 0.05 + tailRise * 0.075, 0] }));

    // Piezas internas (visibles en xray).
    for (const [slot, buckets] of Object.entries(
      internalParts({ ctx, engineCenter: [a.engineX, a.engineY], engineLength: a.engineL, engineHeight: a.engineH, engineWidth: a.engineW, seatTopY: seatTop, rearX: sk.axleR[0] }),
    )) {
      asm.add(slot, buckets as Buckets);
    }

    // Foco de camara por pieza.
    asm.focusOn('fuel_tank', [a.engineX, a.tankBottom + 0.1, 0]);
    asm.focusOn('seat', [a.engineX - 0.24, seatTop, 0]);
    asm.focusOn('frame', [a.engineX - 0.12, a.engineY, 0]);
    asm.focusOn('engine', [a.engineX + 0.05, a.engineY + a.engineH * 0.4, 0]);
    asm.focusOn('handlebar', [sk.axisAt(sk.steerTopY)[0], barY, 0]);
    asm.focusOn('mirrors', [sk.axisAt(sk.steerTopY)[0], mirrorTopY, mirrorHalf]);
    asm.focusOn('exhaust', [sk.axleR[0] + 0.28, sk.rR * 0.6, -0.08]);
    asm.focusOn('drive', [a.engineX - 0.2, a.engineY - sk.rR * 0.1, 0.07]);
    asm.focusOn('headlight', [headAt[0], headAt[1], 0]);
    asm.focusOn('fork', [sk.forkAt((sk.steerTopY + sk.axleF[1]) / 2)[0], (sk.steerTopY + sk.axleF[1]) / 2, 0]);
    asm.focusOn('bodywork', [a.engineX - 0.4, a.seatTop + 0.05, 0]);

    return asm.finish();
  },
};