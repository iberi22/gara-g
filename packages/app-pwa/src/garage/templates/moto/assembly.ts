/**
 * assembly.ts — Ensamblaje de las piezas de moto en sus ranuras.
 *
 * Los constructores de motoKit devuelven "cubos" de geometria agrupados por material
 * (Buckets). Aqui se convierten en los grupos `part:<slot>` que exigen los contratos y
 * que usa el picking del motor. Concentrarlo garantiza tres reglas:
 *
 *   1. cada malla termina dentro de exactamente UNA ranura (el picking depende de eso),
 *   2. una ranura con N piezas del mismo material acaba en 1 sola malla (draw calls),
 *   3. quien llama no necesita saber nada de Object3D: solo llama `add(slot, bucket)`.
 *
 * No hay estado global: cada `build()` de plantilla crea su propia instancia.
 */
import { Group, type BufferGeometry, type Object3D } from 'three/webgpu';
import type { BuiltVehicle, MaterialKit, PartSlotId, PaintSpec, TemplateContext, TireSize } from '../../contracts';
import { countTriangles, mesh, part } from '../common/geometry';
import { buildWheel } from '../common/wheel';
import { fuse, matFor, type Buckets, type MatKey } from './motoKit';
import type { MotoSkeleton } from './skeleton';

/** Geometrias de un slot, agrupadas por material del kit. */
export type SlotBuckets = Map<PartSlotId, Buckets>;

export interface AssemblySpec {
  templateId: string;
  spec: VehicleSpecLike;
  ctx: TemplateContext;
  sk: MotoSkeleton;
}

interface VehicleSpecLike {
  paint: PaintSpec;
  tireFront: TireSize;
  tireRear: TireSize;
}

export interface WheelOpts {
  frontStyle?: 'spokes' | 'split' | 'mesh' | 'disc';
  rearStyle?: 'spokes' | 'split' | 'mesh' | 'disc';
  frontSpokes?: number;
  rearSpokes?: number;
}

/**
 * Acumula la moto y la entrega lista. Uso tipico de una plantilla:
 *
 *   const a = new MotoAssembly(spec, ctx, sk, 'moto-naked');
 *   a.wheels({ rearStyle: 'mesh' });
 *   a.add('engine', engineGeometry({...}));
 *   return a.finish();
 */
export class MotoAssembly {
  readonly slots: SlotBuckets = new Map();
  readonly focus = new Map<PartSlotId, [number, number, number]>();
  private frontWheel: { tire: Object3D; rim: Object3D; brake: Object3D } | null = null;
  private rearWheel: { tire: Object3D; rim: Object3D; brake: Object3D } | null = null;

  constructor(private readonly o: AssemblySpec) {}

  /** Anade (o acumula) geometria a una ranura. Devuelve `this` para encadenar. */
  add(slot: PartSlotId, buckets: Buckets): this {
    const cur = this.slots.get(slot) ?? {};
    for (const [key, geoms] of Object.entries(buckets) as [MatKey, BufferGeometry[]][]) {
      if (!geoms || geoms.length === 0) continue;
      (cur[key] ??= []).push(...geoms);
    }
    this.slots.set(slot, cur);
    return this;
  }

  /** Punto al que mira la camara al enfocar la pieza. */
  focusOn(slot: PartSlotId, at: [number, number, number]): this {
    this.focus.set(slot, at);
    return this;
  }

  /**
   * Ruedas. Se construyen SIEMPRE con buildWheel() del kit comun (los diametros y
   * anchos salen de la medida de llanta de la ficha) y cada pieza va a su ranura:
   * tire -> tire_*, rim -> rim_*, brake -> brake_*.
   */
  wheels(opts: WheelOpts = {}): this {
    const { spec, ctx } = this.o;
    const front = buildWheel(
      { tire: spec.tireFront, family: 'moto', paint: spec.paint, side: 1, style: opts.frontStyle, spokes: opts.frontSpokes },
      ctx,
    );
    const rear = buildWheel(
      { tire: spec.tireRear, family: 'moto', paint: spec.paint, side: 1, rear: true, style: opts.rearStyle, spokes: opts.rearSpokes },
      ctx,
    );
    const [ax, ay] = this.o.sk.axleF;
    const [bx, by] = this.o.sk.axleR;
    front.tire.position.set(ax, ay, 0);
    front.rim.position.set(ax, ay, 0);
    front.brake.position.set(ax, ay, 0);
    rear.tire.position.set(bx, by, 0);
    rear.rim.position.set(bx, by, 0);
    rear.brake.position.set(bx, by, 0);
    this.frontWheel = front;
    this.rearWheel = rear;
    this.focusOn('tire_front', [ax, ay, 0]);
    this.focusOn('rim_front', [ax, ay, 0]);
    this.focusOn('brake_front', [ax, ay + this.o.sk.rF * 0.55, 0]);
    this.focusOn('tire_rear', [bx, by, 0]);
    this.focusOn('rim_rear', [bx, by, 0]);
    this.focusOn('brake_rear', [bx, by + this.o.sk.rR * 0.55, 0]);
    return this;
  }

  /** Construye el arbol final y lo devuelve como BuiltVehicle. */
  finish(): BuiltVehicle {
    const root = new Group();
    root.name = `vehicle:${this.o.templateId}`;
    const parts = new Map<PartSlotId, Group>();
    const kit: MaterialKit = this.o.ctx.materials;

    for (const [slot, buckets] of this.slots) {
      const children: Object3D[] = [];
      for (const [key, geoms] of Object.entries(buckets) as [MatKey, BufferGeometry[]][]) {
        if (!geoms || geoms.length === 0) continue;
        children.push(mesh(fuse(geoms), matFor(kit, this.o.spec.paint, key)));
      }
      if (children.length === 0) continue;
      const g = part(slot, ...children);
      root.add(g);
      parts.set(slot, g);
    }

    for (const w of [this.frontWheel, this.rearWheel]) {
      if (!w) continue;
      const tag = w === this.frontWheel ? 'front' : 'rear';
      for (const [slot, obj] of [
        [`tire_${tag}`, w.tire],
        [`rim_${tag}`, w.rim],
        [`brake_${tag}`, w.brake],
      ] as [PartSlotId, Object3D][]) {
        const g = part(slot, obj);
        root.add(g);
        parts.set(slot, g);
      }
    }

    return {
      root,
      parts,
      focusPoints: Object.fromEntries(this.focus) as Record<PartSlotId, [number, number, number]>,
      triangles: countTriangles(root),
    };
  }
}

/** Semiancho util del chasis: limite que ninguna pieza de la moto debe pasar. */
export const halfOf = (widthM: number): number => widthM / 2;