/**
 * collapse.ts — Fusiona las mallas de una ranura en UNA malla por material.
 *
 * Por que: cada Mesh es un draw call, y un pesado con 4 ruedas dobles, chasis, cabina
 * y detalles pasaba de 240 (presupuesto de escena: 120). Las plantillas construyen con
 * todas las mallas que quieran y al final llaman collapsePart() por ranura: el arbol
 * queda `part:<slot>` → 1 malla por material, con el slotId en cada malla (picking) y
 * las mismas posiciones (los focusPoints no cambian).
 *
 * Solo conserva position/normal/uv: ninguna plantilla usa otros atributos. Las mallas
 * con material multiple (array) se dejan tal cual.
 */
import { BufferAttribute, type BufferGeometry, Group, Matrix4, Mesh, type Material, type Object3D } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function normalized(src: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const g = (src.index ? src.toNonIndexed() : src.clone()) as BufferGeometry;
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    const count = g.getAttribute('position').count;
    g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  }
  g.clearGroups();
  g.applyMatrix4(matrix);
  return g;
}

/**
 * Devuelve un grupo `part:<slotId>` equivalente a `root` con una malla por material.
 * `root` puede ser el grupo que devolvio part() o cualquier Object3D.
 */
export function collapsePart(slotId: string, root: Object3D): Group {
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const byMaterial = new Map<Material, BufferGeometry[]>();
  const keep: Mesh[] = [];

  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (Array.isArray(m.material)) {
      keep.push(m);
      return;
    }
    const rel = new Matrix4().multiplyMatrices(inverse, m.matrixWorld);
    const list = byMaterial.get(m.material) ?? [];
    list.push(normalized(m.geometry, rel));
    byMaterial.set(m.material, list);
  });

  const out = new Group();
  out.name = `part:${slotId}`;
  out.userData.slotId = slotId;
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);

  for (const [material, geos] of byMaterial) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.slotId = slotId;
    // `root` ya tiene su transformacion; las geometrias quedaron en su espacio local.
    out.add(mesh);
  }
  for (const m of keep) {
    const clone = m.clone();
    new Matrix4().multiplyMatrices(inverse, m.matrixWorld).decompose(clone.position, clone.quaternion, clone.scale);
    clone.userData.slotId = slotId;
    out.add(clone);
  }
  return out;
}

/** collapsePart() sobre cada ranura de un mapa; devuelve el mapa nuevo (mismo orden). */
export function collapseParts<T extends Object3D>(parts: Map<string, T>): Map<string, Group> {
  const out = new Map<string, Group>();
  for (const [id, obj] of parts) out.set(id, collapsePart(id, obj));
  return out;
}
