/**
 * scooter.ts — Scooter.
 *
 * Silueta: la unica de las cuatro que NO tiene ni motor visible ni basculante. Todo lo
 * reconocible esta en el perfil: el "step-through" (elPie pasa por debajo del manubrio
 * sin subir al tanque), el escudo frontal grande y vertical, el sillin largo y plano, y
 * la rueda trasera alojada en un grosor de carenaje.
 *
 * Ficha por defecto (mm): 1935 x 740 x 1160, entre ejes 1340, sillin 765,
 * 110/70-13 + 130/70-13. Las llantas de 13 pulgadas dan ruedas pequeñas (radio ~242 mm),
 * asi que el entre ejes corto y el alto de escudo se notan mucho mas que en las otras.
 *
 * Diferencias mecanicas con el resto de plantillas:
 *   - `drive` es la transmision CVT (carcasa a la izquierda), no cadena: por eso
 *     driveGeometry(kind: 'cvt').
 *   - `fuel_tank` va BAJO el sillin, dentro del volumen de cola (no se ve desde fuera,
 *     pero tiene que existir y estar en su sitio para el modo xray).
 *   - `bodywork` lleva el escudo y los faldones, que son el 70 % del modelo.
 */
import type { BufferGeometry } from 'three/webgpu';
import type { BuiltVehicle, ShapeParamDef, VehicleSpec, VehicleTemplate } from '../../contracts';
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
  swingarmGeometry,
  taillightGeometry,
  type Buckets,
} from './motoKit';
import { box, plate } from './box';
import { tube, type P2 } from '../common/geometry';
import { mm } from '../common/units';

const SHAPE_PARAMS: ShapeParamDef[] = [
  { id: 'shieldCoverage', label: 'Cobertura del escudo', default: 0.7, hint: 'Cuanto cubre el escudo frontal el motor' },
  { id: 'seatLength', label: 'Largo del sillin', default: 0.5, hint: 'Sillin corto de ciudad o largo' },
  { id: 'handlebarHeight', label: 'Altura del manubrio', default: 0.5, hint: 'Manubrio mas o menos alto' },
  { id: 'tankVolume', label: 'Volumen del tanque', default: 0.5, hint: 'Capacidad bajo el sillin' },
];

const SC = {
  shieldCoverage: { id: 'shieldCoverage', default: 0.7 },
  seatLength: { id: 'seatLength', default: 0.5 },
  handlebarHeight: { id: 'handlebarHeight', default: 0.5 },
  tankVolume: { id: 'tankVolume', default: 0.5 },
} as const;

/**
 * Anclajes del scooter. El motor NO esta en el centro: va bajo el piso, muy atras, y es
 * horizontal (monolitico). Eso es lo que hace que el step-through tenga hueco.
 */
function scooterAnchors(sk: ReturnType<typeof makeSkeleton>, seatTop: number): ScooterAnchors {
  const engineX = sk.axleR[0] + sk.wb * 0.42;
  // El piso del scooter esta bastante bajo: el motor va casi tocando el suelo.
  const engineY = sk.rR * 0.95;
  return {
    engineX,
    engineY,
    engineL: sk.wb * 0.26,
    engineH: sk.rF * 1.0,
    engineW: Math.min(0.26, sk.wb * 0.2),
    // El "basculante" del scooter es fijo: es el eje trasero de la carcasa.
    pivot: [sk.axleR[0] + 0.02, sk.axleR[1] + 0.02],
    seatTop,
    floorY: sk.rR * 0.78,
  };
}

interface ScooterAnchors {
  engineX: number;
  engineY: number;
  engineL: number;
  engineH: number;
  engineW: number;
  pivot: P2;
  seatTop: number;
  floorY: number;
}

/**
 * Carroceria del scooter: TRES volumenes con siluetas distintas, no una sola caja.
 *
 * POR QUE SE PARTE EN TRES (la correccion de esta iteracion)
 * -------------------------------------------------------
 * La version anterior era un unico loft con nueve secciones. Medido, tenia dos fallos que
 * se leian como una "cuna gigante apuntando al frente":
 *   1. la seccion del "cuello" (x = 570) salia con `yTop` 270 mm y la siguiente (x = 30)
 *      con `yTop` 630 mm: en 540 mm de recorrido la rampa vertical era de 450 mm. Ese es
 *      el flanco de la cuna — no habia ningun soporte estructural debajo, solo una lamina
 *      de 70 mm de alto que apuntaba hacia delante sobre el piso;
 *   2. el morro iba de semiancho 90 mm (x = 800) a 150 mm (x = 990) en planta: en vez de
 *      un escudo vertical, de perfil era un cono que crecia hacia delante.
 *
 * Lo que se hace ahora son las tres piezas que de verdad tiene un scooter:
 *   1. `shieldGeometry` — ESCUDO vertical detras de la rueda delantera. Cara trasera
 *      inclinada unos 20 grados (protege yrebote), borde superior curvo bajo el manubrio,
 *      semiancho casi constante de arriba a abajo: de perfil es un muro, de frente una
 *      hoja estrecha. El faro va montado en el.
 *   2. `floorGeometry` — PISO plano. Cara superior horizontal a `floorY` entre el escudo y
 *      el cuerpo trasero, con el escalon bajando a `floorY - 35 mm` en el borde de ataque.
 *      Es la superficie donde apoyan los pies, asi que no puede ser una rampa.
 *   3. `rearBodyGeometry` — cuerpo trasero carenado bajo el sillin, que envuelve la rueda,
 *      el motor y la CVT (lado izquierdo). El `yBottom` sube por detras para que la parte
 *      baja se vea por debajo del piso.
 *
 * `noseX` se calcula para que el largo total sea el de la ficha: el entre ejes de un
 * scooter es corto (1340 mm), asi que el vuelo delantero absorbe la diferencia.
 */

/** Cuanto sobresale el morro del escudo mas alla de `noseX` (m). Ver `scooterBody`. */
export const SCOOTER_NOSE_LEAD = 0.19;

/** Anclajes de las tres piezas de la carrocería, todos medidos del esqueleto. */
interface ScooterShell {
  /** X del borde de ataque del escudo (el punto mas delantero de la moto). */
  shieldX: number;
  /** Y del borde superior del escudo: el manubrio va por encima. */
  shieldTopY: number;
  /** Y del piso donde apoyan los pies. */
  floorY: number;
  /** Semiancho del escudo. */
  halfMax: number;
  /** X donde arranca el cuerpo trasero. */
  rearX: number;
}

/**
 * Escudo frontal: lamina vertical detras de la rueda delantera. El perfil (x, y) sube
 * casi vertical con la cara trasera inclinada; la seccion (z, y) se estrecha ARRIBA (el
 * borde superior es mas estrecho que la base) y no al reves, que es lo que lo hacia
 * parecer un cono.
 */
function shieldGeometry(sh: ScooterShell, coverage: number, pts: number): Buckets {
  const h = sh.halfMax;
  const top = sh.shieldTopY;
  const bot = sh.floorY + 0.045;
  return {
    paint: [
      bodyLoft({
        points: pts,
        sections: [
          // Cara delantera: vertical, ligeramente inclinada hacia arriba.
          { x: sh.shieldX, halfWidthBottom: h * 0.82, halfWidthTop: h * 0.72, yBottom: bot + 0.03, yTop: top - 0.03, n: 4 },
          { x: sh.shieldX - 0.028, halfWidthBottom: h * 0.95, halfWidthTop: h * 0.86, yBottom: bot, yTop: top - 0.006, n: 4 },
          // Cara trasera: inclinada 20 grados, la que protege del yrebote de la rueda.
          { x: sh.shieldX - 0.088, halfWidthBottom: h * 0.96, halfWidthTop: h * 0.84, yBottom: bot, yTop: top - 0.022, n: 4 },
          { x: sh.shieldX - 0.132, halfWidthBottom: h * 0.86, halfWidthTop: h * 0.66, yBottom: bot + 0.055, yTop: top - 0.062, n: 4 },
          // Cuello: une con el piso. `coverage` decide si el escudo llega a tocar el piso
          // o si se ve la rueda por debajo (0 = corto y alto, 1 = protector).
          { x: sh.shieldX - 0.162, halfWidthBottom: h * (0.62 + coverage * 0.16), halfWidthTop: h * 0.5, yBottom: bot + 0.06 + coverage * 0.05, yTop: top - 0.118, n: 4 },
        ],
      }),
    ],
  };
}

/**
 * Piso: superficie PLANA y horizontal entre el escudo y el cuerpo trasero. El borde de
 * ataque baja 35 mm (el escalon donde se sube al scooter) y la cara superior queda a
 * `floorY` en toda su longitud: es lo que apoya los pies y lo que separa la silueta de
 * un scooter de la de una moto.
 */
function floorGeometry(sh: ScooterShell, pts: number): Buckets {
  const h = sh.halfMax;
  const fy = sh.floorY;
  return {
    paint: [
      bodyLoft({
        points: pts,
        sections: [
          { x: sh.shieldX - 0.152, halfWidthBottom: h * 0.82, halfWidthTop: h * 0.78, yBottom: fy - 0.035, yTop: fy + 0.012, n: 4 },
          { x: sh.shieldX - 0.2, halfWidthBottom: h * 0.9, halfWidthTop: h * 0.86, yBottom: fy - 0.03, yTop: fy + 0.008, n: 4 },
          { x: sh.shieldX - 0.36, halfWidthBottom: h * 0.93, halfWidthTop: h * 0.88, yBottom: fy - 0.028, yTop: fy, n: 4 },
          { x: sh.shieldX - 0.53, halfWidthBottom: h * 0.94, halfWidthTop: h * 0.88, yBottom: fy - 0.022, yTop: fy, n: 4 },
        ],
      }),
    ],
  };
}

/**
 * Cuerpo trasero: envuelve la rueda, el motor y la CVT bajo el sillin. El `yTop` sube hacia
 * la base del sillin y el `yBottom` sube por detras, asi que por debajo del piso se ve la
 * parte baja del mecanismo mientras la cola queda cerrada y lisa.
 */
function rearBodyGeometry(sh: ScooterShell, a: ScooterAnchors, pts: number): Buckets {
  const h = sh.halfMax;
  const fy = sh.floorY;
  const seatTop = a.seatTop;
  return {
    paint: [
      bodyLoft({
        points: pts,
        sections: [
          { x: sh.shieldX - 0.55, halfWidthBottom: h * 0.95, halfWidthTop: h * 0.9, yBottom: fy - 0.02, yTop: seatTop - 0.055, n: 4 },
          { x: sh.rearX + 0.26, halfWidthBottom: h * 0.96, halfWidthTop: h * 0.92, yBottom: fy + 0.01, yTop: seatTop - 0.028, n: 4 },
          { x: sh.rearX + 0.09, halfWidthBottom: h * 0.94, halfWidthTop: h * 0.88, yBottom: fy + 0.06, yTop: seatTop - 0.004, n: 4 },
          { x: sh.rearX - 0.055, halfWidthBottom: h * 0.88, halfWidthTop: h * 0.78, yBottom: fy + 0.14, yTop: seatTop - 0.02, n: 4 },
          { x: sh.rearX - 0.13, halfWidthBottom: h * 0.76, halfWidthTop: h * 0.62, yBottom: fy + 0.23, yTop: seatTop - 0.062, n: 3 },
        ],
      }),
    ],
  };
}

/**
 * Grupo de las tres piezas. Se mantiene una sola funcion (y no tres `add` sueltos en
 * `build`) para que las medidas del escudo, el piso y la cola queden en un sitio y la
 * silueta se pueda razonar completa.
 */
function scooterBody(sk: ReturnType<typeof makeSkeleton>, a: ScooterAnchors, coverage: number, pts: number, noseX: number, rearX: number): Buckets {
  const sh: ScooterShell = {
    shieldX: noseX + SCOOTER_NOSE_LEAD,
    // El borde superior del escudo va justo debajo de la columna de direccion, no del
    // manubrio: el manubrio de un scooter va por ENCIMA del escudo, con la cubierta.
    shieldTopY: sk.steerTopY - 0.05,
    floorY: a.floorY,
    halfMax: Math.min(0.145, mm(740) / 2 - 0.05),
    rearX,
  };
  const out: Buckets = {};
  for (const piece of [shieldGeometry(sh, coverage, pts), floorGeometry(sh, pts), rearBodyGeometry(sh, a, pts)]) {
    for (const [key, geoms] of Object.entries(piece) as [keyof Buckets, BufferGeometry[]][]) {
      if (!geoms?.length) continue;
      (out[key] ??= []).push(...geoms);
    }
  }
  return out;
}

/**
 * Sillin: una sola pieza larga y plana, apoyada sobre el cuerpo. En un scooter el sillin
 * va de la columna de direccion hasta casi la cola, y por eso es la segunda silueta.
 */
function scooterSeatGeometry(a: ScooterAnchors, sk: ReturnType<typeof makeSkeleton>, seatLength: number, pts: number, rearX: number): Buckets {
  const seatTop = a.seatTop;
  const len = 0.3 + seatLength * 0.16;
  // (Orquestador) En un scooter el sillin va ENCIMA del cuerpo trasero, no pegado a la
  // columna de direccion: entre el escudo y el sillin queda el piso para los pies. El
  // frente del cuerpo trasero esta en rearX + 0.26 (ver rearBodyGeometry).
  void sk;
  const frontX = rearX + 0.3;
  const backX = frontX - len;
  const geo = bodyLoft({
    points: Math.max(10, pts - 6),
    sections: [
      { x: frontX, halfWidthBottom: 0.095, halfWidthTop: 0.085, yBottom: seatTop - 0.09, yTop: seatTop, n: 3 },
      { x: frontX - 0.07, halfWidthBottom: 0.145, halfWidthTop: 0.13, yBottom: seatTop - 0.08, yTop: seatTop, n: 4 },
      { x: frontX - len * 0.7, halfWidthBottom: 0.155, halfWidthTop: 0.14, yBottom: seatTop - 0.07, yTop: seatTop + 0.002, n: 4 },
      { x: backX + 0.03, halfWidthBottom: 0.135, halfWidthTop: 0.11, yBottom: seatTop - 0.06, yTop: seatTop + 0.012, n: 4 },
      { x: backX, halfWidthBottom: 0.09, halfWidthTop: 0.06, yBottom: seatTop - 0.05, yTop: seatTop + 0.016, n: 3 },
    ],
  });
  return { seat: [geo] };
}

/**
 * Tanque de combustible: va BAJO el sillin, dentro de la cola. No se ve desde el exterior
 * (la cola lo tapa) pero la ranura tiene que existir y estar en su sitio: es lo que el
 * usuario enfoca y abre en el modo xray.
 */
function underSeatTank(a: ScooterAnchors, sk: ReturnType<typeof makeSkeleton>, tankV: number): Buckets {
  const w = 0.16 + tankV * 0.05;
  const h = 0.11 + tankV * 0.05;
  const cx = sk.axleR[0] + 0.2;
  const cy = a.seatTop - 0.06 - h * 0.4;
  const g = box(0.3, h, w, 0.035, 2);
  g.translate(cx, cy, 0);
  // Boca de llenado: tapa superior, visible al levantar el sillin.
  const cap = box(0.07, 0.02, 0.07, 0.008, 1);
  cap.translate(cx + 0.06, cy + h * 0.55, 0);
  return { plastic: [g], steel: [cap] };
}

export const SCOOTER: VehicleTemplate = {
  id: 'moto-scooter',
  family: 'moto',
  body: 'scooter',
  label: 'Scooter',
  defaults: {
    family: 'moto',
    body: 'scooter',
    dims: { lengthMm: 1935, widthMm: 740, heightMm: 1160, wheelbaseMm: 1340, seatHeightMm: 765, groundClearanceMm: 120 },
    tireFront: { widthMm: 110, aspectPct: 70, rimIn: 13 },
    tireRear: { widthMm: 130, aspectPct: 70, rimIn: 13 },
  },
  shapeParams: SHAPE_PARAMS,
  variants: {
    rim_front: ['split', 'disc'],
    rim_rear: ['split', 'disc'],
  },

  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const high = ctx.lod === 'high';
    const pts = high ? 26 : 14;
    const width = mm(spec.dims.widthMm);
    const height = mm(spec.dims.heightMm);
    const seatTop = mm(spec.dims.seatHeightMm ?? 765);
    const mirrorTopY = height;
    const mirrorHalf = width / 2;

    const sk = makeSkeleton(spec, { rakeDeg: 26.5, forkOffsetMm: 28, steerTopY: 0.66 });
    const a = scooterAnchors(sk, seatTop);
    const coverage = shapeParam(spec, SC.shieldCoverage);
    const seatLength = shapeParam(spec, SC.seatLength);
    const tankV = shapeParam(spec, SC.tankVolume);
    // El manubrio de un scooter va mas alto que el de una naked (esta de pie), pero
    // siempre por debajo del espejo, que es lo que fija el alto de la ficha.
    const barY = Math.min(mirrorTopY - 0.14, seatTop + 0.34 + shapeParam(spec, SC.handlebarHeight) * 0.05);

    const asm = new MotoAssembly({ templateId: SCOOTER.id, spec, ctx, sk });
    // Ruedas de 13": rin de radios cortos y llanta estrecha, como en un scooter real.
    asm.wheels({ frontStyle: 'split', rearStyle: 'split', rearSpokes: 5 });

    asm.add(
      'frame',
      frameGeometry({ sk, ctx, kind: 'step', topY: seatTop - 0.06, engineLowY: a.engineY - a.engineH * 0.3, engineX: a.engineX, pivot: a.pivot, halfZ: 0.115 }),
    );
    // Motor horizontal monolitico bajo el piso. Va DENTRO de la carrocería: en un scooter
    // el motor no se ve, y si el cazoleta asoma por el piso la silueta se rompe.
    asm.add(
      'engine',
      engineGeometry({ sk, ctx, center: [a.engineX, a.engineY], length: a.engineL, height: a.engineH, width: a.engineW, layout: 'scooter' }),
    );
    // En el scooter la rueda trasera va sobre el eje fijo: "basculante" = travesano corto.
    const fixedAxle = swingarmGeometry({ sk, ctx, pivot: a.pivot, shockTop: [a.engineX - 0.16, a.floorY + 0.1], halfZ: 0.075 });
    asm.add('swingarm', fixedAxle.swingarm);
    // Amortiguadores: el scooter usa doble amortiguador lateral, visible desde el perfil.
    asm.add('shock_rear', {
      dark: [
        tube(
          [
            [a.engineX - 0.3, a.seatTop - 0.1, 0.09],
            [sk.axleR[0] + 0.05, sk.axleR[1] + 0.04, 0.09],
          ],
          0.022,
          { segments: 12, radial: 10 },
        ),
        tube(
          [
            [a.engineX - 0.3, a.seatTop - 0.1, -0.09],
            [sk.axleR[0] + 0.05, sk.axleR[1] + 0.04, -0.09],
          ],
          0.022,
          { segments: 12, radial: 10 },
        ),
      ],
    });
    // CVT: carcasa a la izquierda de la rueda trasera, con poleas.
    asm.add('drive', driveGeometry({ sk, ctx, kind: 'cvt', engineCenter: [a.engineX, a.engineY], rearTireWidth: mm(spec.tireRear.widthMm) }));
    // Escape del scooter: bajo, pequeno y a la derecha, saliendo por detras del carenaje.
    asm.add(
      'exhaust',
      exhaustGeometry({
        sk,
        ctx,
        style: 'under',
        engineCenter: [a.engineX, a.engineY],
        pipeR: 0.019,
        headerEnd: [a.engineX + a.engineL * 0.5, a.engineY - a.engineH * 0.1],
        outY: sk.rR * 0.45,
        side: -1,
        compact: true,
      }),
    );
    asm.add('fork', forkGeometry({ sk, ctx, kind: 'telescopica', halfZ: 0.072 }));
    const bar = handlebarGeometry({
      sk,
      ctx,
      barY,
      halfWidth: mirrorHalf - 0.055,
      riserHalf: 0.115,
      shape: 'wide',
      mirrorHalf,
      mirrorTopY,
    });
    asm.add('handlebar', bar.handlebar);
    asm.add('mirrors', bar.mirrors);

    // Carroceria: escudo, piso, cuerpo trasero, sillin y tanque bajo el sillin.
    // El morro se coloca para que el largo TOTAL sea el de la ficha. `sk` esta en metros
    // y `lengthMm` en mm, por eso el / 1000 explicito (mm() seria lo mismo, pero aqui se
    // ve la conversion al lado del calculo). El vuelo trasero lo fija la llanta: el
    // chasis no pasa de la rueda trasera, asi que el morro absorbe la diferencia.
    // (Orquestador) En un scooter la punta delantera es la rueda con su guardabarros y el
    // ESCUDO va justo DETRAS de la rueda, entre la rueda y las piernas. Antes el escudo se
    // ponia en la punta para que el largo cuadrara, y quedaba delante de la rueda. Ahora el
    // largo lo completa la cola, que en un scooter real sobresale de la rueda trasera.
    const frontTip = sk.axleF[0] + sk.rF + 0.026;
    const shieldFront = sk.axleF[0] - sk.rF * 0.85;
    const noseX = shieldFront - SCOOTER_NOSE_LEAD;
    const rearTipNeeded = frontTip - spec.dims.lengthMm / 1000;
    const rearX = Math.min(sk.axleR[0], rearTipNeeded + 0.15);
    const sh: ScooterShell = {
      shieldX: noseX + SCOOTER_NOSE_LEAD,
      shieldTopY: sk.steerTopY - 0.05,
      floorY: a.floorY,
      halfMax: Math.min(0.145, mm(740) / 2 - 0.05),
      rearX,
    };
    asm.add('bodywork', scooterBody(sk, a, coverage, pts, noseX, rearX));
    asm.add('seat', scooterSeatGeometry(a, sk, seatLength, Math.max(10, pts - 6), rearX));
    asm.add('fuel_tank', underSeatTank(a, sk, tankV));
    // Guardabarros delantero (el trasero va integrado en la cola).
    asm.add('bodywork', {
      paint: [fenderGeometry({ center: sk.axleF, radius: sk.rF + 0.026, width: 0.15, a0: 0.5, a1: 1.75, thickness: 0.01 })],
    });
    // Faldon trasero que cubre la parte alta de la rueda trasera.
    asm.add('bodywork', {
      paint: [fenderGeometry({ center: sk.axleR, radius: sk.rR + 0.03, width: 0.16, a0: 0.25, a1: 1.35, thickness: 0.01, lift: 0.01 })],
    });
    // Cubierta del manubrio: es OBLIGATORIA en un scooter (abriga las manos del muerto) y
    // ademas cierra visualmente el hueco entre el escudo y la barra, que si no deja ver
    // el esqueleto de la direccion justo delante del manubrio.
    const coverW = 0.19;
    asm.add('bodywork', {
      paint: [
        box(0.115, 0.05, coverW, 0.016, 2).translate(sk.axisAt(sk.steerTopY)[0] + 0.012, barY + 0.012, 0),
        box(0.06, 0.038, coverW * 0.82, 0.014, 1).translate(sk.axisAt(sk.steerTopY)[0] + 0.052, barY + 0.014, 0),
      ],
    });

    // Luces: el faro va MONTADO en el escudo, en su cara delantera y a media altura.
    const headAt: P2 = [sh.shieldX - 0.02, sk.steerTopY - 0.12];
    asm.add('headlight', headlightGeometry({ ctx, center: headAt, radius: 0.058 }));
    asm.add('bodywork', {
      plastic: [
        // Bisel oscuro del faro, algo mayor que la luna: lo recorta contra el escudo.
        plate(0.02, 0.15, 0.17, 0.01).translate(sh.shieldX - 0.036, headAt[1], 0),
      ],
    });
    asm.add('taillight', taillightGeometry({ ctx, at: [sh.rearX - 0.115, a.seatTop - 0.05, 0], size: [0.04, 0.03] }));

    for (const [slot, buckets] of Object.entries(
      internalParts({ ctx, engineCenter: [a.engineX, a.engineY], engineLength: a.engineL, engineHeight: a.engineH, engineWidth: a.engineW, seatTopY: seatTop, rearX: sk.axleR[0] }),
    )) {
      asm.add(slot, buckets as Buckets);
    }

    asm.focusOn('bodywork', [sk.forkAt(sk.steerTopY - 0.2)[0], sk.steerTopY - 0.24, 0]);
    asm.focusOn('fuel_tank', [sk.axleR[0] + 0.2, a.seatTop - 0.11, 0]);
    asm.focusOn('seat', [a.engineX - 0.28, seatTop, 0]);
    asm.focusOn('engine', [a.engineX, a.engineY, 0]);
    asm.focusOn('handlebar', [sk.axisAt(sk.steerTopY)[0], barY, 0]);
    asm.focusOn('mirrors', [sk.axisAt(sk.steerTopY)[0], mirrorTopY - MIRROR_DROP, mirrorHalf]);
    asm.focusOn('drive', [sk.axleR[0], sk.axleR[1], 0.1]);
    asm.focusOn('exhaust', [sk.axleR[0] + 0.1, sk.rR * 0.45, -0.06]);
    asm.focusOn('headlight', [headAt[0], headAt[1], 0]);
    asm.focusOn('fork', [sk.forkAt((sk.steerTopY + sk.axleF[1]) / 2)[0], (sk.steerTopY + sk.axleF[1]) / 2, 0]);
    asm.focusOn('shock_rear', [a.engineX - 0.16, a.seatTop - 0.12, 0.09]);
    asm.focusOn('frame', [a.engineX + 0.2, a.floorY, 0]);
    asm.focusOn('swingarm', [sk.axleR[0], sk.axleR[1], 0]);

    return asm.finish();
  },
};
