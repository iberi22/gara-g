/**
 * motoKit.ts — Piezas mecanicas compartidas por las 4 plantillas de moto.
 *
 * Por que existe: naked, sport, scooter y trail comparten motor, escape, barra,
 * horquilla, basculante, transmision y luces; lo que cambia es la silueta de
 * tanque/cola/carenaje. Si cada plantilla reconstruyera la mecanica, una correccion
 * (un portabrake que atraviesa la llanta, una barra que no llega a nada) habria que
 * repetirla cuatro veces y las motos se separarian entre si. Aqui viven una vez.
 *
 * Regla del modulo: toda pieza se ancla en el ESQUELETO (skeleton.ts), o sea en medidas
 * reales de la ficha tecnica, y toda pieza tiene que tocar lo que dice tocar. La
 * primitiva dominante es `strut()` (un cilindro entre dos puntos reales) porque es
 * barata y jamas deja un extremo flotando.
 *
 * Convenciones: metros, +X frente, +Y arriba, +Z lado izquierdo, piso en y = 0.
 */
import { BufferGeometry, CylinderGeometry, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialKit, PaintSpec, TemplateContext } from '../../contracts';
import { lathe, loft, tube, type P2, type P3 } from '../common/geometry';
import { box, plate } from './box';
import type { MotoSkeleton } from './skeleton';

// -----------------------------------------------------------------------------
// Primitivas
// -----------------------------------------------------------------------------

/** Radio de la luna del espejo (m). La carcasa y el cristal usan este valor. */
export const MIRROR_EDGE = 0.033;
/**
 * El centro de la luna se coloca a `mirrorTopY - MIRROR_EDGE` para que la parte de ARRIBA
 * del disco caiga justo en la altura de la ficha. Centrarla en `mirrorTopY` dejaba el
 * espejo 33 mm por encima del alto declarado, que ya es 3 % de la moto.
 */
export const MIRROR_DROP = MIRROR_EDGE;

/** Cilindro entre dos puntos. Nace sobre +Y, se orienta y se lleva a `from`. */
export function strut(from: P3, to: P3, r: number, radial = 10, rTop?: number): BufferGeometry {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new CylinderGeometry(rTop ?? r, r, Math.max(len, 1e-4), radial, 1, false);
  g.translate(0, len / 2, 0);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  g.applyMatrix4(new Matrix4().makeRotationFromQuaternion(q));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Caja alineada entre dos puntos 2D (para barras que suben en el plano lateral). */
export function bar(from: P2, to: P2, z: number, w: number, h: number): BufferGeometry {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const g = box(len, h, w, Math.min(w, h) * 0.25, 1);
  g.rotateZ(Math.atan2(dy, dx));
  g.translate(from[0] + dx / 2, from[1] + dy / 2, z);
  return g;
}

/** Fusiona geometrias en una: un slot con 8 piezas pasa a ser 1 mesh (draw calls). */
export function fuse(parts: BufferGeometry[]): BufferGeometry {
  if (parts.length === 1) return parts[0];
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('fuse: geometrias con atributos incompatibles');
  for (const g of flat) if (!parts.includes(g)) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Mesh de un conjunto de geometrias del mismo material. */
export function fusedMesh(parts: BufferGeometry[], material: unknown): BufferGeometry {
  return parts.length ? fuse(parts) : new BufferGeometry();
}

// -----------------------------------------------------------------------------
// Materiales por clave
// -----------------------------------------------------------------------------

export type MatKey =
  | 'dark'
  | 'alu'
  | 'steel'
  | 'brushed'
  | 'chrome'
  | 'plastic'
  | 'gray'
  | 'paint'
  | 'accent'
  | 'glass'
  | 'visor'
  | 'head'
  | 'tail'
  | 'seat'
  | 'rubber';

export type Buckets = Partial<Record<MatKey, BufferGeometry[]>>;

/** Resolucion de clave → material del kit comun. Las plantillas NUNCA crean materiales. */
export function matFor(kit: MaterialKit, spec: PaintSpec, key: MatKey): unknown {
  switch (key) {
    case 'dark':
      return kit.metal('dark');
    case 'alu':
      return kit.metal('aluminum');
    case 'steel':
      return kit.metal('steel');
    case 'brushed':
      return kit.metal('brushed');
    case 'chrome':
      return kit.chrome();
    case 'plastic':
      return kit.plastic('textured');
    case 'gray':
      return kit.plastic('gray');
    case 'paint':
      return kit.paint(spec);
    case 'accent':
      return kit.accent(spec);
    case 'glass':
      return kit.glass('clear');
    case 'visor':
      return kit.glass('visor');
    case 'head':
      return kit.light('head');
    case 'tail':
      return kit.light('tail');
    case 'seat':
      return kit.seat();
    case 'rubber':
      return kit.rubber();
  }
}

/** Addir geometrias a un cubo de material. */
export function add(out: Buckets, key: MatKey, ...geoms: BufferGeometry[]): void {
  (out[key] ??= []).push(...geoms);
}

// -----------------------------------------------------------------------------
// Volumenes de车身 (carroceria): tanque, cola, carenaje, guardabarros
// -----------------------------------------------------------------------------

export interface LoftOpts {
  /** Secciones a lo largo de X, de la cola a la punta. */
  sections: { x: number; halfWidthBottom: number; halfWidthTop: number; yBottom: number; yTop: number; n?: number }[];
  /** Puntos por seccion. Menos en LOD low. */
  points?: number;
}

function ring(o: LoftOpts['sections'][number], points: number, n: number): P2[] {
  const count = points;
  const e = 2 / n;
  const out: P2[] = [];
  for (let k = 0; k < count; k++) {
    const t = (k / count) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const zn = Math.sign(c) * Math.abs(c) ** e;
    const yn = Math.sign(s) * Math.abs(s) ** e;
    const h = (yn + 1) / 2;
    const half = o.halfWidthBottom + (o.halfWidthTop - o.halfWidthBottom) * h;
    out.push([zn * half, o.yBottom + h * (o.yTop - o.yBottom)]);
  }
  return out;
}

/**
 * Superficie cerrada de cuerpo (tanques, colas, carenajes, fenders). `sections` van de
 * la cola a la punta en X; `halfWidthTop < halfWidthBottom` da el estrechamiento de arriba
 * que hace que un volumen se vea real y no un tubo.
 */
export function bodyLoft(o: LoftOpts): BufferGeometry {
  const n = o.points ?? 28;
  const secN = o.sections[0].n ?? 4;
  return loft(o.sections.map((s) => ({ x: s.x, ring: ring(s, n, secN) })), { caps: true });
}

/** Anillo de puntos de una seccion, por si un archivo quiere componer a mano. */
export { ring as bodyRing };

// -----------------------------------------------------------------------------
// Motor
// -----------------------------------------------------------------------------

export interface EngineOpts {
  sk: MotoSkeleton;
  ctx: TemplateContext;
  /** Centro del bloque, [x, y]. */
  center: P2;
  /** Largo, alto y ancho del bloque (m). */
  length: number;
  height: number;
  width: number;
  /** Disposicion del cilindro. */
  layout: 'inline' | 'boxer' | 'scooter';
  /** Aletas de radiacion (LOD bajo las reduce solo). */
  fins?: number;
  /** Añade culata de bujias (motor de combustion visible). */
  sparkAt?: P2;
}

/**
 * Bloque: cazoleta + cilindro + aletas + culata. Es la pieza que mas dice del tipo de
 * moto, asi que siempre lleva aletas visibles salvo en el scooter (carcasa monolitica).
 */
export function engineGeometry(o: EngineOpts): Buckets {
  const { ctx } = o;
  const [cx, cy] = o.center;
  const { length: l, height: h, width: w } = o;
  const out: Buckets = {};

  // Cazoleta: bloque transversal redondeado = la "cadera" del motor.
  const caseGeo = box(l * 0.84, h * 0.66, w, Math.min(0.024, w * 0.2), 2);
  caseGeo.translate(cx, cy, 0);
  add(out, 'dark', caseGeo);

  // Tapas de tapa de cilindro a los lados del cazoleta (lamina fina en Z, pegada al block).
  for (const s of [1, -1]) {
    const cap = box(l * 0.34, h * 0.5, w * 0.1, 0.012, 1);
    cap.translate(cx + l * 0.1, cy, (s * w) / 2 - (s * w * 0.1) / 2);
    add(out, 'alu', cap);
  }
  // Carter inferior: cierra la cazoleta por abajo (visible en naked/trail).
  const sump = box(l * 0.6, h * 0.16, w * 0.86, 0.012, 1);
  sump.translate(cx - l * 0.02, cy - h * 0.38, 0);
  add(out, 'dark', sump);

  const finN = o.fins ?? 5;

  if (o.layout === 'boxer') {
    // Dos cilindros horizontales a los lados, caidos hacia adelante.
    for (const s of [1, -1]) {
      const base: P3 = [cx + l * 0.1, cy + h * 0.3, s * (w / 2 + 0.01)];
      const top: P3 = [cx + l * 0.28, cy + h * 0.26, s * (w / 2 + 0.07)];
      add(out, 'gray', strut(base, top, w * 0.19, 12));
      const ang = Math.atan2(top[1] - base[1], top[0] - base[0]);
      const count = ctx.lod === 'high' ? finN : Math.max(2, finN - 2);
      for (let f = 0; f < count; f++) {
        const t = (f + 1) / (count + 1);
        const fin = plate(0.01, w * 0.3, 0.008);
        fin.rotateZ(ang - Math.PI / 2);
        fin.translate(
          base[0] + (top[0] - base[0]) * t,
          base[1] + (top[1] - base[1]) * t,
          base[2] + (top[2] - base[2]) * t + 0.014,
        );
        add(out, 'alu', fin);
      }
    }
  } else if (o.layout === 'scooter') {
    // Scooter: monolitico horizontal, sin aletas, con campana de embrague al costado.
    const block = box(l * 0.94, h * 0.74, w * 0.94, 0.035, 2);
    block.translate(cx, cy, 0);
    add(out, 'gray', block);
    const cover = lathe(
      [
        [0.001, 0],
        [h * 0.34, 0],
        [h * 0.36, 0.012],
        [h * 0.34, 0.024],
        [0.001, 0.024],
      ],
      ctx.lod === 'high' ? 22 : 12,
    );
    cover.rotateX(Math.PI / 2);
    cover.translate(cx - l * 0.02, cy, w / 2);
    add(out, 'dark', cover);
  } else {
    // Inline: cilindro inclinado adelante-arriba, con aletas apiladas.
    const base: P3 = [cx + l * 0.04, cy + h * 0.26, 0];
    const top: P3 = [cx + l * 0.2, cy + h * 0.98, 0];
    add(out, 'gray', strut(base, top, w * 0.32, 14));
    const ang = Math.atan2(top[1] - base[1], top[0] - base[0]);
    const count = ctx.lod === 'high' ? finN : Math.max(2, finN - 2);
    for (let f = 0; f < count; f++) {
      const t = (f + 1) / (count + 1);
      const fin = plate(0.011, w * 0.44, w * 0.5);
      fin.rotateZ(ang - Math.PI / 2);
      fin.translate(base[0] + (top[0] - base[0]) * t, base[1] + (top[1] - base[1]) * t, 0);
      add(out, 'alu', fin);
    }
    // Culata y tapa de valvulas.
    const head = box(0.07, 0.055, w * 0.4, 0.01, 1);
    head.rotateZ(ang - Math.PI / 2);
    head.translate(top[0] + 0.015, top[1] + 0.012, 0);
    add(out, 'gray', head);
    const cap = box(0.05, 0.03, w * 0.3, 0.008, 1);
    cap.rotateZ(ang - Math.PI / 2);
    cap.translate(top[0] - 0.005, top[1] + 0.05, 0);
    add(out, 'alu', cap);
  }

  // Bujias: small caps at the head, only where the engine says so.
  if (o.sparkAt) {
    for (const z of o.layout === 'boxer' ? [w / 2 + 0.02, -(w / 2 + 0.02)] : [w * 0.16, -w * 0.16]) {
      const plug = strut([o.sparkAt[0], o.sparkAt[1], z * 0.5], [o.sparkAt[0] + 0.012, o.sparkAt[1] + 0.048, z], 0.007, 8);
      add(out, 'steel', plug);
    }
  }
  void o.sk;
  return out;
}

// -----------------------------------------------------------------------------
// Escape
// -----------------------------------------------------------------------------

export type ExhaustStyle = 'under' | 'side' | 'high';

export interface ExhaustOpts {
  sk: MotoSkeleton;
  ctx: TemplateContext;
  style: ExhaustStyle;
  /** Centro del bloque del motor. */
  engineCenter: P2;
  /** Radio de la seccion del escape. */
  pipeR: number;
  /** Punto donde arranca el catalizador (sale del motor, ya pasado el cilindro). */
  headerEnd: P2;
  /** Y de la salida del silenciador. */
  outY: number;
  /** Lado: el escape sale por la derecha (-Z) en todas las motos. */
  side: 1 | -1;
  /** Silenciador algo mas fino y compacto (scooter). */
  compact?: boolean;
}

/**
 * Escape completo: colector que nace en el motor, catalizador, silenciador y punta.
 * La ruta cambia por estilo, pero siempre arranca en un punto del motor y termina
 * visible atras — un escape que flota es el error mas comun de una moto generada.
 */
export function exhaustGeometry(o: ExhaustOpts): Buckets {
  const { sk } = o;
  const [ex, ey] = o.engineCenter;
  const out: Buckets = {};
  const r = o.pipeR;
  const z = o.side * 0.03;
  const [hx, hy] = o.headerEnd;
  const canR = r * (o.compact ? 1.5 : 1.85);
  const canL = o.compact ? 0.2 : 0.3;
  // `outX` es el centro del silenciador. En la ruta alta el silenciador va BAJO LA COLA, o
  // sea por DELANTE del eje trasero: si se centra en el eje, la punta del escape sobresale
  // por detras de la rueda y de toda la carrocería, y en el perfil se ve flotando.
  const outX = sk.axleR[0] + (o.style === 'high' ? 0.26 : -0.08);

  if (o.style === 'high') {
    // Alto (por el lado derecho, subiendo bajo la cola).
    add(
      out,
      'brushed',
      tube(
        [
          [ex + 0.14, ey - r * 0.4, z],
          [hx, hy, z],
          [hx - 0.1, hy + 0.1, o.side * 0.05],
          [outX - 0.16, o.outY + 0.02, o.side * 0.07],
        ],
        r,
        { segments: 40, radial: 10 },
      ),
    );
    const can = box(canL, canR * 1.7, canR * 1.5, canR * 0.7, 2);
    can.translate(outX + 0.06, o.outY, o.side * 0.07);
    add(out, 'brushed', can);
    add(out, 'dark', strut([outX - canL * 0.4, o.outY, o.side * 0.07], [outX - canL * 0.72, o.outY, o.side * 0.07], canR * 0.72, 12));
  } else if (o.style === 'side') {
    // Lateral derecho: baja del motor, sube a la altura del eje y sale atras.
    add(
      out,
      'brushed',
      tube(
        [
          [ex + 0.14, ey - r * 0.4, z],
          [hx, hy, z],
          [hx - 0.12, hy - 0.06, o.side * 0.06],
          [sk.axleR[0] + 0.46, sk.axleR[1] * 0.55, o.side * 0.075],
          [outX + 0.24, o.outY, o.side * 0.075],
        ],
        r,
        { segments: 44, radial: 10 },
      ),
    );
    const can = box(canL, canR * 1.8, canR * 1.55, canR * 0.7, 2);
    can.translate(outX + 0.06, o.outY, o.side * 0.075);
    add(out, 'brushed', can);
    add(out, 'dark', strut([outX - canL * 0.42, o.outY, o.side * 0.075], [outX - canL * 0.75, o.outY, o.side * 0.075], canR * 0.7, 12));
  } else {
    // Bajo el motor: baja, pasa el pie del piloto y sale atras abajo.
    add(
      out,
      'brushed',
      tube(
        [
          [ex + 0.14, ey - r * 0.5, z],
          [hx, hy - r * 0.6, z * 0.6],
          [hx - 0.14, ey - r * 4.2 - 0.03, z * 0.4],
          [sk.axleR[0] + 0.42, sk.axleR[1] * 0.42, z * 0.3],
          [outX + 0.2, o.outY, z * 0.3],
        ],
        r,
        { segments: 44, radial: 10 },
      ),
    );
    const can = box(canL, canR * 1.5, canR * 1.3, canR * 0.6, 2);
    can.translate(outX + 0.02, o.outY, z * 0.3);
    add(out, 'brushed', can);
    add(out, 'dark', strut([outX - canL * 0.4, o.outY, z * 0.3], [outX - canL * 0.7, o.outY, z * 0.3], canR * 0.58, 10));
  }

  // Catalizador: abultamiento abocinado justo detras del colector.
  const cat = box(0.11, r * 2.3, r * 2.0, r * 0.7, 2);
  cat.rotateZ(o.style === 'under' ? -0.5 : 0.35);
  cat.translate(hx - 0.02, hy, z);
  add(out, 'dark', cat);

  return out;
}

// -----------------------------------------------------------------------------
// Transmision: cadena + piñones, o CVT (scooter)
// -----------------------------------------------------------------------------

export interface DriveOpts {
  sk: MotoSkeleton;
  ctx: TemplateContext;
  kind: 'chain' | 'cvt';
  /** Centro del motor: el piñon delantero va a la salida del embrague. */
  engineCenter: P2;
  /** Ancho de llanta trasera, para colocar la cadena en el plano correcto. */
  rearTireWidth: number;
}

/**
 * Kit de arrastre. Cadena: dos piñones (salida del motor y llanta trasera) unidos por
 * dos tiras planas que tocan el radio exterior de cada piñon — la cadena tiene que UNIR.
 * CVT: carcasa a la izquierda con poleas y correa, como en un scooter real.
 */
export function driveGeometry(o: DriveOpts): Buckets {
  const { sk } = o;
  const out: Buckets = {};
  const [cx, cy] = o.engineCenter;
  const rearAxle: P2 = [sk.axleR[0], sk.axleR[1]];

  if (o.kind === 'cvt') {
    const rw = o.rearTireWidth / 2;
    const R = Math.max(0.075, sk.rR * 0.52);
    const seg = o.ctx.lod === 'high' ? 24 : 12;
    // Carcasa de la transmision: volumen redondeado sobre el lado izquierdo de la llanta.
    const housing = box(R * 2.3, R * 2.7, 0.055, 0.022, 2);
    housing.translate(rearAxle[0], rearAxle[1], rw + 0.03);
    add(out, 'plastic', housing);
    const cover = lathe(
      [
        [R * 0.2, 0],
        [R * 1.02, 0],
        [R * 1.02, 0.012],
        [R * 0.2, 0.012],
      ],
      seg,
    );
    cover.rotateX(-Math.PI / 2);
    cover.translate(rearAxle[0], rearAxle[1] + R * 0.05, rw + 0.058);
    add(out, 'gray', cover);
    // Poleas (dos conos) — se leen a traves de la carcasa en modo xray.
    for (const dy of [-R * 0.5, R * 0.52]) {
      const pulley = lathe(
        [
          [0.004, -0.018],
          [R * 0.8, -0.004],
          [R * 0.8, 0.004],
          [0.004, 0.018],
        ],
        seg,
      );
      pulley.rotateX(-Math.PI / 2);
      pulley.translate(rearAxle[0], rearAxle[1] + dy, rw + 0.062);
      add(out, 'alu', pulley);
    }
    // Campana de embrague al frente (lado izquierdo, como en la realidad).
    const bell = lathe(
      [
        [0.004, 0],
        [0.088, 0],
        [0.09, 0.03],
        [0.004, 0.03],
      ],
      seg,
    );
    bell.rotateX(-Math.PI / 2);
    bell.translate(cx + 0.08, cy - 0.02, rw + 0.04);
    add(out, 'gray', bell);
    return out;
  }

  // --- Cadena ---
  // El plano de la cadena va por fuera del flanco de la llanta: el piñon trasero se
  // atornilla a la cara interna de la llanta, asi que la cadena queda a `ancho/2 + holgura`.
  const z = o.rearTireWidth / 2 + 0.016;
  const rFront = Math.max(0.05, sk.rR * 0.3);
  const rRear = Math.max(0.06, sk.rR * 0.4);
  const front: P2 = [cx + 0.1, cy - sk.rR * 0.22];
  const seg = o.ctx.lod === 'high' ? 20 : 12;

  const sprocket = (at: P2, r: number, inner: number): BufferGeometry => {
    const g = lathe(
      [
        [inner, -0.004],
        [r * 0.88, -0.004],
        [r, 0],
        [r * 0.88, 0.004],
        [inner, 0.004],
      ],
      seg,
    );
    g.rotateX(-Math.PI / 2);
    g.translate(at[0], at[1], z);
    return g;
  };
  add(out, 'alu', sprocket(front, rFront, 0.012), sprocket(rearAxle, rRear, 0.014));

  // Dos corridas de cadena, tangentes a ambos piñones (superior e inferior). Cada una es
  // una lama plana; NUNCA un travesaño que cruce la rueda, o la moto se ve como una jaula.
  const thick = 0.014;
  const topA: P2 = [front[0], front[1] + rFront];
  const topB: P2 = [rearAxle[0], rearAxle[1] + rRear];
  const botA: P2 = [front[0], front[1] - rFront];
  const botB: P2 = [rearAxle[0], rearAxle[1] - rRear];
  add(out, 'dark', bar(topA, topB, z, 0.013, thick));
  add(out, 'dark', bar(botA, botB, z, 0.013, thick));
  // Rodillos: pequenos chiodos PEGADOS a cada corrida, que es lo que la hace leerse como
  // cadena. Se acortan cerca de los piñones para no invadir la rueda.
  if (o.ctx.lod === 'high') {
    const n = 18;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const half = 0.012;
      const p = (a: P2, b: P2): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      for (const [a, b, out1] of [
        [topA, topB, 1],
        [botA, botB, -1],
      ] as const) {
        const c = p(a, b);
        const roller = lathe(
          [
            [0.001, -0.007],
            [0.0075, -0.007],
            [0.0075, 0.007],
            [0.001, 0.007],
          ],
          8,
        );
        roller.rotateX(-Math.PI / 2);
        roller.translate(c[0], c[1] + out1 * half * 0, z + out1 * 0.001);
        add(out, 'steel', roller);
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Basculante + amortiguador
// -----------------------------------------------------------------------------

/**
 * Amortiguador trasero: cuerpo abajo + vastago arriba, exactamente entre dos puntos.
 * Si el cuerpo queda corto no pasa nada visualmente, pero el vastago tiene que LLEGAR:
 * un amortiguador que no toca el basculante o el chasis es el error que mas delata una
 * moto generada, asi que se construye con las dos longitudes calculadas desde los puntos.
 */
export function shockGeometry(_sk: MotoSkeleton, topAt: P2, bottomAt: P2, bodyR: number): { body: BufferGeometry; shaft: BufferGeometry } {
  const dx = topAt[0] - bottomAt[0];
  const dy = topAt[1] - bottomAt[1];
  const len = Math.hypot(dx, dy);
  const bodyLen = len * 0.55;
  const shaftLen = len * 0.62;
  const at = (p: P2): P3 => [p[0], p[1], 0];
  return {
    body: strut(at(bottomAt), at(lerp2(bottomAt, topAt, bodyLen / len)), bodyR, 12),
    shaft: strut(at(lerp2(bottomAt, topAt, (len - shaftLen) / len)), at(topAt), bodyR * 0.42, 8),
  };
}

function lerp2(a: P2, b: P2, t: number): P2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export interface SwingarmOpts {
  sk: MotoSkeleton;
  ctx: TemplateContext;
  /** Pivote del basculante en el chasis [x, y]. */
  pivot: P2;
  /** Punto del chasis donde entra el amortiguador [x, y]. */
  shockTop: P2;
  /** Media anchura de los brazos. */
  halfZ?: number;
}

/**
 * Basculante en U (dos brazos + travesano) del pivote al eje trasero, y amortiguador
 * que une un punto del basculante con el chasis. Si el amortiguador no llega a los dos
 * puntos, la moto se ve rota; por eso se calculan aqui, no se dibujan a ojo.
 */
export interface SwingarmResult {
  /** Brazos y travesanos del basculante. */
  swingarm: Buckets;
  /** Amortiguador, en su propia ranura. */
  shock: Buckets;
}

export function swingarmGeometry(o: SwingarmOpts): SwingarmResult {
  const { sk } = o;
  const out: Buckets = {};
  const axle = sk.axleR;
  const z = o.halfZ ?? 0.09;

  for (const s of [1, -1]) {
    // Brazo principal.
    add(out, 'dark', strut([o.pivot[0], o.pivot[1], s * z], [axle[0], axle[1], s * z], 0.026, 10, 0.021));
    // Nervio superior que triangula contra el amortiguador.
    add(
      out,
      'dark',
      strut([o.pivot[0] + 0.015, o.pivot[1] + 0.055, s * z], [axle[0] + 0.06, axle[1] + 0.035, s * z], 0.016, 8),
    );
    // Aleta de Union de la pivote (placa plana).
    const lug = box(0.075, 0.075, 0.016, 0.012, 1);
    lug.translate(o.pivot[0] + 0.005, o.pivot[1] + 0.01, s * (z + 0.012));
    add(out, 'alu', lug);
  }
  // Travesanos: pivote y eje. El del eje une los dos brazos de verdad.
  add(out, 'alu', strut([o.pivot[0], o.pivot[1], -z - 0.016], [o.pivot[0], o.pivot[1], z + 0.016], 0.014, 10));
  add(out, 'alu', strut([axle[0], axle[1], -z - 0.016], [axle[0], axle[1], z + 0.016], 0.02, 10));

  // Amortiguador: se devuelve aparte (shock) para que la plantilla lo meta en la ranura
  // 'shock_rear'. Va en su propio grupo porque el usuario lo enfoca y lo cambia solo.
  const bottom: P2 = [axle[0] + 0.14, axle[1] + 0.11];
  const sg = shockGeometry(sk, o.shockTop, bottom, 0.026);
  // Reles de anclaje en las dos puntas: sin ellas el amortiguador parece flotar.
  add(out, 'alu', box(0.034, 0.034, 0.05, 0.008, 1).translate(o.shockTop[0], o.shockTop[1], 0));
  add(out, 'alu', box(0.03, 0.03, 0.05, 0.008, 1).translate(bottom[0], bottom[1], 0));
  void o.ctx;
  return { swingarm: out, shock: { dark: [sg.body], chrome: [sg.shaft] } };
}

// -----------------------------------------------------------------------------
// Horquilla + direccion
// -----------------------------------------------------------------------------

export interface ForkOpts {
  sk: MotoSkeleton;
  ctx: TemplateContext;
  /** 'telescopica' (manga arriba) | 'invertida' (tubo grueso abajo). */
  kind: 'telescopica' | 'invertida';
  /** Media separacion de las barras. */
  halfZ?: number;
}

/**
 * Horquilla. Los tubos son paralelos al eje de direccion y pasan por el centro del eje
 * delantero, que va ADELANTADO respecto a ese eje: ese desplazamiento (fork offset) es
 * lo que produce el trail correcto y lo que hace que la moto no se vea "torta".
 */
export function forkGeometry(o: ForkOpts): Buckets {
  const { sk } = o;
  const out: Buckets = {};
  const axle = sk.axleF;
  const z = o.halfZ ?? 0.078;
  const topY = sk.steerTopY;

  // Placas de direccion: bloque transversal sobre el steering head.
  const tripleTop = box(0.1, 0.03, z * 2.4, 0.012, 1);
  tripleTop.translate(sk.axisAt(topY)[0], topY - 0.006, 0);
  add(out, 'alu', tripleTop);
  const tripleBot = box(0.08, 0.032, z * 1.9, 0.012, 1);
  tripleBot.translate(sk.axisAt(topY - 0.05)[0], topY - 0.052, 0);
  add(out, 'alu', tripleBot);
  // Columna de direccion entre las dos placas.
  add(out, 'dark', strut([sk.axisAt(topY)[0], topY, 0], [sk.steerBase[0], sk.steerBase[1], 0], 0.021, 10));

  const midY = (topY + axle[1]) / 2;
  for (const s of [1, -1]) {
    const top: P3 = [sk.forkAt(topY)[0], topY, s * z];
    const mid: P3 = [sk.forkAt(midY)[0], midY, s * z];
    const bot: P3 = [axle[0], axle[1], s * z];
    if (o.kind === 'invertida') {
      add(out, 'chrome', strut(top, mid, 0.0165, 10));
      add(out, 'dark', strut(mid, bot, 0.0265, 12));
    } else {
      add(out, 'dark', strut(top, mid, 0.0245, 12));
      add(out, 'chrome', strut(mid, bot, 0.0145, 10));
    }
    // Portabrake: pinza sujetando el disco, por detras-arriba de la rueda.
    const pinza = box(0.05, 0.085, 0.036, 0.012, 1);
    pinza.translate(axle[0] - 0.028, axle[1] + sk.rF * 0.56, s * (z + 0.014));
    add(out, 'alu', pinza);
    // Abrazadera de la barra de freno.
    if (s === 1) {
      const clamp = box(0.03, 0.05, 0.03, 0.008, 1);
      clamp.translate(axle[0] - 0.01, axle[1] + sk.rF * 0.85, s * (z + 0.006));
      add(out, 'alu', clamp);
    }
  }
  void o.ctx;
  return out;
}

// -----------------------------------------------------------------------------
// Manubrio + espejos
// -----------------------------------------------------------------------------

export interface HandlebarOpts {
  sk: MotoSkeleton;
  ctx: TemplateContext;
  /** Y del manubrio. */
  barY: number;
  /** Distancia del centro a la punta del puño (semiancho real). */
  halfWidth: number;
  /** Media separacion de las torretas. */
  riserHalf: number;
  /** 'wide' manubrio alto | 'clip' empunaduras bajas (sport). */
  shape: 'wide' | 'clip';
  /** Semiancho de los espejos: el BORDE EXTERIOR de la luna cae aqui. */
  mirrorHalf: number;
  /** Y del punto mas alto del espejo. */
  mirrorTopY: number;
}

/**
 * Resultado del manubrio: la barra va a su ranura y los espejos a la suya, porque el
 * motor los enfoca por separado y el usuario puede cambiar uno sin el otro.
 */
export interface HandlebarResult {
  handlebar: Buckets;
  mirrors: Buckets;
}

/**
 * Manubrio: torretas + rise + barra + puños + perillas, y aparte los espejos. El ANCHO de
 * la ficha es el ancho del manubrio: el semiancho de la barra (`halfWidth`) y el borde
 * exterior de las lunas (`mirrorHalf`) son parametros que fija la plantilla, asi que el
 * ancho medido del modelo sale de la medida y no de un numero inventado.
 */
export function handlebarGeometry(o: HandlebarOpts): HandlebarResult {
  const { sk } = o;
  const bar: Buckets = {};
  const mir: Buckets = {};
  const topX = sk.axisAt(sk.steerTopY)[0];
  const barY = o.barY;
  const hw = o.halfWidth;

  // Torretas sobre las placas de direccion.
  for (const s of [1, -1]) {
    const clamp = box(0.052, 0.03, 0.052, 0.008, 1);
    clamp.translate(topX, sk.steerTopY + 0.012, s * o.riserHalf);
    add(bar, 'alu', clamp);
  }

  let stalkX: number;
  let stalkBaseY: number;
  if (o.shape === 'clip') {
    // Empuñaduras bajas (deportiva): barras cortas y caidas desde los topes de horquilla.
    stalkX = sk.forkAt(sk.steerTopY - 0.06)[0] + 0.02;
    stalkBaseY = sk.steerTopY - 0.055;
    for (const s of [1, -1]) {
      const base: P3 = [sk.forkAt(sk.steerTopY - 0.06)[0], sk.steerTopY - 0.06, s * (o.riserHalf + 0.03)];
      const tip: P3 = [base[0] + 0.03, base[1] - 0.035, s * hw];
      add(bar, 'dark', strut(base, tip, 0.0155, 10, 0.0135));
      add(bar, 'plastic', strut(tip, [tip[0] + 0.005, tip[1] - 0.005, s * (hw + 0.07)], 0.017, 10));
      // Perilla de freno a la derecha y pedal de cambio a la izquierda.
      add(bar, 'alu', strut([tip[0], tip[1] + 0.01, s * (hw - 0.02)], [tip[0] + 0.075, tip[1] - 0.012, s * (hw - 0.06)], 0.006, 6));
    }
  } else {
    // Manubrio alto: rise desde las torretas y barra que abre hacia atras.
    const sweep = 0.085;
    stalkX = topX + sweep + 0.01;
    stalkBaseY = barY + 0.014;
    for (const s of [1, -1]) {
      add(bar, 'dark', strut([topX, sk.steerTopY + 0.02, s * o.riserHalf], [topX + 0.004, barY, s * o.riserHalf], 0.0125, 8));
    }
    add(
      bar,
      'dark',
      tube(
        [
          [topX + 0.004, barY, -hw],
          [topX + sweep * 0.7, barY + 0.01, -(o.riserHalf + 0.03)],
          [topX + sweep * 0.5, barY + 0.012, 0],
          [topX + sweep * 0.7, barY + 0.01, o.riserHalf + 0.03],
          [topX + sweep, barY, hw],
        ],
        0.0135,
        { segments: 44, radial: 9 },
      ),
    );
    for (const s of [1, -1]) {
      const tip: P3 = [topX + sweep, barY, s * hw];
      add(bar, 'plastic', strut(tip, [tip[0], tip[1], s * (hw + 0.062)], 0.017, 10));
      if (s === 1) add(bar, 'alu', strut([tip[0], tip[1] + 0.012, hw - 0.015], [tip[0] + 0.07, tip[1] - 0.005, hw - 0.055], 0.006, 6));
    }
  }

  // Espejos.
  //
  // El brazo tiene que ir del punto donde nace en el manubrio (Z = `stalkZ`, junto a la
  // torreta) HASTA el borde exterior de la luna (Z = `mirrorHalf - MIRROR_EDGE`). Si el
  // brazo se queda en `stalkZ` y la luna se pone en `mirrorHalf - MIRROR_EDGE`, entre las
  // dos queda un hueco de unos 45 mm y el espejo se ve flotando en el render. Por eso el
  // brazo es una tubo de tres puntos: sale hacia fuera, sube y llega a la luna.
  //
  // La luna se baja su propio radio (`mirrorTopY - MIRROR_EDGE`) para que su parte de ARRIBA
  // sea justo el alto de la ficha, y el borde exterior cae en `mirrorHalf` para el ancho.
  const stalkZ = Math.min(hw - 0.008, o.mirrorHalf - 0.05);
  const mirrorY = o.mirrorTopY - MIRROR_EDGE;
  const lensZ = (o.mirrorHalf - MIRROR_EDGE) * 1;
  const seg = o.ctx.lod === 'high' ? 18 : 10;
  for (const s of [1, -1]) {
    const root: P3 = [stalkX, stalkBaseY, stalkZ * s];
    const elbow: P3 = [stalkX + 0.012, stalkBaseY + 0.055, ((stalkZ + lensZ) / 2) * s];
    const lens: P3 = [stalkX - 0.012, mirrorY + 0.02, lensZ * s];
    // Brazo: de la torreta al espejo, con el codo a media luz. Es la pieza que hace que
    // el espejo deje de flotar.
    add(mir, 'plastic', tube([root, elbow, lens], 0.0065, { segments: 16, radial: 6 }));
    // La luna es un disco cuyo eje queda en +X: la cara mira hacia atras.
    const glass = lathe(
      [
        [0.001, 0],
        [0.03, 0],
        [0.032, 0.005],
        [0.001, 0.008],
      ],
      seg,
    );
    glass.rotateZ(-Math.PI / 2);
    glass.rotateY(s * 0.22);
    glass.translate(lens[0] - 0.01, mirrorY, lensZ * s);
    add(mir, 'glass', glass);
    // Carcasa: sin ella la luna se ve flotando.
    const shell = lathe(
      [
        [0.001, 0],
        [MIRROR_EDGE, 0],
        [MIRROR_EDGE, 0.005],
        [0.001, 0.005],
      ],
      seg,
    );
    shell.rotateZ(-Math.PI / 2);
    shell.rotateY(s * 0.22);
    shell.translate(lens[0] - 0.008, mirrorY, lensZ * s);
    add(mir, 'plastic', shell);
  }
  return { handlebar: bar, mirrors: mir };
}

// -----------------------------------------------------------------------------
// Guardabarros
// -----------------------------------------------------------------------------

export interface FenderOpts {
  center: P2;
  radius: number;
  /** Ancho (m). */
  width: number;
  /** Angulo inicial y final del arco, en radianes (0 = adelante, PI/2 = arriba). */
  a0: number;
  a1: number;
  /** Grosor de la chapa. */
  thickness?: number;
  /** How much the fender is pushed out from the wheel (m). */
  lift?: number;
  /** Adelanto en X pararialzar el arco respecto a la rueda. */
  skew?: number;
}

/** Guardabarros: arco de chapa sobre la rueda. Un arco de verdad, no una caja recta. */
export function fenderGeometry(o: FenderOpts): BufferGeometry {
  const th = o.thickness ?? 0.01;
  const r = o.radius;
  const lift = o.lift ?? 0;
  const skew = o.skew ?? 0;
  const pts: P2[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = o.a0 + ((o.a1 - o.a0) * i) / n;
    pts.push([o.center[0] + Math.cos(a) * r + skew, o.center[1] + Math.sin(a) * r + lift]);
  }
  // Perfil cerrado: arco exterior y, de vuelta, arco interior -> chapa de espesor th.
  const inner = r - th;
  const profile: P2[] = pts.slice();
  for (let i = pts.length - 1; i >= 0; i--) {
    const a = o.a0 + ((o.a1 - o.a0) * i) / n;
    profile.push([o.center[0] + Math.cos(a) * inner + skew, o.center[1] + Math.sin(a) * inner + lift]);
  }
  return loft(
    profile.map((p, i) => ({
      x: p[0],
      ring: ring(
        { halfWidthBottom: o.width / 2, halfWidthTop: o.width / 2 - th * 0.6, yBottom: p[1] - th / 2, yTop: p[1] + th / 2, x: 0 },
        8,
        4,
      ),
    })),
    { caps: true },
  );
}

// -----------------------------------------------------------------------------
// Luces
// -----------------------------------------------------------------------------

export interface HeadlightOpts {
  ctx: TemplateContext;
  /** Centro del faro [x, y] y su radio. */
  center: P2;
  radius: number;
  /** 'round' | 'rect' (el rect va tumbado, como los faros de carenaje). */
  shape?: 'round' | 'rect';
  /** Ancho del faro recto. */
  width?: number;
  height?: number;
}

/** Faro: carcasa oscura + lente + luz interior. */
export function headlightGeometry(o: HeadlightOpts): Buckets {
  const out: Buckets = {};
  const seg = o.ctx.lod === 'high' ? 24 : 12;
  const [cx, cy] = o.center;
  if (o.shape === 'rect') {
    const w = o.width ?? 0.16;
    const h = o.height ?? 0.09;
    const lens = box(0.03, h, w, 0.012, 2);
    lens.translate(cx + 0.012, cy, 0);
    add(out, 'glass', lens);
    const bezel = box(0.035, h + 0.018, w + 0.018, 0.012, 2);
    bezel.translate(cx, cy, 0);
    add(out, 'plastic', bezel);
    const lamp = box(0.012, h * 0.5, w * 0.5, 0.005, 1);
    lamp.translate(cx + 0.026, cy, 0);
    add(out, 'head', lamp);
    return out;
  }
  const lens = lathe(
    [
      [0.001, 0.004],
      [o.radius * 0.72, 0.008],
      [o.radius, 0.018],
      [o.radius, 0.028],
      [0.001, 0.028],
    ],
    seg,
  );
  lens.rotateZ(-Math.PI / 2);
  lens.translate(cx, cy, 0);
  add(out, 'glass', lens);
  const bezel = lathe(
    [
      [o.radius * 0.98, 0.03],
      [o.radius * 1.12, 0.026],
      [o.radius * 1.12, 0],
      [o.radius * 0.98, 0],
    ],
    seg,
  );
  bezel.rotateZ(-Math.PI / 2);
  bezel.translate(cx, cy, 0);
  add(out, 'plastic', bezel);
  const lamp = lathe(
    [
      [0.001, 0.006],
      [o.radius * 0.62, 0.006],
      [o.radius * 0.62, 0.016],
      [0.001, 0.016],
    ],
    o.ctx.lod === 'high' ? 18 : 10,
  );
  lamp.rotateZ(-Math.PI / 2);
  lamp.translate(cx + 0.004, cy, 0);
  add(out, 'head', lamp);
  return out;
}

/** Stop: pequena pieza roja al final de la cola. */
export function taillightGeometry(o: { ctx: TemplateContext; at: P3; size?: P2 }): Buckets {
  const s = o.size ?? [0.05, 0.032];
  const out: Buckets = {};
  const lamp = box(s[0], s[1], s[1] * 1.8, 0.01, 1);
  lamp.translate(o.at[0], o.at[1], o.at[2]);
  add(out, 'tail', lamp);
  if (o.ctx.lod === 'high') {
    const base = box(s[0] * 0.7, s[1] * 1.1, s[1] * 2, 0.008, 1);
    base.translate(o.at[0] - 0.012, o.at[1], o.at[2]);
    add(out, 'plastic', base);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Piezas internas (visibles solo en xray)
// -----------------------------------------------------------------------------

export interface InternalOpts {
  ctx: TemplateContext;
  engineCenter: P2;
  engineLength: number;
  engineHeight: number;
  engineWidth: number;
  tankBottomY?: number;
  seatTopY: number;
  rearX: number;
}

/**
 * Piezas internas: cazoleta de aceite, filtro de aire, bateria y bujias. No se ven en
 * modo bonito, pero tienen que existir y estar en su sitio: el modo xray las muestra y el
 * usuario hace clic en ellas para ver su salud.
 */
export function internalParts(o: InternalOpts): Record<'engine_oil' | 'air_filter' | 'battery' | 'spark_plugs', Buckets> {
  const out = {} as Record<'engine_oil' | 'air_filter' | 'battery' | 'spark_plugs', Buckets>;
  const [cx, cy] = o.engineCenter;
  const seg = o.ctx.lod === 'high' ? 18 : 10;

  // Aceite: cazoleta del carter con tapon.
  const oil = box(o.engineLength * 0.5, o.engineHeight * 0.14, o.engineWidth * 0.7, 0.012, 1);
  oil.translate(cx - 0.01, cy - o.engineHeight * 0.4, 0);
  const plug = lathe(
    [
      [0.001, 0],
      [0.014, 0],
      [0.014, 0.01],
      [0.001, 0.01],
    ],
    seg,
  );
  plug.translate(cx + 0.02, cy - o.engineHeight * 0.4 - 0.014, 0);
  out.engine_oil = { dark: [oil], alu: [plug] };

  // Filtro de aire: caja plastica detras del cilindro.
  const filterCase = box(0.13, 0.11, 0.12, 0.02, 1);
  filterCase.translate(cx - o.engineLength * 0.55, cy + o.engineHeight * 0.42, 0);
  const intake = lathe(
    [
      [0.02, 0],
      [0.028, 0],
      [0.028, 0.05],
      [0.02, 0.05],
    ],
    seg,
  );
  intake.rotateZ(-Math.PI / 2);
  intake.translate(cx - o.engineLength * 0.55 + 0.065, cy + o.engineHeight * 0.42, 0);
  out.air_filter = { plastic: [filterCase], rubber: [intake] };

  // Bateria: caja pequeña bajo la cola, con bornes.
  const bat = box(0.11, 0.075, 0.085, 0.008, 1);
  bat.translate(o.rearX * 0.25, o.seatTopY - 0.11, 0.045);
  const term = box(0.02, 0.016, 0.02, 0.004, 1);
  term.translate(o.rearX * 0.25 + 0.03, o.seatTopY - 0.072, 0.045);
  out.battery = { plastic: [bat], steel: [term] };

  // Bujias: en la culata del cilindro.
  const sparkA = strut([cx + 0.06, cy + o.engineHeight * 0.95, 0.03], [cx + 0.085, cy + o.engineHeight * 0.95 + 0.05, 0.03], 0.008, 8);
  const sparkB = strut([cx + 0.06, cy + o.engineHeight * 0.95, -0.03], [cx + 0.085, cy + o.engineHeight * 0.95 + 0.05, -0.03], 0.008, 8);
  out.spark_plugs = { steel: [sparkA, sparkB] };

  void o.tankBottomY;
  return out;
}