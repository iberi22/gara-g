/**
 * motion.ts — Detecta frenada brusca, choque, bache y vehiculo detenido a partir de los
 * sensores del telefono (DeviceMotion) y la velocidad GPS. Dominio puro: recibe muestras, no
 * toca el navegador.
 *
 * El telefono puede ir en cualquier posicion (bolsillo, soporte, portavasos), asi que no se
 * asume ningun eje del coche:
 *  - la gravedad se estima con un filtro paso bajo que SOLO se actualiza cuando la lectura
 *    esta cerca de 1 g (telefono casi en reposo respecto al coche). Si se actualizara siempre,
 *    una frenada larga acabaria "absorbida" como gravedad;
 *  - la aceleracion lineal es lectura - gravedad; su parte horizontal es la que no va a lo
 *    largo de la gravedad. Como no sabemos cual eje es "adelante", se usa su modulo.
 *
 * Frenada brusca: modulo horizontal > 0,45 g durante >= 300 ms, con direccion coherente (el
 * vector medio es >= 80% de la media de modulos: descarta vibracion y baches, que oscilan) y
 * CONFIRMADA por el GPS: la velocidad cae >= 2 m/s en los 3 s previos, con velocidad previa
 * >= 4 m/s. El GPS distingue frenar de tomar una curva fuerte, de un golpe al telefono o de
 * arrancar. Sin confirmacion en 2,5 s se descarta.
 *
 * Choque: pico > 3 g (aceleracion lineal total) con velocidad previa >= 8 m/s y velocidad GPS
 * <= 2 m/s en los 4 s siguientes. Un telefono que se cae no cambia la velocidad del coche.
 *
 * Bache: pico vertical (a lo largo de la gravedad) > 0,8 g con el coche en marcha (>= 4 m/s),
 * en menos de 200 ms y sin frenada en curso. Cooldown 5 s: un tramo malo es un solo aviso.
 *
 * Vehiculo detenido: velocidad < 0,5 m/s durante > 20 s mientras al menos un vecino va a
 * > 3 m/s a su alrededor ("estoy parado en una via por la que otros circulan"). Un coche
 * aparcado en una calle vacia no avisa de nada. Se vuelve a armar al volver a rodar (> 2 m/s).
 */
import { Events } from './packet';

export const G = 9.80665;

export const MOTION = {
  brakeG: 0.45,
  brakeSustainMs: 300,
  /** Tolerancia: una muestra por debajo del umbral no corta la racha si dura menos que esto. */
  brakeGapMs: 80,
  brakeCoherence: 0.8,
  brakeMinPrevSpeed: 4,
  brakeSpeedDrop: 2,
  brakeConfirmMs: 2_500,
  brakeSpeedWindowMs: 3_000,
  brakeCooldownMs: 5_000,
  crashG: 3,
  crashMinPrevSpeed: 8,
  crashStopSpeed: 2,
  crashConfirmMs: 4_000,
  crashCooldownMs: 30_000,
  potholeG: 0.8,
  potholeMaxMs: 200,
  potholeMinSpeed: 4,
  potholeCooldownMs: 5_000,
  /** Lectura "casi 1 g": solo entonces se refina la gravedad. */
  gravityGate: 0.6,
  gravityTauMs: 3_000,
  stoppedSpeed: 0.5,
  stoppedAfterMs: 20_000,
  stoppedRearmSpeed: 2,
  othersMovingSpeed: 3,
} as const;

export interface MotionSample {
  ts: number;
  /** m/s², incluyendo gravedad (accelerationIncludingGravity de DeviceMotion). */
  ax: number;
  ay: number;
  az: number;
}

export interface DetectedEvent {
  /** Una de Events.*. */
  event: number;
  ts: number;
}

export interface MotionDetector {
  pushMotion(s: MotionSample): void;
  /** Velocidad GPS en m/s en el instante ts. */
  pushSpeed(ts: number, speedMps: number): void;
  /** Llamar ~1 vez por segundo: `movingNeighbors` = vecinos que circulan por aqui. */
  tick(now: number, movingNeighbors: number): void;
}

export function createMotionDetector(onEvent: (e: DetectedEvent) => void): MotionDetector {
  let g: [number, number, number] | null = null;
  let lastTs = 0;

  // Frenada
  let runStart: number | null = null;
  let lastAbove = 0;
  let sumE: [number, number, number] = [0, 0, 0];
  let sumMag = 0;
  let brakePending: number | null = null;
  let lastBrake = -Infinity;

  // Choque
  let crashPending: { t: number; prevSpeed: number } | null = null;
  let lastCrash = -Infinity;

  // Bache
  let potStart: number | null = null;
  let lastPothole = -Infinity;

  // Velocidad
  const speeds: { ts: number; v: number }[] = [];

  // Detenido
  let stillSince: number | null = null;
  let stoppedSent = false;
  let lastSpeed = 0;

  const maxSpeedSince = (t: number) => speeds.reduce((m, s) => (s.ts >= t ? Math.max(m, s.v) : m), 0);

  function emit(event: number, ts: number) {
    onEvent({ event, ts });
  }

  function checkBrake(now: number) {
    if (brakePending === null) return;
    if (now - brakePending > MOTION.brakeConfirmMs) {
      brakePending = null;
      return;
    }
    const t0 = brakePending;
    const after = speeds.filter((s) => s.ts >= t0);
    if (after.length === 0) return;
    const prev = maxSpeedSince(t0 - MOTION.brakeSpeedWindowMs);
    const latest = after[after.length - 1].v;
    if (prev >= MOTION.brakeMinPrevSpeed && prev - latest >= MOTION.brakeSpeedDrop) {
      brakePending = null;
      lastBrake = now;
      emit(Events.HARD_BRAKE, now);
    }
  }

  function checkCrash(now: number) {
    if (!crashPending) return;
    if (now - crashPending.t > MOTION.crashConfirmMs) {
      crashPending = null;
      return;
    }
    const after = speeds.filter((s) => s.ts >= crashPending!.t - 500);
    if (after.length === 0) return;
    if (after[after.length - 1].v <= MOTION.crashStopSpeed) {
      crashPending = null;
      lastCrash = now;
      emit(Events.CRASH, now);
    }
  }

  return {
    pushMotion(s) {
      const raw: [number, number, number] = [s.ax, s.ay, s.az];
      const mag = Math.hypot(...raw);
      const dt = lastTs ? Math.max(1, s.ts - lastTs) : 0;
      lastTs = s.ts;
      if (!g) {
        g = [...raw];
        return;
      }
      // Gravedad: solo se refina con lecturas cercanas a 1 g.
      if (Math.abs(mag - G) < MOTION.gravityGate) {
        const k = dt / (MOTION.gravityTauMs + dt);
        g = [g[0] + (raw[0] - g[0]) * k, g[1] + (raw[1] - g[1]) * k, g[2] + (raw[2] - g[2]) * k];
      }
      const gm = Math.hypot(...g) || G;
      const gu: [number, number, number] = [g[0] / gm, g[1] / gm, g[2] / gm];
      const lin: [number, number, number] = [raw[0] - g[0], raw[1] - g[1], raw[2] - g[2]];
      const vert = lin[0] * gu[0] + lin[1] * gu[1] + lin[2] * gu[2];
      const hor: [number, number, number] = [lin[0] - vert * gu[0], lin[1] - vert * gu[1], lin[2] - vert * gu[2]];
      const horMag = Math.hypot(...hor);
      const linMag = Math.hypot(...lin);

      // --- Frenada brusca
      if (horMag > MOTION.brakeG * G) {
        if (runStart === null) {
          runStart = s.ts;
          sumE = [0, 0, 0];
          sumMag = 0;
        }
        lastAbove = s.ts;
        sumE = [sumE[0] + hor[0], sumE[1] + hor[1], sumE[2] + hor[2]];
        sumMag += horMag;
        if (
          s.ts - runStart >= MOTION.brakeSustainMs &&
          brakePending === null &&
          s.ts - lastBrake > MOTION.brakeCooldownMs &&
          Math.hypot(...sumE) >= MOTION.brakeCoherence * sumMag
        ) {
          brakePending = runStart;
          checkBrake(s.ts);
        }
      } else if (runStart !== null && s.ts - lastAbove > MOTION.brakeGapMs) {
        runStart = null;
      }
      if (brakePending !== null) checkBrake(s.ts);

      // --- Choque
      if (linMag > MOTION.crashG * G && !crashPending && s.ts - lastCrash > MOTION.crashCooldownMs) {
        const prev = maxSpeedSince(s.ts - MOTION.brakeSpeedWindowMs);
        if (prev >= MOTION.crashMinPrevSpeed) {
          crashPending = { t: s.ts, prevSpeed: prev };
          checkCrash(s.ts);
        }
      }
      if (crashPending) checkCrash(s.ts);

      // --- Bache (pico vertical corto, coche en marcha, sin frenada en curso)
      const moving = lastSpeed >= MOTION.potholeMinSpeed;
      if (Math.abs(vert) > MOTION.potholeG * G && moving && runStart === null && brakePending === null) {
        if (potStart === null) potStart = s.ts;
      } else if (potStart !== null) {
        if (s.ts - potStart <= MOTION.potholeMaxMs && s.ts - lastPothole > MOTION.potholeCooldownMs) {
          lastPothole = s.ts;
          emit(Events.POTHOLE, s.ts);
        }
        potStart = null;
      }
    },

    pushSpeed(ts, v) {
      lastSpeed = v;
      speeds.push({ ts, v });
      while (speeds.length > 0 && ts - speeds[0].ts > 8_000) speeds.shift();
      checkBrake(ts);
      checkCrash(ts);
      if (v >= MOTION.stoppedRearmSpeed) {
        stoppedSent = false;
        stillSince = null;
      } else if (v < MOTION.stoppedSpeed) {
        if (stillSince === null) stillSince = ts;
      } else {
        stillSince = null;
      }
    },

    tick(now, movingNeighbors) {
      if (stillSince !== null && !stoppedSent && movingNeighbors > 0 && now - stillSince > MOTION.stoppedAfterMs) {
        stoppedSent = true;
        emit(Events.STOPPED_VEHICLE, now);
      }
    },
  };
}
