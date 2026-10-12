import { describe, expect, it } from 'vitest';
import { Events } from './packet';
import { G, createMotionDetector, type DetectedEvent } from './motion';

const T0 = 1_800_000_000_000;

/** Telefono en una orientacion cualquiera: gravedad inclinada y un eje "adelante" perpendicular. */
function orientation() {
  const gv = [0.31, -0.83, 0.46];
  const gm = Math.hypot(...gv);
  const gu = gv.map((x) => x / gm);
  // Eje perpendicular a gu (producto vectorial con otro vector cualquiera) y el lateral.
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v: number[]) => v.map((x) => x / Math.hypot(...v));
  const fwd = norm(cross(gu, [1, 0, 0]));
  const side = norm(cross(gu, fwd));
  return { g: gu.map((x) => x * G), gu, fwd, side };
}

interface Trace {
  /** Aceleracion longitudinal (m/s²) en t segundos. */
  fwd?: (t: number) => number;
  side?: (t: number) => number;
  vert?: (t: number) => number;
  /** Velocidad GPS (m/s) en t. */
  speed: (t: number) => number;
  seconds: number;
  neighbors?: number;
}

function run(trace: Trace) {
  const events: DetectedEvent[] = [];
  const d = createMotionDetector((e) => events.push(e));
  const o = orientation();
  let nextGps = 0;
  let nextTick = 0;
  for (let ms = 0; ms <= trace.seconds * 1000; ms += 20) {
    const t = ms / 1000;
    const ts = T0 + ms;
    if (ms >= nextGps) {
      d.pushSpeed(ts, trace.speed(t));
      nextGps += 1000;
    }
    const f = trace.fwd?.(t) ?? 0;
    const s = trace.side?.(t) ?? 0;
    const v = trace.vert?.(t) ?? 0;
    // Ruido pequeno y determinista.
    const n = Math.sin(ms * 0.37) * 0.15;
    d.pushMotion({
      ts,
      ax: o.g[0] + f * o.fwd[0] + s * o.side[0] + v * o.gu[0] + n,
      ay: o.g[1] + f * o.fwd[1] + s * o.side[1] + v * o.gu[1] + n,
      az: o.g[2] + f * o.fwd[2] + s * o.side[2] + v * o.gu[2] + n,
    });
    if (ms >= nextTick) {
      d.tick(ts, trace.neighbors ?? 0);
      nextTick += 1000;
    }
  }
  return events;
}

const between = (t: number, a: number, b: number) => t >= a && t < b;

describe('frenada brusca', () => {
  it('0,6 g durante 1 s con caida de velocidad GPS: HARD_BRAKE una vez (cualquier orientacion)', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 6) ? -0.6 * G : 0),
      speed: (t) => (t < 5 ? 20 : Math.max(10, 20 - 10 * (t - 5))),
      seconds: 10,
    });
    expect(ev.map((e) => e.event)).toEqual([Events.HARD_BRAKE]);
  });

  it('frenar en la otra direccion del eje (telefono al reves) tambien se detecta', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 6) ? 0.6 * G : 0),
      speed: (t) => (t < 5 ? 20 : Math.max(10, 20 - 10 * (t - 5))),
      seconds: 10,
    });
    expect(ev).toHaveLength(1);
  });

  it('el mismo golpe sin que caiga la velocidad GPS (telefono golpeado) no cuenta', () => {
    const ev = run({ fwd: (t) => (between(t, 5, 6) ? -0.6 * G : 0), speed: () => 20, seconds: 10 });
    expect(ev).toEqual([]);
  });

  it('una frenada suave (0,3 g) no cuenta aunque la velocidad baje', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 9) ? -0.3 * G : 0),
      speed: (t) => Math.max(8, 20 - 3 * Math.max(0, t - 5)),
      seconds: 12,
    });
    expect(ev).toEqual([]);
  });

  it('un pico de 0,6 g de solo 150 ms no llega a los 300 ms sostenidos', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 5.15) ? -0.6 * G : 0),
      speed: (t) => (t < 5 ? 20 : 12),
      seconds: 10,
    });
    expect(ev).toEqual([]);
  });

  it('vibracion de carretera que oscila ±0,8 g a 10 Hz no es frenada (direccion incoherente)', () => {
    const ev = run({
      fwd: (t) => (between(t, 3, 8) ? 0.8 * G * Math.sin(2 * Math.PI * 10 * t) : 0),
      speed: (t) => (t < 5 ? 20 : 12),
      seconds: 10,
    });
    expect(ev.filter((e) => e.event === Events.HARD_BRAKE)).toEqual([]);
  });

  it('curva fuerte (0,5 g lateral) sin perder velocidad no es frenada', () => {
    const ev = run({ side: (t) => (between(t, 4, 7) ? 0.5 * G : 0), speed: () => 15, seconds: 10 });
    expect(ev).toEqual([]);
  });

  it('con el coche casi parado (< 4 m/s) no hay frenada brusca', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 6) ? -0.6 * G : 0),
      speed: (t) => (t < 5 ? 3 : 0),
      seconds: 10,
    });
    expect(ev).toEqual([]);
  });

  it('dos frenadas seguidas dentro del cooldown cuentan como una', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 5.6) || between(t, 7, 7.6) ? -0.7 * G : 0),
      speed: (t) => (t < 5 ? 25 : t < 7 ? 15 : 8),
      seconds: 12,
    });
    expect(ev.filter((e) => e.event === Events.HARD_BRAKE)).toHaveLength(1);
  });
});

describe('choque', () => {
  it('pico de 4 g y velocidad GPS 20 m/s -> 0: CRASH', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 5.08) ? -4 * G : 0),
      speed: (t) => (t < 5 ? 20 : 0),
      seconds: 12,
    });
    expect(ev.map((e) => e.event)).toContain(Events.CRASH);
  });

  it('pico de 4 g pero la velocidad no cae (se cayo el telefono): no hay CRASH', () => {
    const ev = run({ fwd: (t) => (between(t, 5, 5.08) ? 4 * G : 0), speed: () => 20, seconds: 12 });
    expect(ev.map((e) => e.event)).not.toContain(Events.CRASH);
  });

  it('pico de 4 g con el coche parado (telefono tirado): no hay CRASH', () => {
    const ev = run({ fwd: (t) => (between(t, 5, 5.08) ? 4 * G : 0), speed: () => 0, seconds: 12 });
    expect(ev).toEqual([]);
  });

  it('2,5 g (bache grande) con velocidad que cae: no es choque', () => {
    const ev = run({
      fwd: (t) => (between(t, 5, 5.08) ? 2.5 * G : 0),
      speed: (t) => (t < 5 ? 20 : 0),
      seconds: 12,
    });
    expect(ev.map((e) => e.event)).not.toContain(Events.CRASH);
  });
});

describe('bache', () => {
  it('pico vertical de 1 g corto con el coche en marcha: POTHOLE una vez', () => {
    const ev = run({ vert: (t) => (between(t, 5, 5.1) ? G : 0), speed: () => 12, seconds: 10 });
    expect(ev.map((e) => e.event)).toEqual([Events.POTHOLE]);
  });

  it('un tramo malo (varios picos en 2 s) es un solo aviso por el cooldown', () => {
    const ev = run({
      vert: (t) => (between(t % 0.6, 0, 0.1) && between(t, 4, 6) ? G : 0),
      speed: () => 12,
      seconds: 10,
    });
    expect(ev.filter((e) => e.event === Events.POTHOLE)).toHaveLength(1);
  });

  it('el mismo pico con el coche parado no es bache', () => {
    const ev = run({ vert: (t) => (between(t, 5, 5.1) ? G : 0), speed: () => 0, seconds: 10 });
    expect(ev).toEqual([]);
  });
});

describe('vehiculo detenido', () => {
  it('parado > 20 s con vecinos en marcha: STOPPED_VEHICLE una sola vez', () => {
    const ev = run({ speed: () => 0, seconds: 40, neighbors: 2 });
    expect(ev.map((e) => e.event)).toEqual([Events.STOPPED_VEHICLE]);
    expect(ev[0].ts - T0).toBeGreaterThan(20_000);
  });

  it('parado pero sin nadie circulando alrededor (calle vacia): no avisa', () => {
    expect(run({ speed: () => 0, seconds: 40, neighbors: 0 })).toEqual([]);
  });

  it('parado menos de 20 s no avisa', () => {
    expect(run({ speed: (t) => (t < 15 ? 0 : 8), seconds: 40, neighbors: 3 })).toEqual([]);
  });

  it('al volver a rodar y detenerse otra vez se vuelve a armar', () => {
    const ev = run({ speed: (t) => (t > 30 && t < 40 ? 8 : 0), seconds: 80, neighbors: 1 });
    expect(ev.filter((e) => e.event === Events.STOPPED_VEHICLE)).toHaveLength(2);
  });
});
