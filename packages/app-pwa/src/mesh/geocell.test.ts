import { describe, expect, it } from 'vitest';
import { cellWithNeighbors, decodeGeohash, encodeGeohash } from './geocell';

describe('geocell', () => {
  it('codifica el punto de referencia del articulo de geohash', () => {
    // Ejemplo publico (Wikipedia, "Geohash"): 57.64911, 10.40744 -> u4pruydqqvj.
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('el punto cae dentro de la caja que devuelve decode', () => {
    const box = decodeGeohash(encodeGeohash(3.4516, -76.532, 6));
    expect(3.4516).toBeGreaterThanOrEqual(box.latLo);
    expect(3.4516).toBeLessThanOrEqual(box.latHi);
    expect(-76.532).toBeGreaterThanOrEqual(box.lonLo);
    expect(-76.532).toBeLessThanOrEqual(box.lonHi);
  });

  it('devuelve la celda y sus 8 vecinas distintas', () => {
    const cells = cellWithNeighbors(4.5981, -74.0758, 6);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toBe(encodeGeohash(4.5981, -74.0758, 6));
    expect(new Set(cells).size).toBe(9);
  });

  it('rechaza coordenadas fuera de rango', () => {
    expect(() => encodeGeohash(91, 0, 6)).toThrow(RangeError);
    expect(() => decodeGeohash('d2g6da')).toThrow(RangeError);
  });
});
