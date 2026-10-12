/**
 * wheel.ts — Rueda completa a partir de la medida de la llanta. Es el ejemplo de
 * referencia de "medidas → geometria": nada aqui esta a ojo salvo proporciones de
 * estilo; diametro, ancho y rin salen de la medida (205/55R16 → 631,9 mm).
 *
 * La rueda se construye con el eje sobre Z y centrada en el origen. La plantilla la
 * coloca en el centro de la rueda y mete cada pieza en su ranura:
 *   tire  → tire_*   rim → rim_*   brake → brake_*
 */
import { BufferGeometry, Group, Mesh, type Object3D } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PaintSpec, TemplateContext, TireSize } from '../../contracts';
import { lathe, mesh, roundedBox, type P2 } from './geometry';
import { mm, rimRadius, tireRadius } from './units';

export type RimStyle = 'spokes' | 'split' | 'mesh' | 'disc';

export interface WheelOpts {
  tire: TireSize;
  /** 'machinery' se dibuja como 'heavy' (llanta de obra, cubo grande). */
  family: 'moto' | 'car' | 'heavy' | 'machinery';
  style?: RimStyle;
  spokes?: number;
  paint: PaintSpec;
  /** Diametro del disco de freno en mm; por defecto ~80 % del rin (carro) o 85 % (moto). */
  discMm?: number;
  /** Lado: +1 si la cara exterior mira a +Z (lado izquierdo), -1 a -Z. */
  side?: 1 | -1;
  /** Moto trasera: sin caliper visible del lado de la cadena, disco mas chico. */
  rear?: boolean;
}

export interface BuiltWheel {
  tire: Mesh;
  rim: Group;
  brake: Group;
  /** Radio exterior y ancho de la llanta (metros). */
  radius: number;
  width: number;
}

/** Perfil (radio, y) de media llanta, del talon a la banda, con surcos longitudinales. */
function tireProfile(t: TireSize, family: WheelOpts['family'], lod: TemplateContext['lod']): P2[] {
  const rIn = rimRadius(t) * 0.985;
  const rOut = tireRadius(t);
  const w = mm(t.widthMm);
  const side = rOut - rIn;
  const pts: P2[] = [];
  if (family === 'moto') {
    // Corona redonda: la seccion de una llanta de moto es casi un semicirculo.
    const n = lod === 'high' ? 14 : 8;
    pts.push([rIn, -w * 0.36]);
    for (let k = 0; k <= n; k++) {
      const a = -Math.PI / 2 + (k / n) * Math.PI;
      pts.push([rIn + side * 0.42 + Math.cos(a) * side * 0.58, Math.sin(a) * w * 0.5]);
    }
    pts.push([rIn, w * 0.36]);
    return pts;
  }
  // Carro/pesado: flanco abombado, hombro redondeado y banda con 4 surcos.
  const half = w / 2;
  pts.push([rIn, -half * 0.86]);
  pts.push([rIn + side * 0.35, -half * 1.0]);
  pts.push([rIn + side * 0.75, -half * 0.98]);
  pts.push([rOut - side * 0.06, -half * 0.9]);
  pts.push([rOut, -half * 0.78]);
  if (lod === 'high') {
    const grooves = [-0.48, -0.16, 0.16, 0.48];
    const gw = half * 0.05;
    const gd = side * 0.06;
    for (const g of grooves) {
      const y = g * half;
      pts.push([rOut, y - gw], [rOut - gd, y - gw * 0.6], [rOut - gd, y + gw * 0.6], [rOut, y + gw]);
    }
  }
  pts.push([rOut, half * 0.78]);
  pts.push([rOut - side * 0.06, half * 0.9]);
  pts.push([rIn + side * 0.75, half * 0.98]);
  pts.push([rIn + side * 0.35, half * 1.0]);
  pts.push([rIn, half * 0.86]);
  return pts;
}

/** Rayos: cajas redondeadas del cubo al barril, unidas en una sola geometria. */
function spokesGeometry(n: number, rHub: number, rBarrel: number, width: number, style: RimStyle, side: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const len = rBarrel - rHub;
  const make = (angle: number, thick: number) => {
    const g = roundedBox(len, thick, width * 0.14, thick * 0.35, 1);
    // Rayo sobre +X, luego se lleva a su angulo; un poco hacia afuera (concavidad).
    g.translate(rHub + len / 2, 0, side * width * 0.18);
    g.rotateZ(angle);
    return g;
  };
  const step = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const a = k * step;
    if (style === 'split') {
      parts.push(make(a - step * 0.07, rBarrel * 0.07), make(a + step * 0.07, rBarrel * 0.07));
    } else if (style === 'mesh') {
      parts.push(make(a, rBarrel * 0.05), make(a + step / 2, rBarrel * 0.035));
    } else {
      parts.push(make(a, rBarrel * 0.12));
    }
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

export function buildWheel(o: WheelOpts, ctx: TemplateContext): BuiltWheel {
  const { materials: kit, lod } = ctx;
  const side = o.side ?? 1;
  const seg = lod === 'high' ? 64 : 32;
  const t = o.tire;
  const rRim = rimRadius(t);
  const rOut = tireRadius(t);
  const w = mm(t.widthMm);
  const style = o.style ?? (o.family === 'moto' ? 'split' : 'spokes');
  const n = o.spokes ?? (o.family === 'moto' ? 5 : o.family === 'heavy' || o.family === 'machinery' ? 10 : 5);

  // Llanta: revolucion del perfil alrededor de Y; luego eje Y → Z.
  const tireGeo = lathe(tireProfile(t, o.family, lod), seg);
  tireGeo.rotateX(Math.PI / 2);
  const tire = mesh(tireGeo, kit.rubber());
  tire.name = 'tire';

  // Rin: barril abierto + pestanas + cubo + rayos + tapa.
  const rim = new Group();
  rim.name = 'rim';
  const barrelW = w * (o.family === 'moto' ? 0.62 : 0.84);
  const rimMat = o.style === 'disc' ? kit.metal('dark') : o.paint.accentColor ? kit.accent(o.paint) : kit.metal('aluminum');
  const barrel = lathe(
    [
      [rRim * 0.9, -barrelW / 2],
      [rRim * 0.99, -barrelW / 2],
      [rRim * 1.0, -barrelW / 2 + 0.004],
      [rRim * 0.93, -barrelW * 0.3],
      [rRim * 0.93, barrelW * 0.3],
      [rRim * 1.0, barrelW / 2 - 0.004],
      [rRim * 0.99, barrelW / 2],
      [rRim * 0.9, barrelW / 2],
    ],
    seg,
  );
  barrel.rotateX(Math.PI / 2);
  rim.add(mesh(barrel, rimMat));

  const rHub = rRim * (o.family === 'heavy' || o.family === 'machinery' ? 0.42 : 0.2);
  const hub = lathe(
    [
      [0.001, -barrelW * 0.3],
      [rHub, -barrelW * 0.3],
      [rHub, barrelW * 0.25],
      [rHub * 0.6, barrelW * 0.3],
      [0.001, barrelW * 0.3],
    ],
    lod === 'high' ? 24 : 12,
  );
  hub.rotateX(Math.PI / 2);
  rim.add(mesh(hub, kit.metal('dark')));

  if (style === 'disc') {
    const face = lathe(
      [
        [rHub, side * barrelW * 0.22],
        [rRim * 0.92, side * barrelW * 0.12],
      ],
      seg,
    );
    face.rotateX(Math.PI / 2);
    rim.add(mesh(face, rimMat));
  } else {
    rim.add(mesh(spokesGeometry(n, rHub * 0.9, rRim * 0.93, barrelW, style, side), rimMat));
  }

  // Freno: disco (aro de acero) + campana oscura + caliper pintado.
  const brake = new Group();
  brake.name = 'brake';
  const discR = mm((o.discMm ?? rRim * 2000 * (o.family === 'moto' ? (o.rear ? 0.62 : 0.85) : 0.8)) / 2);
  const discT = o.family === 'moto' ? 0.005 : 0.024;
  const disc = lathe(
    [
      [discR * 0.62, -discT / 2],
      [discR, -discT / 2],
      [discR, discT / 2],
      [discR * 0.62, discT / 2],
    ],
    seg,
  );
  disc.rotateX(Math.PI / 2);
  const discZ = o.family === 'moto' ? side * barrelW * 0.42 : -side * barrelW * 0.08;
  disc.translate(0, 0, discZ);
  brake.add(mesh(disc, kit.metal('brushed')));

  const carrier = lathe(
    [
      [rHub * 0.8, -discT],
      [discR * 0.64, -discT],
      [discR * 0.64, discT],
      [rHub * 0.8, discT],
    ],
    lod === 'high' ? 24 : 12,
  );
  carrier.rotateX(Math.PI / 2);
  carrier.translate(0, 0, discZ);
  brake.add(mesh(carrier, kit.metal('dark')));

  if (!(o.family === 'moto' && o.rear)) {
    const cw = discR * 0.55;
    const caliper = mesh(roundedBox(cw, discR * 0.22, discT + 0.03, 0.008, 2), kit.accent({ ...o.paint, accentColor: o.paint.accentColor ?? '#c8102e' }));
    // Arriba y hacia atras del disco (a las 10 en punto mirando de lado).
    const a = Math.PI * 0.62;
    caliper.position.set(Math.cos(a) * discR * 0.82, Math.sin(a) * discR * 0.82, discZ);
    caliper.rotation.z = a - Math.PI / 2;
    brake.add(caliper);
  }

  return { tire, rim, brake, radius: rOut, width: w };
}

/** Pone las tres piezas de una rueda en una posicion (centro de la rueda). */
export function placeWheel(w: BuiltWheel, at: [number, number, number], objects: Object3D[] = [w.tire, w.rim, w.brake]): void {
  for (const o of objects) o.position.set(...at);
}
