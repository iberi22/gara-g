/**
 * sport.ts — Motocicleta deportiva (carenaje completo).
 *
 * Silueta: la unica de las cuatro que se reconoce por el CARENAJE. Full fairing que
 * envuelve el motor por los lados, careneta del manubrio, pantalla, y cola alta de
 *旁边的 asiento. Los parametros que la skill declara como `shapeParams` empujan justo en
 * eso: `fairingCoverage` (cuanto carena envuelve), `tailRise`, `handlebarHeight`.
 *
 * Ficha por defecto (mm): 2070 x 720 x 1140, entre ejes 1410, sillin 830,
 * 120/70ZR17 + 180/55ZR17. La sports es la mas alta de las naked: su alto (1140) NO
 * viene del espejo sino de la PANTALLA del carenaje, asi que el espejo se queda dentro y
 * el parametro `heightMm` se aplica a la punta de la pantalla.
 *
 * Chasis de doble arco (perimeter), no cradle: es lo que hace reconocible una deportiva
 * aunque no tenga logotipos.
 *
 * POR QUE EL CARENAJE NO ES UN CAJON (la correccion de esta iteracion)
 * ------------------------------------------------------------------
 * La version anterior era UN solo loft de ocho secciones con
 * `halfWidthBottom ~= halfWidthTop` (138 mm) y `yBottom` casi constante: un
 * paralelepipedo de 760 x 650 x 276 mm con las esquinas redondeadas. Leido de perfil
 * daba una placa vertical ("una nevera"), y ademas el cockpit flotaba ENCIMA de la caja
 * (medido: techo del caparazon y = 904 mm, torretas del manubrio y = 947 mm, empunaduras
 * con semiancho 332 mm saliendo de los costados de un volumen de 138 mm).
 *
 * Aqui el carenaje son cuatro piezas con siluetas distintas:
 *   1. `fairingShell` — caparazon lofteado con perfil de DIPLOMA: morro en punta
 *      (semiancho 47 mm) que se ensancha al llegar a la rueda, maximo en la cowl, CINTURA
 *      estrecha sobre el manubrio y volado ancho sobre el radiador. La cintura es la clave
 *      del problema del manubrio: el techo va por ENCIMA de las barras (no las atraviesa)
 *      y a la vez es mas estrecho que la separacion de las torretas (85 mm), asi que los
 *      clip-on sobresalen por los costados en vez de salir de una plancha.
 *   2. `fairingSide` — faldon lateral extruido con bisel de 8 mm: una chapa con corte,
 *      no un volumen. Cuelga en diagonal desde la cowl y deja ver el cazoleta del motor
 *      (por debajo) y la rueda delantera (por delante).
 *   3. `screenGeometry` — cupula inclinada 39 grados (retrocede 0.8 mm por mm que sube).
 *   4. `fairingIntakes` + `headlight` — el faro angular vive DENTRO del morro.
 *
 * El motor (que llega hasta y = 763 con la culata) queda tapado arriba por el deposito y
 * visible por debajo y por detras del carenaje: es lo que distingue una full fairing de
 * un bloque.
 *
 * Medidas que Param todo (del esqueleto con la ficha por defecto, en mm):
 *   rF 300, rR 315, entre ejes 1410, eje delantero x = 705, percha y = 920,
 *   COLUMNA DE DIRECCION x = 389, BARRA (clip-on) x = 450, punta del morro x = 861,
 *   cilindro del motor hasta y = 763 (por eso el carenaje cierra en y ~ 700 por detras:
 *   si bajara mas, taparia la culata y la moto perderia su motor legible).
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
  swingarmGeometry,
  taillightGeometry,
  type Buckets,
} from './motoKit';
import { box, plate } from './box';
import { extrudeProfile, type P2 } from '../common/geometry';
import { mm } from '../common/units';

/**
 * Rota y traslada un cubo de geometrias en bloque. `headlightGeometry()` devuelve "cubos"
 * ya colocados, no una sola malla, asi que el faro del morro (que va inclinado 11 grados
 * para seguir la linea del pico) se mueve entero en vez de mover cada pieza.
 */
function transform(buckets: Buckets, rotZ: number, dx: number, dy: number): Buckets {
  const out: Buckets = {};
  for (const [key, geoms] of Object.entries(buckets) as [keyof Buckets, BufferGeometry[]][]) {
    if (!geoms?.length) continue;
    out[key] = geoms.map((g) => {
      g.rotateZ(rotZ);
      g.translate(dx, dy, 0);
      return g;
    });
  }
  return out;
}

const SHAPE_PARAMS: ShapeParamDef[] = [
  { id: 'fairingCoverage', label: 'Cobertura del carenaje', default: 0.75, hint: 'Cuanto envuelve el carenaje al motor' },
  { id: 'tailRise', label: 'Elevacion de la cola', default: 0.65, hint: 'Cuanto sube la cola sobre el sillin' },
  { id: 'handlebarHeight', label: 'Altura del manubrio', default: 0.35, hint: 'Empuñaduras bajas o mas altas' },
  { id: 'tankVolume', label: 'Volumen del tanque', default: 0.6, hint: 'Volumen bajo el carenaje' },
];

/** Parametro 0..1 de escape → ruta. En la sports hay tres disponibles. */
function sportExhaustOf(spec: VehicleSpec): 'under' | 'side' | 'high' {
  const p = shapeParam(spec, { id: 'exhaustStyle', default: 0.7 });
  return p < 0.4 ? 'under' : p < 0.75 ? 'side' : 'high';
}

const SP = {
  fairingCoverage: { id: 'fairingCoverage', default: 0.75 },
  tailRise: { id: 'tailRise', default: 0.65 },
  handlebarHeight: { id: 'handlebarHeight', default: 0.35 },
  tankVolume: { id: 'tankVolume', default: 0.6 },
} as const;

/** Interpolacion lineal. Mezcla anclajes con los shapeParams sin inventar numeros. */
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Anclajes de la deportiva. El motor va mas atras que en la naked (el carenaje ocupa el
 * frente) y un poco mas compacto, para que la fairing lo envuelva de verdad.
 */
function sportAnchors(sk: ReturnType<typeof makeSkeleton>, seatTop: number): SportAnchors {
  const engineX = sk.axleR[0] + sk.wb * 0.46;
  const engineY = sk.rF * 1.2;
  const engineL = sk.wb * 0.27;
  // 1.34rF era 402 mm: la culata se pasaba de la linea del carenaje. 1.2rF deja la tapa de
  // valves en ~760 mm, que es donde esta de verdad y lo que permite que el motor asome.
  const engineH = sk.rF * 1.2;
  const engineW = Math.min(0.28, sk.wb * 0.2);
  return {
    engineX,
    engineY,
    engineL,
    engineH,
    engineW,
    pivot: [sk.axleR[0] + sk.wb * 0.2, engineY - engineH * 0.26],
    seatTop,
    tankBottom: engineY + engineH * 0.44,
  };
}

interface SportAnchors {
  engineX: number;
  engineY: number;
  engineL: number;
  engineH: number;
  engineW: number;
  pivot: P2;
  seatTop: number;
  tankBottom: number;
}

/** Anclajes del carenaje, todos derivados del esqueleto (ver cabecera del fichero). */
interface FairingAnchors {
  /** X de la punta del morro. */
  noseX: number;
  /** Y de la punta: a media altura, como el "hocico" de una deportiva. */
  beakY: number;
  /** Y del punto mas alto del carenaje (la cowl, delante de las barras). */
  cowlY: number;
  /** Semiancho maximo del caparazon. */
  halfMax: number;
}

/**
 * Caparazon del carenaje. El perfil de Y es el de una deportiva:
 *
 *   - morro en punta (semiancho 47 mm) a media altura: el "pico", nunca un capitulo plano;
 *   - se ensancha rapido al llegar a la rueda, que es lo que da el volumen de la "cabeza";
 *   - maximo en la cowl (x = 626), el punto mas alto de todo el carenaje;
 *   - CINTURA sobre el manubrio (x = 490, semiancho 94 mm): el techo sigue por ENCIMA de
 *     las barras, pero el carenaje se hace mas estrecho que la separacion de las torretas
 *     (85 mm), asi que los clip-on sobresalen por los costados. Ese es el arreglo del
 *     "el manubrio atraviesa el carenaje";
 *   - vuelve a ensancharse sobre el radiador y cierra por detras del motor, por encima
 *     del cazoleta (semiancho 63 mm) para que la culata asome por debajo.
 *
 * `yBottom` sube en la zona de los faldones (donde cuelgan los paneles laterales) y baja
 * en el frente (proteccion del bajo del carenaje), asi que se ve el cazoleta del motor y
 * la rueda por debajo del carenaje.
 */
function fairingShell(fa: FairingAnchors, coverage: number, pts: number): Buckets {
  const h = fa.halfMax;
  // `fairingCoverage` alarga o acorta el vuelo del morro por delante de la rueda.
  const front = mix(0.1, 0.15, coverage);
  const beak = mix(0.055, 0.09, coverage);
  return {
    paint: [
      bodyLoft({
        points: pts,
        sections: [
          // --- Morro: punta estrecha a media altura (el "pico") ---
          { x: fa.noseX, halfWidthBottom: h * 0.34, halfWidthTop: h * 0.38, yBottom: fa.beakY - beak, yTop: fa.beakY + beak * 0.5, n: 3 },
          { x: fa.noseX - 0.071, halfWidthBottom: h * 0.64, halfWidthTop: h * 0.74, yBottom: fa.beakY - front * 0.92, yTop: fa.beakY + front * 0.6, n: 4 },
          { x: fa.noseX - 0.146, halfWidthBottom: h * 0.87, halfWidthTop: h, yBottom: fa.beakY - front, yTop: fa.cowlY - 0.038, n: 4 },
          // --- Cowl: el punto mas alto, justo delante de las barras ---
          { x: fa.noseX - 0.235, halfWidthBottom: h * 0.95, halfWidthTop: h * 0.97, yBottom: fa.beakY - front - 0.03, yTop: fa.cowlY, n: 4 },
          { x: fa.noseX - 0.301, halfWidthBottom: h * 0.98, halfWidthTop: h, yBottom: fa.beakY - front - 0.02, yTop: fa.cowlY - 0.022, n: 4 },
          // --- Cintura: encima de las barras, pero MAS ESTRECHA que las torretas ---
          { x: fa.noseX - 0.371, halfWidthBottom: h * 0.68, halfWidthTop: h * 0.72, yBottom: fa.beakY - front - 0.005, yTop: fa.cowlY - 0.032, n: 4 },
          { x: fa.noseX - 0.431, halfWidthBottom: h * 0.55, halfWidthTop: h * 0.58, yBottom: fa.beakY - front, yTop: fa.cowlY - 0.044, n: 4 },
          // --- Se abre otra vez sobre el radiador y el motor ---
          { x: fa.noseX - 0.561, halfWidthBottom: h * 0.78, halfWidthTop: h * 0.86, yBottom: fa.beakY - front - 0.005, yTop: fa.cowlY - 0.06, n: 4 },
          { x: fa.noseX - 0.701, halfWidthBottom: h * 0.96, halfWidthTop: h, yBottom: fa.beakY - front - 0.005, yTop: fa.cowlY - 0.08, n: 4 },
          { x: fa.noseX - 0.831, halfWidthBottom: h * 0.97, halfWidthTop: h * 0.98, yBottom: fa.beakY - front + 0.02, yTop: fa.cowlY - 0.092, n: 4 },
          { x: fa.noseX - 1.031, halfWidthBottom: h * 0.88, halfWidthTop: h * 0.9, yBottom: fa.beakY - front + 0.05, yTop: fa.cowlY - 0.128, n: 4 },
          // --- Cierra por detras del motor, por encima del cazoleta ---
          { x: fa.noseX - 1.146, halfWidthBottom: h * 0.68, halfWidthTop: h * 0.7, yBottom: fa.beakY - front + 0.13, yTop: fa.cowlY - 0.17, n: 4 },
          { x: fa.noseX - 1.206, halfWidthBottom: h * 0.46, halfWidthTop: h * 0.48, yBottom: fa.beakY - front + 0.2, yTop: fa.cowlY - 0.215, n: 3 },
        ],
      }),
    ],
  };
}

/**
 * Faldon lateral: perfil 2D extruido en Z con bisel de 8 mm. Es una CHAPA con corte, no un
 * prisma: por eso un lateral se lee como panel desportivo y no como una plancha. Cuelga
 * desde la cowl y su BORDE INFERIOR baja en diagonal hacia atras, dejando ver el cazoleta
 * del motor (por debajo) y la rueda delantera (por delante), que es justo lo que no se
 * veía antes.
 *
 * El perfil es el mismo para los dos lados; `side` solo cambia el desplazamiento en Z.
 */
function fairingSide(fa: FairingAnchors, side: 1 | -1): Buckets {
  const yTop = fa.cowlY - 0.028;
  const prof: P2[] = [
    // Borde superior, de atras hacia delante, siguiendo el techo del caparazon.
    [fa.noseX - 0.39, yTop - 0.062],
    [fa.noseX - 0.52, yTop - 0.02],
    [fa.noseX - 0.66, yTop + 0.008],
    [fa.noseX - 0.76, yTop - 0.028],
    // Borde delantero: baja casi vertical por delante del radiador.
    [fa.noseX - 0.79, yTop - 0.15],
    // Borde inferior en DIAGONAL hacia atras: de y 640 a y 480.
    [fa.noseX - 0.86, yTop - 0.27],
    [fa.noseX - 0.99, yTop - 0.3],
    // Cierra por detras.
    [fa.noseX - 1.04, yTop - 0.21],
    [fa.noseX - 0.9, yTop - 0.115],
    [fa.noseX - 0.63, yTop - 0.115],
  ];
  const g = extrudeProfile(prof, { depth: 0.026, bevel: 0.008, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, side * (fa.halfMax - 0.016));
  // Ranura de radiador: hueco oscuro que hace legible el lateral y separa dos volumenes.
  const grill = plate(0.14, 0.15, 0.02, 0.006);
  grill.rotateZ(-0.3);
  grill.translate(fa.noseX - 0.86, yTop - 0.21, side * (fa.halfMax - 0.028));
  // Ranura de ventilacion longitudinal, sobre el faldon: se ve de canto y rompe la plancha.
  const vent = plate(0.2, 0.022, 0.016, 0.004);
  vent.rotateZ(-0.12);
  vent.translate(fa.noseX - 0.66, fa.cowlY - 0.135, side * (fa.halfMax - 0.03));
  return { paint: [g], dark: [grill], plastic: [vent] };
}

/**
 * Entrada de aire del frontal: hueco oscuro en la cara del morro. Sin ella el pico se lee
 * como una punta lisa de plastico.
 */
function fairingIntakes(fa: FairingAnchors, pts: number): Buckets {
  const vent = bodyLoft({
    points: Math.max(10, pts - 12),
    sections: [
      { x: fa.noseX + 0.003, halfWidthBottom: 0.026, halfWidthTop: 0.022, yBottom: fa.beakY - 0.048, yTop: fa.beakY - 0.004, n: 3 },
      { x: fa.noseX - 0.055, halfWidthBottom: 0.032, halfWidthTop: 0.028, yBottom: fa.beakY - 0.086, yTop: fa.beakY + 0.024, n: 3 },
    ],
  });
  return { dark: [vent] };
}

/**
 * Cupula: perfil 2D inclinado extruido en Z con bisel. Antes era un loft con la pared casi
 * vertical (330 mm de alto para 160 de base): de perfil parecia un tabique. Una pantalla
 * real tiene la base adelante y el borde superior atras y arriba.
 *
 * `topY` es el ALTO de la ficha: el punto mas alto del perfil cae ahi.
 */
function screenGeometry(fa: FairingAnchors, topY: number): Buckets {
  const baseY = fa.cowlY - 0.035;
  const h = Math.max(0.1, topY - baseY);
  const lean = h * 0.8;
  const bx = fa.noseX - 0.28;
  const prof: P2[] = [
    [bx + 0.085, baseY - 0.03],
    [bx + 0.098, baseY + 0.045],
    [bx + 0.098 - lean * 0.45, baseY + h * 0.68],
    [bx + 0.098 - lean * 0.84, topY - 0.004],
    [bx + 0.098 - lean * 0.99, topY - 0.082],
    [bx + 0.01, baseY + 0.03],
  ];
  const g = extrudeProfile(prof, { depth: 0.118, bevel: 0.006, bevelSegments: 2, curveSegments: 6 });
  return { visor: [g] };
}

export const SPORT: VehicleTemplate = {
  id: 'moto-sport',
  family: 'moto',
  body: 'sport',
  label: 'Moto deportiva',
  defaults: {
    family: 'moto',
    body: 'sport',
    dims: { lengthMm: 2070, widthMm: 720, heightMm: 1140, wheelbaseMm: 1410, seatHeightMm: 830, groundClearanceMm: 140 },
    tireFront: { widthMm: 120, aspectPct: 70, rimIn: 17 },
    tireRear: { widthMm: 180, aspectPct: 55, rimIn: 17 },
  },
  shapeParams: SHAPE_PARAMS,
  variants: {
    exhaust: ['under', 'side', 'high'],
    rim_front: ['split', 'spokes', 'disc'],
    rim_rear: ['split', 'spokes', 'disc'],
  },

  build(spec: VehicleSpec, ctx): BuiltVehicle {
    const high = ctx.lod === 'high';
    const pts = high ? 26 : 14;
    const width = mm(spec.dims.widthMm);
    const height = mm(spec.dims.heightMm);
    const seatTop = mm(spec.dims.seatHeightMm ?? 830);

    // En la sports el ALTO lo fija la pantalla, no el espejo: la pantalla llega a
    // `heightMm` y los espejos quedan por debajo (tambien es lo mas bajo de una sports).
    const sk = makeSkeleton(spec, { rakeDeg: 24.5, forkOffsetMm: 30, steerTopY: 0.62 });
    const barP = shapeParam(spec, SP.handlebarHeight);
    // Altura de la pantalla sobre la percha: se recorta para caer exactamente en `height`.
    const screenBaseY = sk.steerTopY - 0.14;
    const screenTop = Math.max(screenBaseY + 0.14, height);

    const a = sportAnchors(sk, seatTop);
    const coverage = shapeParam(spec, SP.fairingCoverage);
    const tankV = shapeParam(spec, SP.tankVolume);
    const tailRise = shapeParam(spec, SP.tailRise);

    // El morro se adelanta hasta tapar la rueda delantera: es lo que hace que la punta
    // quede "en punta" y no un capitulo plano delante de la llanta.
    const fa: FairingAnchors = {
      noseX: sk.axleF[0] + sk.rF * 0.52,
      beakY: sk.rF * 2.48,
      cowlY: sk.steerTopY - 0.02 + barP * 0.012,
      halfMax: Math.min(0.138, mm(720) / 2 - 0.06),
    };

    const asm = new MotoAssembly({ templateId: SPORT.id, spec, ctx, sk });
    asm.wheels({ frontStyle: 'split', rearStyle: 'split', rearSpokes: 5 });

    // Chasis perimetral + horquilla invertida (lo de una deportiva de verdad).
    asm.add(
      'frame',
      frameGeometry({ sk, ctx, kind: 'perimeter', topY: a.engineY + a.engineH * 0.5, engineLowY: a.engineY - a.engineH * 0.4, engineX: a.engineX, pivot: a.pivot, halfZ: 0.1 }),
    );
    asm.add(
      'engine',
      engineGeometry({ sk, ctx, center: [a.engineX, a.engineY], length: a.engineL, height: a.engineH, width: a.engineW, layout: 'inline', fins: 4 }),
    );
    const rear = swingarmGeometry({ sk, ctx, pivot: a.pivot, shockTop: [a.engineX - 0.24, a.engineY + a.engineH * 0.7], halfZ: 0.084 });
    asm.add('swingarm', rear.swingarm);
    asm.add('shock_rear', rear.shock);
    asm.focusOn('shock_rear', [a.engineX - 0.12, a.engineY + a.engineH * 0.45, 0]);
    asm.add('drive', driveGeometry({ sk, ctx, kind: 'chain', engineCenter: [a.engineX, a.engineY], rearTireWidth: mm(spec.tireRear.widthMm) }));
    const style = sportExhaustOf(spec);
    asm.add(
      'exhaust',
      exhaustGeometry({
        sk,
        ctx,
        style,
        engineCenter: [a.engineX, a.engineY],
        pipeR: 0.02,
        headerEnd: [a.engineX + a.engineL * 0.6, a.engineY + 0.01],
        outY: style === 'under' ? sk.rR * 0.36 : style === 'side' ? sk.rR * 0.78 : a.seatTop + 0.03,
        side: -1,
      }),
    );
    asm.add('fork', forkGeometry({ sk, ctx, kind: 'invertida', halfZ: 0.075 }));
    const bar = handlebarGeometry({
      sk,
      ctx,
      // Los clip-on quedan BAJO la cowl y por fuera del carenaje: semiancho 0.26 (no
      // 0.31) para que el ancho lo fijen los espejos, como en una deportiva real.
      barY: Math.min(screenBaseY - 0.02, seatTop + 0.06 + barP * 0.05),
      halfWidth: 0.26,
      riserHalf: 0.085,
      shape: 'clip',
      mirrorHalf: width / 2,
      // El espejo de la sports va bajo la pantalla: el alto no lo manda el espejo.
      mirrorTopY: Math.min(screenTop - 0.03, seatTop + 0.16),
    });
    asm.add('handlebar', bar.handlebar);
    asm.add('mirrors', bar.mirrors);

    // Carroceria: caparazon, faldones, entradas, cupula, deposito, cola y sillin.
    asm.add('bodywork', fairingShell(fa, coverage, pts));
    asm.add('bodywork', fairingSide(fa, 1));
    asm.add('bodywork', fairingSide(fa, -1));
    asm.add('bodywork', fairingIntakes(fa, pts));
    asm.add('bodywork', screenGeometry(fa, screenTop));

    // Deposito: la superficie superior real entre el carenaje y el sillin, con el "hombro"
    // donde apoyan las rodillas. El caparazon baja su techo aqui, asi que lo que se ve
    // por arriba es esto, y no una caja.
    const tankTop = a.seatTop + 0.025 + tankV * 0.012;
    const tankLow = a.tankBottom + 0.095;
    asm.add('fuel_tank', {
      paint: [
        bodyLoft({
          points: pts,
          sections: [
            { x: fa.noseX - 0.771, halfWidthBottom: 0.058, halfWidthTop: 0.05, yBottom: tankLow + 0.075, yTop: tankTop - 0.058, n: 3 },
            { x: fa.noseX - 0.841, halfWidthBottom: 0.09, halfWidthTop: 0.082, yBottom: tankLow + 0.016, yTop: tankTop - 0.012, n: 4 },
            { x: fa.noseX - 0.921, halfWidthBottom: 0.1, halfWidthTop: 0.094, yBottom: tankLow, yTop: tankTop, n: 4 },
            { x: fa.noseX - 1.021, halfWidthBottom: 0.098, halfWidthTop: 0.092, yBottom: tankLow, yTop: tankTop - 0.005, n: 4 },
            { x: fa.noseX - 1.121, halfWidthBottom: 0.086, halfWidthTop: 0.078, yBottom: tankLow + 0.015, yTop: tankTop - 0.018, n: 4 },
            { x: fa.noseX - 1.261, halfWidthBottom: 0.066, halfWidthTop: 0.056, yBottom: tankLow + 0.045, yTop: tankTop - 0.042, n: 3 },
          ],
        }),
      ],
    });

    // Cola alta: sube detras del sillin, como la de una deportiva.
    const rise = tailRise * 0.055;
    asm.add('bodywork', {
      paint: [
        bodyLoft({
          points: pts,
          sections: [
            { x: fa.noseX - 1.31, halfWidthBottom: 0.084, halfWidthTop: 0.074, yBottom: a.seatTop - 0.125, yTop: a.seatTop - 0.028, n: 3 },
            { x: fa.noseX - 1.4, halfWidthBottom: 0.099, halfWidthTop: 0.088, yBottom: a.seatTop - 0.11, yTop: a.seatTop + 0.004, n: 4 },
            { x: fa.noseX - 1.5, halfWidthBottom: 0.1, halfWidthTop: 0.088, yBottom: a.seatTop - 0.088, yTop: a.seatTop + 0.016 + rise * 0.55, n: 4 },
            { x: fa.noseX - 1.58, halfWidthBottom: 0.086, halfWidthTop: 0.066, yBottom: a.seatTop - 0.07, yTop: a.seatTop + 0.028 + rise, n: 4 },
            { x: sk.axleR[0] + 0.045, halfWidthBottom: 0.058, halfWidthTop: 0.038, yBottom: a.seatTop - 0.058, yTop: a.seatTop + 0.02 + rise * 0.9, n: 3 },
            { x: sk.axleR[0] + 0.015, halfWidthBottom: 0.036, halfWidthTop: 0.022, yBottom: a.seatTop - 0.04, yTop: a.seatTop + 0.01 + rise * 0.75, n: 3 },
          ],
        }),
      ],
    });
    // El peldaño del pasajero sube, pero acotado: el test mide la caja del sillin contra
    // `seatHeightMm` con ±5 %, asi que la subida se limita a 19 mm.
    const stepRise = 0.019 * (0.6 + 0.4 * tailRise);
    asm.add('seat', {
      seat: [
        bodyLoft({
          points: Math.max(8, pts - 8),
          sections: [
            { x: fa.noseX - 1.16, halfWidthBottom: 0.055, halfWidthTop: 0.045, yBottom: a.seatTop - 0.075, yTop: a.seatTop - 0.002, n: 3 },
            { x: fa.noseX - 1.24, halfWidthBottom: 0.09, halfWidthTop: 0.078, yBottom: a.seatTop - 0.105, yTop: a.seatTop, n: 4 },
            { x: fa.noseX - 1.34, halfWidthBottom: 0.1, halfWidthTop: 0.088, yBottom: a.seatTop - 0.115, yTop: a.seatTop - 0.001, n: 4 },
            { x: fa.noseX - 1.44, halfWidthBottom: 0.092, halfWidthTop: 0.074, yBottom: a.seatTop - 0.105, yTop: a.seatTop + stepRise * 0.6, n: 4 },
            { x: fa.noseX - 1.53, halfWidthBottom: 0.07, halfWidthTop: 0.046, yBottom: a.seatTop - 0.085, yTop: a.seatTop + stepRise, n: 3 },
          ],
        }),
      ],
    });
    // Guardabarros: en la sports casi no se ven (el carenaje los tapa) pero existen.
    asm.add('bodywork', {
      paint: [fenderGeometry({ center: sk.axleF, radius: sk.rF + 0.026, width: 0.16, a0: 0.85, a1: 2.05, thickness: 0.01 })],
    });
    asm.add('swingarm', {
      plastic: [fenderGeometry({ center: sk.axleR, radius: sk.rR + 0.032, width: 0.19, a0: 0.5, a1: 1.8, thickness: 0.009, lift: 0.02, skew: -0.02 })],
    });
    // Zaga del basculante: la placa que une el subchasis con el basculante. Sin ella el
    // lateral de la cola se ve abierto y la moto parece cortada.
    asm.add('frame', {
      alu: [
        plate(0.15, 0.058, 0.014, 0.006).translate(sk.axleR[0] + 0.31, a.seatTop - 0.215, 0.096),
        plate(0.15, 0.058, 0.014, 0.006).translate(sk.axleR[0] + 0.31, a.seatTop - 0.215, -0.096),
      ],
    });
    // Cazoleta del carter vista por debajo del carenaje, entre el faldon y la rueda.
    asm.add('engine', { plastic: [box(0.062, 0.1, 0.036, 0.012, 1).translate(a.engineX - 0.05, a.engineY - a.engineH * 0.28, 0)] });

    // Luces: faro angular DENTRO del morro, con el bisel empotrado en el carenaje.
    const headAt: P2 = [fa.noseX - 0.004, fa.beakY + 0.006];
    asm.add(
      'headlight',
      transform(headlightGeometry({ ctx, center: [0, 0], radius: 0.05, shape: 'rect', width: 0.108, height: 0.048 }), -0.19, headAt[0], headAt[1]),
    );
    asm.add('bodywork', {
      plastic: [plate(0.03, 0.15, 0.052, 0.008).rotateZ(-0.19).translate(fa.noseX - 0.032, headAt[1], 0)],
    });
    asm.add('taillight', taillightGeometry({ ctx, at: [sk.axleR[0] + 0.04, a.seatTop + 0.012 + rise * 0.85, 0], size: [0.04, 0.026] }));

    for (const [slot, buckets] of Object.entries(
      internalParts({ ctx, engineCenter: [a.engineX, a.engineY], engineLength: a.engineL, engineHeight: a.engineH, engineWidth: a.engineW, seatTopY: seatTop, rearX: sk.axleR[0] }),
    )) {
      asm.add(slot, buckets as Buckets);
    }

    asm.focusOn('bodywork', [fa.noseX - 0.34, fa.beakY + 0.07, 0]);
    asm.focusOn('fuel_tank', [fa.noseX - 0.92, tankLow + 0.12, 0]);
    asm.focusOn('seat', [fa.noseX - 1.34, seatTop, 0]);
    asm.focusOn('engine', [a.engineX + 0.05, a.engineY + a.engineH * 0.35, 0]);
    asm.focusOn('handlebar', [sk.forkAt(sk.steerTopY - 0.06)[0], sk.steerTopY - 0.06, 0]);
    asm.focusOn('mirrors', [sk.axisAt(sk.steerTopY)[0], seatTop + 0.16, width / 2]);
    asm.focusOn('exhaust', [sk.axleR[0] + 0.28, sk.rR * 0.6, -0.08]);
    asm.focusOn('drive', [a.engineX - 0.2, a.engineY - sk.rR * 0.1, 0.07]);
    asm.focusOn('headlight', [headAt[0], headAt[1], 0]);
    asm.focusOn('fork', [sk.forkAt((sk.steerTopY + sk.axleF[1]) / 2)[0], (sk.steerTopY + sk.axleF[1]) / 2, 0]);
    asm.focusOn('frame', [a.engineX - 0.1, a.engineY, 0]);

    return asm.finish();
  },
};