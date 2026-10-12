/**
 * chassis.ts — Chasis tubular y amortiguador: la parte "invisible" que hace que una moto
 * se sostenga. Sin ella las ruedas flotan y el modelo se ve como un collage de piezas.
 *
 * Todo se deriva del esqueleto (skeleton.ts), o sea de medidas reales: cada tubo arranca
 * en un punto de union real y termina en otro punto de union real. Nunca hay un extremo
 * al aire.
 *
 * Tres tipos segun el arquetipo:
 *   perimeter — marco cuadrado que rodea motor y basculante (deportiva)
 *   cradle    — doble cradle con largueros que bajan de la direccion (naked / trail)
 *   step      — piso plano con columna (scooter)
 */
import type { TemplateContext } from '../../contracts';
import { roundedBox, tube, type P3 } from '../common/geometry';
import { add, type Buckets } from './motoKit';
import type { MotoSkeleton } from './skeleton';

export interface FrameOpts {
  sk: MotoSkeleton;
  ctx: TemplateContext;
  kind: 'perimeter' | 'cradle' | 'step';
  /** Y del larguero superior (la "espina"). */
  topY: number;
  /** Y de la parte baja del bloque del motor. */
  engineLowY: number;
  /** Centro del motor en X. */
  engineX: number;
  /** Semiancho de los largueros. */
  halfZ?: number;
  /** Radio del tubo del chasis. */
  tubeR?: number;
  /** Pivote del basculante [x, y]; el cradle lo usa para cerrar abajo. */
  pivot?: P2Like;
}
type P2Like = [number, number];

/** Chasis completo como cubo de materiales. */
export function frameGeometry(o: FrameOpts): Buckets {
  const { sk } = o;
  const out: Buckets = {};
  const r = o.tubeR ?? 0.019;
  const z = o.halfZ ?? 0.115;
  const t = (p: P2Like, zz: number): P3 => [p[0], p[1], zz];

  // Nodos reales: direccion, union con la horquilla, bloque del motor, pivote, cola.
  const head: P2Like = [sk.steerBase[0], sk.steerBase[1]];
  const headTop: P2Like = [sk.axisAt(o.topY)[0], o.topY];
  const neck: P2Like = [sk.forkAt(o.engineLowY + 0.2)[0], o.engineLowY + 0.2];
  const engineFront: P2Like = [o.engineX + 0.16, o.engineLowY + 0.06];
  const engineRear: P2Like = [o.engineX - 0.16, o.engineLowY + 0.04];
  const pivot: P2Like = o.pivot ?? [sk.axleR[0] + 0.24, o.engineLowY - 0.04];
  const tail: P2Like = [sk.axleR[0] + 0.12, o.engineLowY + 0.06];

  if (o.kind === 'perimeter') {
    // Marco cuadrado: sube de la direccion, rodea el motor por los dos lados y cierra
    // atras en la union del basculante. Es lo que hace reconocible una moto sport.
    add(
      out,
      'dark',
      tube(
        [
          t(headTop, z),
          t(headTop, -z),
          t(engineFront, -z),
          t(engineRear, -z),
          t(pivot, -z * 0.86),
          t(engineRear, z),
          t(engineFront, z),
          t(headTop, z),
        ],
        r * 1.2,
        { segments: 96, radial: 9, closed: true },
      ),
    );
    // Links: diagonales de la direccion al frente del motor. Dan rigidez y lectura.
    for (const s of [1, -1]) {
      add(out, 'dark', tube([t(head, 0), t(engineFront, s * z * 0.85)], r, { segments: 18, radial: 8 }));
    }
    // Travesanos.
    add(out, 'alu', tube([t(engineFront, z * 0.85), t(engineFront, -z * 0.85)], r * 0.7, { segments: 12, radial: 8 }));
    add(out, 'alu', tube([t(tail, z * 0.8), t(tail, -z * 0.8)], r * 0.7, { segments: 12, radial: 8 }));
  } else if (o.kind === 'cradle') {
    // Doble cradle: dos largueros que bajan de la direccion y envuelven el motor.
    for (const s of [1, -1]) {
      add(
        out,
        'dark',
        tube(
          [
            t(head, s * z * 0.55),
            t(neck, s * z),
            t(engineFront, s * z * 0.9),
            t(engineRear, s * z * 0.9),
            t(pivot, s * z * 0.7),
          ],
          r,
          { segments: 72, radial: 9 },
        ),
      );
      // Cruzados que cierran el cradle por delante y por detras.
      add(out, 'dark', tube([t(engineFront, s * z * 0.9), t(engineRear, -s * z * 0.9)], r * 0.72, { segments: 18, radial: 7 }));
    }
    // Espina dorsal sobre el motor, de la direccion a la cola.
    add(
      out,
      'dark',
      tube([t([headTop[0] - 0.03, o.topY + 0.02], 0), t([o.engineX, o.topY], 0), t([o.engineX - 0.06, o.topY - 0.05], 0), t(tail, 0)], r * 0.9, {
        segments: 40,
        radial: 8,
      }),
    );
    // Subchasis: placa plana que une motor y basculante.
    const sub = roundedBox(0.3, 0.024, z * 1.35, 0.01, 1);
    sub.translate(pivot[0] + 0.06, o.engineLowY - 0.03, 0);
    add(out, 'alu', sub);
  } else {
    // Scooter: piso plano continuo + columna de direccion. Es lo que da la silueta.
    add(
      out,
      'dark',
      tube(
        [
          t([o.engineX + 0.44, o.engineLowY + 0.08], 0),
          t([o.engineX + 0.2, o.engineLowY + 0.06], 0),
          t([o.engineX - 0.3, o.engineLowY + 0.05], 0),
          t(pivot, 0),
        ],
        r * 1.4,
        { segments: 44, radial: 9 },
      ),
    );
    // Columna: sube de la direccion hasta el piso trasero.
    for (const s of [1, -1]) {
      add(out, 'dark', tube([t(headTop, s * 0.05), t([o.engineX + 0.32, o.engineLowY + 0.12], s * 0.05)], r * 0.95, { segments: 26, radial: 8 }));
    }
    // Nervio central del piso.
    add(out, 'dark', tube([t([o.engineX + 0.18, o.engineLowY + 0.1], 0), t([o.engineX - 0.38, o.engineLowY + 0.09], 0)], r * 0.9, { segments: 24, radial: 8 }));
    // Faldon bajo el piso (donde va el escape del scooter).
    const skirt = roundedBox(0.5, 0.05, z * 2, 0.018, 1);
    skirt.translate(o.engineX + 0.06, o.engineLowY + 0.01, 0);
    add(out, 'plastic', skirt);
  }

  void o.ctx;
  return out;
}

/**
 * Amortiguador trasero: vive en motoKit (swingarmGeometry lo usa); se reexporta aqui
 * porque el trail lo monta con su propio recorrido de suspension.
 */
export { shockGeometry } from './motoKit';