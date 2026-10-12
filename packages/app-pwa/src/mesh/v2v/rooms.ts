/**
 * rooms.ts — En que salas V2V esta el vehiculo: su celda geohash y las 8 vecinas.
 *
 * Se une a las 9 para escuchar (en el borde de una celda el coche de al lado esta en otra) y
 * publica solo en la celda central; quien escucha desde una vecina la oye porque tambien
 * esta unido a la nuestra.
 *
 * Histeresis: justo en el borde de una celda el GPS salta de un lado a otro y, sin
 * proteccion, el vehiculo se uniria y saldria de salas cada segundo (rafagas de join/leave y
 * huecos en la escucha). Solo se cambia de celda central cuando la posicion esta al menos
 * `hysteresisM` metros DENTRO de la celda nueva. Mientras tanto seguimos en la vieja, que
 * sigue cubriendo la zona porque las salas vecinas siguen unidas.
 */
import type { MeshPort } from '../contracts';
import { cellWithNeighbors, decodeGeohash, encodeGeohash, V2V_PRECISION } from '../geocell';

const M_PER_DEG = 111_320;
export const DEFAULT_HYSTERESIS_M = 80;

export interface RoomUpdate {
  center: string;
  cells: string[];
  joined: string[];
  left: string[];
  changed: boolean;
}

export interface RoomManager {
  /** Celda central actual (null antes del primer fix). */
  readonly center: string | null;
  readonly cells: readonly string[];
  update(lat: number, lon: number): Promise<RoomUpdate>;
  leaveAll(): Promise<void>;
}

/** Metros que `lat,lon` queda dentro de la caja (negativo si esta fuera). */
function insetMeters(lat: number, lon: number, hash: string): number {
  const b = decodeGeohash(hash);
  const kLon = Math.cos((lat * Math.PI) / 180) * M_PER_DEG;
  const dN = Math.min(lat - b.latLo, b.latHi - lat) * M_PER_DEG;
  const dE = Math.min(lon - b.lonLo, b.lonHi - lon) * kLon;
  return Math.min(dN, dE);
}

export function createRoomManager(
  port: MeshPort,
  opts: { precision?: number; hysteresisM?: number } = {},
): RoomManager {
  const precision = opts.precision ?? V2V_PRECISION;
  const hysteresisM = opts.hysteresisM ?? DEFAULT_HYSTERESIS_M;
  let center: string | null = null;
  let cells: string[] = [];

  return {
    get center() {
      return center;
    },
    get cells() {
      return cells;
    },
    async update(lat, lon) {
      const target = encodeGeohash(lat, lon, precision);
      if (center !== null && target !== center && insetMeters(lat, lon, target) < hysteresisM) {
        return { center, cells, joined: [], left: [], changed: false };
      }
      if (target === center) return { center, cells, joined: [], left: [], changed: false };
      const next = cellWithNeighbors(lat, lon, precision);
      const prev = new Set(cells);
      const nextSet = new Set(next);
      const joined = next.filter((c) => !prev.has(c));
      const left = cells.filter((c) => !nextSet.has(c));
      for (const c of joined) await port.join('v2v', c);
      for (const c of left) await port.leave('v2v', c);
      center = target;
      cells = next;
      return { center, cells, joined, left, changed: true };
    },
    async leaveAll() {
      for (const c of cells) await port.leave('v2v', c);
      cells = [];
      center = null;
    },
  };
}
