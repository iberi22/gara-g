/**
 * skeleton.ts — Ecuacion de posiciones de una moto a partir de su ficha tecnica.
 *
 * Por que existe: la geometria de una moto NO es libre. Las barras de la horquilla
 * son paralelas al eje de direccion y el eje delantero va adelantado respecto a ese
 * eje; si se inventan numeros, la moto se ve "torta" desde el perfil. Este fichero
 * resuelve una sola vez las relaciones que la ficha tecnica si fija:
 *
 *   - entre ejes, eje delantero en +wheelbase/2 y trasero en -wheelbase/2 (y = radio de llanta)
 *   - inclinacion (rake) del eje de direccion desde la vertical
 *   - desplazamiento de la horquilla (fork offset): el centro de la horquilla NO esta
 *     sobre el eje de direccion, va adelantado
 *   - altura de la percha superior de la direccion y del manubrio
 *   - recorrido de suspension expresable, que alarga la horquilla en vez de mover la rueda
 *     (una moto estatica siempre apoya la llanta en el piso: y = 0 es intocable)
 *
 * units.ts ya convierte mm -> metros; aqui solo se opera en metros. La moto mira a +X,
 * el ancho va sobre Z (+Z = lado izquierdo del conductor) y el piso esta en y = 0.
 */
import type { VehicleSpec } from '../../contracts';
import type { P2 } from '../common/geometry';
import { mm, rimRadius, tireRadius } from '../common/units';

const DEG = Math.PI / 180;

export interface SkeletonOpts {
  /** Inclinacion del eje de direccion desde la vertical, en grados (24-27 tipico). */
  rakeDeg: number;
  /** Adelanto del centro de la horquilla respecto al eje de direccion, en mm. */
  forkOffsetMm: number;
  /** Y de la percha superior (borde superior del triple superior), en metros. */
  steerTopY: number;
  /** Recorrido extra de horquilla en el extremo 1 de `suspensionTravel`, en metros. */
  travelRangeM?: number;
}

export interface MotoSkeleton {
  /** Distancia entre ejes en metros. */
  wb: number;
  /** Centro del eje delantero: [x, y]. */
  axleF: P2;
  /** Centro del eje trasero: [x, y]. */
  axleR: P2;
  /** Radios exteriores de llanta, en metros. */
  rF: number;
  rR: number;
  /** Radios de rin, en metros. */
  rimF: number;
  rimR: number;
  rake: number;
  forkOffset: number;
  /** Advance (trail) en mm: rLlanta × sin(rake) − desplazamiento. */
  trailMm: number;
  /** Punto del eje de direccion a la altura del eje delantero: [x, y]. */
  steerBase: P2;
  /** Direccion unitaria del eje de direccion hacia arriba (inclinada atras por el rake). */
  steerDir: P2;
  /** Y de la percha superior de la direccion. */
  steerTopY: number;
  /** x del eje de direccion a la altura de la percha superior. */
  steerTopX: number;
  /** Punto del eje de direccion a la altura `y`. */
  axisAt(y: number): P2;
  /** Linea de la horquilla (paralela al eje de direccion, pasa por el eje delantero). */
  forkAt(y: number): P2;
  /** Linea de la horquilla proyectada sobre Z (para el lado -1). */
  forkSide(y: number, z: number): P2;
  /** Y del eje delantero mas el desplazamiento de la horquilla (donde va el portafreno). */
  axleFz: number;
}

export function makeSkeleton(spec: VehicleSpec, o: SkeletonOpts): MotoSkeleton {
  const wb = mm(spec.dims.wheelbaseMm);
  const rF = tireRadius(spec.tireFront);
  const rR = tireRadius(spec.tireRear);
  const rake = o.rakeDeg * DEG;
  const offset = mm(o.forkOffsetMm);
  const travel = (spec.shape?.suspensionTravel ?? 0) * (o.travelRangeM ?? 0);

  const axleF: P2 = [wb / 2, rF];
  const axleR: P2 = [-wb / 2, rR];
  // Punto del eje de direccion: el eje delantero va adelantado `offset` en la normal.
  const steerBase: P2 = [axleF[0] - offset * Math.cos(rake), axleF[1] - offset * Math.sin(rake)];
  const steerDir: P2 = [-Math.sin(rake), Math.cos(rake)];
  const steerTopY = axleF[1] + travel + Math.max(mm(280), o.steerTopY);
  const tan = Math.tan(rake);

  // Punto del eje de direccion a la altura y. La inclinacion (rake) hace que el eje
  // se incline HACIA ATRAS al subir, asi que x DECRECE con y.
  const axisAt = (y: number): P2 => [steerBase[0] - (y - steerBase[1]) * tan, y];
  // La horquilla es una recta paralela al eje de direccion que pasa por el centro del eje.
  const forkAt = (y: number): P2 => [axleF[0] - (y - axleF[1]) * tan, y];
  const forkSide = (y: number, z: number): P2 => [forkAt(y)[0], z];

  return {
    wb,
    axleF,
    axleR,
    rF,
    rR,
    rimF: rimRadius(spec.tireFront),
    rimR: rimRadius(spec.tireRear),
    rake,
    forkOffset: offset,
    trailMm: Math.round((rF * Math.sin(rake) - offset) * 1000),
    steerBase,
    steerDir,
    steerTopY,
    steerTopX: axisAt(steerTopY)[0],
    axisAt,
    forkAt,
    forkSide,
    axleFz: axleF[1] - offset * Math.sin(rake),
  };
}

/** Variante elegida por el usuario, con reserva si no viene o no existe en la plantilla. */
export function variantOf(spec: VehicleSpec, slot: string, allowed: readonly string[], fallback: string): string {
  const v = spec.variants?.[slot];
  return v && allowed.includes(v) ? v : fallback;
}

/** Parametro de forma normalizado con su default declarado. */
export function shapeParam(spec: VehicleSpec, def: { id: string; default: number }): number {
  const raw = spec.shape?.[def.id];
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : def.default;
}