/**
 * carWheelHelper.ts — Constructor y posicionador de las cuatro ruedas para carros y pesados.
 *
 * Crea las cuatro ruedas usando buildWheel de common/wheel.ts y las empaqueta en
 * sus 12 ranuras canonicas:
 *   tire_fl, tire_fr, tire_rl, tire_rr (llantas)
 *   rim_fl, rim_fr, rim_rl, rim_rr (rines)
 *   brake_fl, brake_fr, brake_rl, brake_rr (frenos)
 *
 * Cada rueda se ubica en su centro exacto:
 *   delanteras: x = +wheelbase/2, z = ±trackFront/2, y = rFront
 *   traseras:   x = -wheelbase/2, z = ±trackRear/2,  y = rRear
 * Con esto el punto mas bajo de cada llanta toca exactamente y = 0.
 */
import { Group } from 'three/webgpu';
import type { PartSlotId, TemplateContext, VehicleSpec } from '../../contracts';
import { part } from '../common/geometry';
import { mm, tireRadius } from '../common/units';
import { buildWheel, placeWheel, type RimStyle } from '../common/wheel';

export interface BuiltCarWheels {
  parts: Map<PartSlotId, Group>;
  focusPoints: Record<PartSlotId, [number, number, number]>;
  rFront: number;
  rRear: number;
  wFront: number;
  wRear: number;
  wb: number;
  tf: number;
  tr: number;
}

export function buildCarWheels(spec: VehicleSpec, ctx: TemplateContext): BuiltCarWheels {
  const parts = new Map<PartSlotId, Group>();
  const focusPoints: Record<PartSlotId, [number, number, number]> = {};

  const wb = mm(spec.dims.wheelbaseMm);
  const tf = mm(spec.dims.trackFrontMm ?? Math.round(spec.dims.widthMm * 0.86));
  const tr = mm(spec.dims.trackRearMm ?? Math.round(spec.dims.widthMm * 0.86));

  const family = spec.family;
  const paint = spec.paint;

  // Variantes de rin seleccionables
  const styleFL = (spec.variants?.rim_fl as RimStyle) ?? (family === 'heavy' ? 'disc' : 'spokes');
  const styleFR = (spec.variants?.rim_fr as RimStyle) ?? styleFL;
  const styleRL = (spec.variants?.rim_rl as RimStyle) ?? styleFL;
  const styleRR = (spec.variants?.rim_rr as RimStyle) ?? styleFL;

  // Lado +1 izquierda (+Z), -1 derecha (-Z)
  const wFL = buildWheel({ tire: spec.tireFront, family, style: styleFL, paint, side: 1 }, ctx);
  const wFR = buildWheel({ tire: spec.tireFront, family, style: styleFR, paint, side: -1 }, ctx);
  const wRL = buildWheel({ tire: spec.tireRear, family, style: styleRL, paint, side: 1, rear: true }, ctx);
  const wRR = buildWheel({ tire: spec.tireRear, family, style: styleRR, paint, side: -1, rear: true }, ctx);

  const rFront = wFL.radius;
  const rRear = wRL.radius;

  const positions: Record<'fl' | 'fr' | 'rl' | 'rr', [number, number, number]> = {
    fl: [wb / 2, rFront, tf / 2],
    fr: [wb / 2, rFront, -tf / 2],
    rl: [-wb / 2, rRear, tr / 2],
    rr: [-wb / 2, rRear, -tr / 2],
  };

  placeWheel(wFL, positions.fl);
  placeWheel(wFR, positions.fr);
  placeWheel(wRL, positions.rl);
  placeWheel(wRR, positions.rr);

  const wheels = [
    { tag: 'fl' as const, w: wFL, pos: positions.fl },
    { tag: 'fr' as const, w: wFR, pos: positions.fr },
    { tag: 'rl' as const, w: wRL, pos: positions.rl },
    { tag: 'rr' as const, w: wRR, pos: positions.rr },
  ];

  for (const { tag, w, pos } of wheels) {
    const slotTire = `tire_${tag}`;
    const slotRim = `rim_${tag}`;
    const slotBrake = `brake_${tag}`;

    const gTire = part(slotTire, w.tire);
    const gRim = part(slotRim, w.rim);
    const gBrake = part(slotBrake, w.brake);

    parts.set(slotTire, gTire);
    parts.set(slotRim, gRim);
    parts.set(slotBrake, gBrake);

    focusPoints[slotTire] = pos;
    focusPoints[slotRim] = pos;
    focusPoints[slotBrake] = pos;
  }

  return {
    parts,
    focusPoints,
    rFront,
    rRear,
    wFront: wFL.width,
    wRear: wRL.width,
    wb,
    tf,
    tr,
  };
}
