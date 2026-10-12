/**
 * excavator.ts — Excavadora hidraulica de orugas (clase 20 t).
 *
 * Pose de exhibicion: pluma levantada, brazo casi vertical y balde recogido apoyado en
 * el suelo delante de las orugas. Medidas de ficha:
 *   wheelbaseMm   = largo de la oruga sobre el suelo (entre rueda guia y sprocket)
 *   trackFrontMm  = trocha (centro a centro de las orugas)
 *   widthMm       = ancho sobre orugas (trocha + zapata)
 *   tireFront.widthMm = ancho de la zapata (las llantas no aplican)
 */
import type { Object3D } from 'three/webgpu';
import type { BuiltVehicle, VehicleTemplate } from '../../contracts';
import type { P2 } from '../common/geometry';
import { mm } from '../common/units';
import {
  addTo,
  arc,
  beamProfile,
  box,
  groundedBucket,
  cylY,
  cylZ,
  finishMachine,
  hydCylinder,
  plate,
  powerPack,
  rbox,
  rearLights,
  ropsCab,
  startMachine,
  trackAssembly,
} from './machineryKit';

export const EXCAVATOR: VehicleTemplate = {
  id: 'machinery-excavator',
  family: 'machinery',
  body: 'excavator',
  label: 'Excavadora de orugas',
  defaults: {
    family: 'machinery',
    body: 'excavator',
    dims: { lengthMm: 9250, widthMm: 2980, heightMm: 3840, wheelbaseMm: 3650, trackFrontMm: 2380, groundClearanceMm: 450 },
    tireFront: { widthMm: 600, aspectPct: 100, rimIn: 0 },
    tireRear: { widthMm: 600, aspectPct: 100, rimIn: 0 },
  },
  shapeParams: [{ id: 'boomLift', label: 'Altura de la pluma', default: 0.5, hint: 'Pluma mas baja o mas alta en la pose de exhibicion' }],
  variants: {},
  build(spec, ctx): BuiltVehicle {
    const b = startMachine(spec, ctx, 'machinery-excavator');
    const kit = ctx.materials;
    const paint = kit.paint(spec.paint);
    const dark = kit.metal('dark');
    const lo = ctx.lod === 'low';

    // --- Tren de rodaje -----------------------------------------------------
    const shoe = mm(spec.tireFront.widthMm || 600);
    const gauge = mm(spec.dims.trackFrontMm ?? spec.dims.widthMm - (spec.tireFront.widthMm || 600));
    const contact = mm(spec.dims.wheelbaseMm);
    const trackH = 0.92;
    const trackLen = contact + trackH * 0.9;
    for (const s of [1, -1] as const) {
      const t = trackAssembly(ctx, { length: trackLen, height: trackH, shoe, z: (s * gauge) / 2 });
      addTo(b, s === 1 ? 'track_left' : 'track_right', t.track, [0, trackH / 2, (s * gauge) / 2]);
      addTo(b, 'chassis_frame', t.frame);
      addTo(b, 'final_drive', t.drive, [-(trackLen / 2 - trackH / 2), trackH / 2, (s * gauge) / 2]);
    }
    // Carbody: la cruceta central que une las orugas.
    addTo(b, 'chassis_frame', [rbox(ctx, 1.6, 0.42, gauge - shoe * 0.6, 0.05, dark, [0, 0.72, 0]), box(0.9, 0.3, gauge - shoe * 0.4, dark, [0, 0.62, 0])], [0, 0.7, 0]);

    // --- Tornamesa y superestructura ---------------------------------------
    const deckY = 1.08;
    addTo(b, 'swing', [cylY(0.95, 0.14, kit.metal('steel'), [0, deckY - 0.07, 0], lo ? 18 : 36)], [0, deckY - 0.07, 0]);
    const upperHalfW = Math.min(1.38, mm(spec.dims.widthMm) / 2 - 0.08);
    const tail = 2.7;
    addTo(b, 'chassis_frame', [box(tail + 1.35, 0.2, upperHalfW * 2, dark, [(1.35 - tail) / 2, deckY + 0.1, 0])]);

    // Compartimiento del motor (atras, todo el ancho) con el contrapeso.
    powerPack(b, {
      x0: -tail + 0.55,
      x1: -0.15,
      y0: deckY + 0.2,
      y1: deckY + 1.15,
      z0: -upperHalfW,
      z1: upperHalfW,
      fuelTankAt: [0.75, deckY + 0.62, -upperHalfW + 0.42],
      fuelTankSize: [1.0, 0.82, 0.8],
    });
    // Contrapeso: planta redondeada atras (perfil en XZ extruido en Y).
    const cwProfile: P2[] = [
      [-tail + 0.62, -upperHalfW],
      ...arc(-tail + 0.62, 0, upperHalfW, -Math.PI / 2, -Math.PI * 1.5, lo ? 8 : 18).map(([x, z]) => [-tail + 0.62 + (x - (-tail + 0.62)) * 0.45, z] as P2),
      [-tail + 0.62, upperHalfW],
    ];
    const cw = plate(ctx, cwProfile, 1.05, 0, paint, 0.04);
    cw.rotation.x = -Math.PI / 2;
    cw.position.set(0, deckY + 0.2 + 0.525, 0);
    addTo(b, 'counterweight', [cw], [-tail + 0.4, deckY + 0.7, 0]);
    rearLights(b, -tail - 0.02, deckY + 0.75, upperHalfW * 0.7);

    // Gabinete delantero derecho (tanques de combustible e hidraulico, caja de herramientas).
    addTo(b, 'chassis_frame', [rbox(ctx, 1.4, 0.85, 0.85, 0.04, paint, [0.6, deckY + 0.62, -upperHalfW + 0.43])]);

    // Cabina a la izquierda adelante.
    ropsCab(b, { x0: -0.05, x1: 1.3, y0: deckY + 0.2, y1: deckY + 2.05, z0: upperHalfW - 1.0, z1: upperHalfW - 0.02, doorSide: 1 });

    // --- Equipo frontal: pluma, brazo, balde --------------------------------
    const lift = spec.shape?.boomLift ?? 0.5;
    const zBoom = -0.12;
    const foot: P2 = [0.95, deckY + 0.55];
    const knee: P2 = [3.25, deckY + 2.35 + (lift - 0.5) * 0.5];
    const tip: P2 = [5.3, deckY + 1.9 + (lift - 0.5) * 0.7];
    const boomW = 0.55;
    addTo(b, 'boom', [plate(ctx, beamProfile([foot, knee, tip], [0.5, 0.78, 0.42]), boomW, zBoom, paint, 0.035), cylZ(0.09, boomW + 0.2, kit.metal('steel'), [foot[0], foot[1], zBoom], 12)], [knee[0], knee[1], zBoom]);

    // Brazo: casi vertical, de la cola (sobre la punta de la pluma) al pin del balde.
    const bucketW = 1.15;
    const bk = groundedBucket(ctx, 5.75, 0.95, bucketW, -1, paint, 0.15);
    const bucketPin = bk.pin;
    const dx = bucketPin[0] - tip[0];
    const dy = bucketPin[1] - tip[1];
    const armLen = Math.hypot(dx, dy);
    const ux = dx / armLen;
    const uy = dy / armLen;
    const armTail: P2 = [tip[0] - ux * 0.75, tip[1] - uy * 0.75];
    const armW = 0.42;
    addTo(b, 'arm', [plate(ctx, beamProfile([armTail, tip, bucketPin], [0.42, 0.5, 0.28]), armW, zBoom, paint, 0.03), cylZ(0.08, boomW + 0.12, kit.metal('steel'), [tip[0], tip[1], zBoom], 12)], [tip[0], (tip[1] + bucketPin[1]) / 2, zBoom]);

    // Balde recogido (boca hacia la maquina) apoyado en el suelo.
    for (const o of bk.parts) o.position.z += zBoom;
    addTo(b, 'bucket', bk.parts, [bucketPin[0] - 0.3, 0.5, zBoom]);

    // Cilindros: dos de levante de pluma, uno de brazo sobre la pluma, uno de balde.
    const cyl: Object3D[] = [];
    const boomBelly: P2 = [foot[0] + (knee[0] - foot[0]) * 0.62, foot[1] + (knee[1] - foot[1]) * 0.62 - 0.3];
    for (const s of [1, -1]) cyl.push(...hydCylinder(ctx, [1.45, deckY + 0.3, zBoom + s * 0.36], [boomBelly[0], boomBelly[1], zBoom + s * 0.36], 0.1));
    const boomBack: P2 = [foot[0] + (knee[0] - foot[0]) * 0.55, foot[1] + (knee[1] - foot[1]) * 0.55 + 0.38];
    cyl.push(...hydCylinder(ctx, [boomBack[0], boomBack[1], zBoom], [armTail[0], armTail[1], zBoom], 0.1));
    const armMid: P2 = [tip[0] + ux * 0.25 + 0.3, tip[1] + uy * 0.25];
    const link: P2 = [bucketPin[0] + 0.3, bucketPin[1] + 0.32];
    cyl.push(...hydCylinder(ctx, [armMid[0], armMid[1], zBoom], [link[0], link[1], zBoom], 0.085));
    // Varillaje del balde.
    cyl.push(box(0.35, 0.08, 0.3, dark, [link[0] - 0.12, link[1] - 0.12, zBoom], -0.9));
    addTo(b, 'hydraulic_cylinders', cyl, [boomBelly[0], boomBelly[1], zBoom]);

    // Luz de trabajo en la pluma.
    addTo(b, 'headlight', [rbox(ctx, 0.12, 0.1, 0.14, 0.02, kit.plastic('black'), [2.2, deckY + 1.65, zBoom + 0.32]), box(0.012, 0.08, 0.1, kit.light('head'), [2.27, deckY + 1.65, zBoom + 0.32])]);

    return finishMachine(b);
  },
};
