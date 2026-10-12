/**
 * demo.ts — Trafico simulado para ver el radar sin salir a la calle (`/fleet/radar?demo=1`).
 *
 * Solo se usa sobre el hub en memoria (cuando no hay red real) o en pruebas: simula un GPS
 * propio que avanza al norte a 15 m/s y tres vecinos que emiten balizas con el protocolo
 * real, mas un peligro firmado (bache). Sirve para verificar la UI y como demostracion.
 * Un ciclo dura 26 s y se repite.
 */
import { cellWithNeighbors, encodeGeohash, V2V_PRECISION } from '../geocell';
import type { MeshPort } from '../contracts';
import { BEACON_TOPIC, BEACON_TTL_MS, Events, HAZARD_TOPIC, HAZARD_TTL_MS, encodePacketB64, type V2VPacket } from './packet';
import type { GeoSource } from './v2vNode';

export const DEMO_ORIGIN = { lat: 4.711, lon: -74.0721 };
const M_PER_DEG = 111_320;
const CYCLE_S = 26;
const OWN_SPEED = 15;

interface SimCar {
  id: number;
  /** Posicion norte/este (m) al empezar el ciclo, y velocidad (m/s) y rumbo. */
  n0: number;
  e0: number;
  speed: number;
  heading: number;
}

const CARS: SimCar[] = [
  { id: 0x0a000001, n0: 60, e0: 0, speed: 10, heading: 0 }, // delante, mas lento: alcance suave
  { id: 0x0a000002, n0: 420, e0: 0, speed: 15, heading: 180 }, // de frente por el mismo carril: peligro
  { id: 0x0a000003, n0: 10, e0: 30, speed: 15, heading: 0 }, // en paralelo, sin riesgo
];

export function createDemoWorld(createPort: (id: string) => MeshPort, now: () => number = () => Date.now()) {
  const start = now();
  const t0 = () => ((now() - start) / 1000) % CYCLE_S;
  const posOf = (n: number, e: number) => ({
    lat: DEMO_ORIGIN.lat + n / M_PER_DEG,
    lon: DEMO_ORIGIN.lon + e / (M_PER_DEG * Math.cos((DEMO_ORIGIN.lat * Math.PI) / 180)),
  });

  const geo: GeoSource = {
    watch(onFix) {
      const timer = setInterval(() => {
        const p = posOf(OWN_SPEED * t0(), 0);
        onFix({ ...p, accuracyM: 4, speedMps: OWN_SPEED, headingDeg: 0 });
      }, 1000);
      const p = posOf(0, 0);
      queueMicrotask(() => onFix({ ...p, accuracyM: 4, speedMps: OWN_SPEED, headingDeg: 0 }));
      return () => clearInterval(timer);
    },
  };

  const ports = CARS.map((c) => createPort(`demo-${c.id.toString(16)}`));
  const hazardPort = createPort('demo-hazard');
  const joinAll = (port: MeshPort) => {
    for (const cell of cellWithNeighbors(DEMO_ORIGIN.lat, DEMO_ORIGIN.lon, V2V_PRECISION)) void port.join('v2v', cell);
  };
  [...ports, hazardPort].forEach(joinAll);

  const emit = (port: MeshPort, p: V2VPacket, topic: string, opts: { sign?: boolean; ttlMs: number }) => {
    const room = encodeGeohash(p.latE6 / 1e6, p.lonE6 / 1e6, V2V_PRECISION);
    void port.publish('v2v', room, topic, encodePacketB64(p, now()), opts).catch(() => {});
  };

  let lastCycle = -1;
  const timer = setInterval(() => {
    const t = t0();
    CARS.forEach((c, i) => {
      const rad = (c.heading * Math.PI) / 180;
      const p = posOf(c.n0 + c.speed * t * Math.cos(rad), c.e0 + c.speed * t * Math.sin(rad));
      emit(ports[i], {
        kind: 'beacon', id: c.id, ts: now(), latE6: Math.round(p.lat * 1e6), lonE6: Math.round(p.lon * 1e6),
        speedCms: c.speed * 100, heading: c.heading, accuracyM: 4, vehicleClass: i === 2 ? 'moto' : 'carro', events: 0,
      }, BEACON_TOPIC, { ttlMs: BEACON_TTL_MS });
    });
    const cycle = Math.floor((now() - start) / 1000 / CYCLE_S);
    if (cycle !== lastCycle) {
      lastCycle = cycle;
      const p = posOf(220, 0);
      emit(hazardPort, {
        kind: 'hazard', id: 0x0a0000ff, ts: now(), latE6: Math.round(p.lat * 1e6), lonE6: Math.round(p.lon * 1e6),
        speedCms: 0, heading: 0, accuracyM: 4, vehicleClass: 'carro', events: Events.POTHOLE,
      }, HAZARD_TOPIC, { sign: true, ttlMs: HAZARD_TTL_MS });
    }
  }, 1000);

  return {
    geo,
    stop() {
      clearInterval(timer);
      for (const p of [...ports, hazardPort]) void p.close();
    },
  };
}
