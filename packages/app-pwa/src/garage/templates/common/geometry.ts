/**
 * geometry.ts — Primitivas para construir vehiculos por codigo.
 *
 *   loft()            superficie cerrada entre secciones transversales a lo largo de X
 *                     (carrocerias, tanques, carenajes). Es la herramienta principal.
 *   bodySection()     seccion tipo superelipse con ancho distinto arriba y abajo
 *                     (techo mas estrecho que la cintura = "tumblehome").
 *   extrudeProfile()  perfil 2D (x, y) extruido en Z con bisel (paneles, guardabarros).
 *   tube()            tubo por una curva (chasis tubular, manubrio, escapes).
 *   roundedBox()      caja con aristas redondeadas (bateria, caliper, bloques).
 *   part()            agrupa mallas en la ranura `part:<slotId>` con userData.slotId.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  Shape,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PartSlotId } from '../../contracts';

export type P2 = [number, number];
export type P3 = [number, number, number];

export interface LoftSection {
  /** Posicion de la seccion sobre el eje X (metros). */
  x: number;
  /** Lazo cerrado de puntos (z, y). Todas las secciones deben tener el mismo numero. */
  ring: P2[];
}

/**
 * Superficie cerrada que une secciones consecutivas, con tapas en los extremos.
 * Las normales salen hacia afuera sin importar el sentido en que vengan los lazos.
 */
export function loft(sections: LoftSection[], opts: { caps?: boolean } = {}): BufferGeometry {
  const caps = opts.caps ?? true;
  const S = sections.length;
  if (S < 2) throw new Error('loft: hacen falta al menos 2 secciones');
  const N = sections[0].ring.length;
  if (sections.some((s) => s.ring.length !== N)) throw new Error('loft: todas las secciones deben tener los mismos puntos');

  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  // Lateral: N+1 columnas para cerrar la costura con UV continua.
  for (let i = 0; i < S; i++) {
    const { x, ring } = sections[i];
    for (let j = 0; j <= N; j++) {
      const [z, y] = ring[j % N];
      pos.push(x, y, z);
      uvs.push(j / N, i / (S - 1));
    }
  }
  const row = N + 1;
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const sideCount = idx.length;

  // Tapas en abanico desde el centroide (vertices propios: arista dura con el lateral).
  if (caps) {
    for (const end of [0, S - 1]) {
      const { x, ring } = sections[end];
      const cz = ring.reduce((s, p) => s + p[0], 0) / N;
      const cy = ring.reduce((s, p) => s + p[1], 0) / N;
      const base = pos.length / 3;
      pos.push(x, cy, cz);
      uvs.push(0.5, 0.5);
      for (let j = 0; j < N; j++) {
        pos.push(x, ring[j][1], ring[j][0]);
        uvs.push(0.5 + ring[j][0], 0.5 + ring[j][1]);
      }
      for (let j = 0; j < N; j++) idx.push(base, base + 1 + j, base + 1 + ((j + 1) % N));
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(orientOutward(pos, idx, sideCount, sections));
  g.computeVertexNormals();
  return g;
}

/** Voltea el orden de los triangulos (por bloque lateral / tapas) si la normal apunta hacia adentro. */
function orientOutward(pos: number[], idx: number[], sideCount: number, sections: LoftSection[]): number[] {
  const v = (k: number) => new Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const normalOf = (t: number) => {
    const a = v(idx[t]);
    const b = v(idx[t + 1]);
    const c = v(idx[t + 2]);
    return b.clone().sub(a).cross(c.clone().sub(a));
  };
  const flip = (from: number, to: number) => {
    for (let t = from; t < to; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  };

  // Lateral: compara con el vector desde el eje de la seccion intermedia.
  const mid = Math.floor((sections.length - 1) / 2);
  const ring = sections[mid].ring;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  let score = 0;
  for (let t = 0; t < sideCount; t += 3) {
    const n = normalOf(t);
    const a = v(idx[t]);
    score += n.y * (a.y - cy) + n.z * (a.z - cz);
  }
  if (score < 0) flip(0, sideCount);

  // Tapas: la primera debe mirar a -X (si las secciones avanzan en +X) y la ultima a +X.
  const capLen = (idx.length - sideCount) / 2;
  if (capLen > 0) {
    const dir = Math.sign(sections[sections.length - 1].x - sections[0].x) || 1;
    if (normalOf(sideCount).x * -dir < 0) flip(sideCount, sideCount + capLen);
    if (normalOf(sideCount + capLen).x * dir < 0) flip(sideCount + capLen, idx.length);
  }
  return idx;
}

export interface BodySectionOpts {
  /** Medio ancho en la base y en el tope (metros). */
  halfWidthBottom: number;
  halfWidthTop: number;
  yBottom: number;
  yTop: number;
  /** Exponente de superelipse: 2 = elipse, 4 = rectangulo redondeado, 8 = casi caja. */
  n?: number;
  /** Puntos del lazo (multiplo de 4 recomendado). */
  points?: number;
  /** Desplazamiento lateral del centro (casi siempre 0). */
  zCenter?: number;
}

/** Seccion transversal (z, y) para loft(): superelipse que se estrecha hacia arriba. */
export function bodySection(o: BodySectionOpts): P2[] {
  const n = o.n ?? 4;
  const count = o.points ?? 32;
  const e = 2 / n;
  const zc = o.zCenter ?? 0;
  const out: P2[] = [];
  for (let k = 0; k < count; k++) {
    const t = (k / count) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const zn = Math.sign(c) * Math.abs(c) ** e;
    const yn = Math.sign(s) * Math.abs(s) ** e;
    const h = (yn + 1) / 2;
    const half = o.halfWidthBottom + (o.halfWidthTop - o.halfWidthBottom) * h;
    out.push([zc + zn * half, o.yBottom + h * (o.yTop - o.yBottom)]);
  }
  return out;
}

export interface ExtrudeOpts {
  depth: number;
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
}

/** Perfil 2D (x, y) cerrado, extruido en Z y centrado en z = 0, con bisel. */
export function extrudeProfile(points: P2[], o: ExtrudeOpts): BufferGeometry {
  const shape = new Shape(points.map(([x, y]) => new Vector2(x, y)));
  const bevel = o.bevel ?? Math.min(0.01, o.depth * 0.2);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, o.depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: o.bevelSegments ?? 2,
    curveSegments: o.curveSegments ?? 12,
  });
  g.translate(0, 0, -(o.depth - bevel * 2) / 2);
  g.computeVertexNormals();
  return g;
}

/** Tubo suave por puntos de control. */
export function tube(points: P3[], radius: number, o: { radial?: number; segments?: number; closed?: boolean } = {}): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), o.closed ?? false, 'catmullrom', 0.5);
  return new TubeGeometry(curve, o.segments ?? Math.max(8, points.length * 8), radius, o.radial ?? 10, o.closed ?? false);
}

/** Solido de revolucion alrededor de Y a partir de un perfil (radio, y). */
export function lathe(profile: P2[], segments = 48): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);
}

export function roundedBox(w: number, h: number, d: number, radius = Math.min(w, h, d) * 0.15, segments = 2): BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segments, radius);
}

/** Malla con sombras activadas. */
export function mesh(geometry: BufferGeometry, material: unknown, at?: P3): Mesh {
  const m = new Mesh(geometry, material as Material);
  m.castShadow = true;
  m.receiveShadow = true;
  if (at) m.position.set(...at);
  return m;
}

/** Agrupa objetos en la ranura `part:<slotId>` y marca cada malla con su slotId (para el picking). */
export function part(slotId: PartSlotId, ...children: Object3D[]): Group {
  const g = new Group();
  g.name = `part:${slotId}`;
  g.userData.slotId = slotId;
  for (const c of children) {
    g.add(c);
    c.traverse((o) => {
      o.userData.slotId = slotId;
    });
  }
  return g;
}

/** Triangulos totales de un objeto (para presupuestos y tests). */
export function countTriangles(root: Object3D): number {
  let total = 0;
  root.traverse((o) => {
    const g = (o as Mesh).geometry as BufferGeometry | undefined;
    if (!(o as Mesh).isMesh || !g) return;
    total += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
  });
  return Math.round(total);
}
