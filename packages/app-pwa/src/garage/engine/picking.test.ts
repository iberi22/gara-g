import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three/webgpu';
import { findSlotId } from './picking';

describe('Picking Slot Resolution', () => {
  it('resuelve slotId directamente desde userData del objeto', () => {
    const mesh = new Mesh();
    mesh.userData.slotId = 'brake_front';
    expect(findSlotId(mesh)).toBe('brake_front');
  });

  it('resuelve slotId navegando hacia arriba por los padres', () => {
    const root = new Group();
    root.userData.slotId = 'engine';

    const childGroup = new Group();
    const leafMesh = new Mesh();

    root.add(childGroup);
    childGroup.add(leafMesh);

    expect(findSlotId(leafMesh)).toBe('engine');
    expect(findSlotId(childGroup)).toBe('engine');
  });

  it('resuelve slotId desde la convencion de nombre part:<slotId>', () => {
    const group = new Group();
    group.name = 'part:battery';

    const mesh = new Mesh();
    group.add(mesh);

    expect(findSlotId(mesh)).toBe('battery');
  });

  it('devuelve null si no hay slotId ni en el objeto ni en sus ancestros', () => {
    const root = new Group();
    const mesh = new Mesh();
    root.add(mesh);

    expect(findSlotId(mesh)).toBe(null);
    expect(findSlotId(null)).toBe(null);
    expect(findSlotId(undefined)).toBe(null);
  });
});
