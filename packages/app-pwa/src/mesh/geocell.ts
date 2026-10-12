/**
 * geocell.ts — Celdas geohash para elegir sala en cada red.
 *
 * v2v usa precision 6 (~1,2 km x 0,6 km): basta para ver lo que viene en los proximos
 * segundos de via. Un vehiculo se une a su celda y a las 8 vecinas, porque en el borde de
 * una celda el carro de al lado puede estar en la otra.
 * datos usa precision 4 (~39 km x 20 km): una ciudad. Las ofertas de un taller sirven en
 * toda la ciudad y una sala grande revela menos de donde esta cada dueno.
 *
 * Geohash propio (sin dependencia): son 40 lineas y lo usan las dos redes.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const V2V_PRECISION = 6;
export const DATOS_PRECISION = 4;

export function encodeGeohash(lat: number, lon: number, precision: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new RangeError(`coordenada fuera de rango: ${lat},${lon}`);
  }
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonLo = mid;
      } else {
        ch <<= 1;
        lonHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch <<= 1;
        latHi = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export interface GeohashBox {
  latLo: number;
  latHi: number;
  lonLo: number;
  lonHi: number;
}

export function decodeGeohash(hash: string): GeohashBox {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new RangeError(`geohash invalido: ${hash}`);
    for (let b = 4; b >= 0; b--) {
      const on = (v >> b) & 1;
      if (even) {
        const mid = (lonLo + lonHi) / 2;
        if (on) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (on) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { latLo, latHi, lonLo, lonHi };
}

/** La celda y sus 8 vecinas (sin repetir; cerca de los polos o del antimeridiano pueden ser menos). */
export function cellWithNeighbors(lat: number, lon: number, precision: number): string[] {
  const center = encodeGeohash(lat, lon, precision);
  const box = decodeGeohash(center);
  const dLat = box.latHi - box.latLo;
  const dLon = box.lonHi - box.lonLo;
  const cLat = (box.latLo + box.latHi) / 2;
  const cLon = (box.lonLo + box.lonHi) / 2;
  const out = new Set<string>([center]);
  for (const i of [-1, 0, 1]) {
    for (const j of [-1, 0, 1]) {
      const la = cLat + i * dLat;
      let lo = cLon + j * dLon;
      if (la < -90 || la > 90) continue;
      if (lo < -180) lo += 360;
      if (lo > 180) lo -= 360;
      out.add(encodeGeohash(la, lo, precision));
    }
  }
  return [...out];
}
