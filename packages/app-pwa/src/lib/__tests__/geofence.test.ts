import { describe, it, expect } from 'vitest';
import {
  pointInPolygon,
  createGeofence,
  parsePolygonString,
  formatPolygonString,
  type GeofencePoint,
} from '../geofence.js';

describe('Geofence Point-in-Polygon & Domain Logic', () => {
  // Simple square polygon around (0,0) to (10,10)
  const squarePolygon: GeofencePoint[] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ];

  it('correctly identifies points inside the polygon', () => {
    const insidePoint: GeofencePoint = [5, 5];
    expect(pointInPolygon(insidePoint, squarePolygon)).toBe(true);
  });

  it('correctly identifies points outside the polygon', () => {
    const outsidePoint: GeofencePoint = [15, 15];
    expect(pointInPolygon(outsidePoint, squarePolygon)).toBe(false);

    const outsideNegative: GeofencePoint = [-5, -5];
    expect(pointInPolygon(outsideNegative, squarePolygon)).toBe(false);
  });

  it('handles complex concave polygons correctly', () => {
    // L-shaped polygon
    const lPolygon: GeofencePoint[] = [
      [0, 0],
      [0, 10],
      [5, 10],
      [5, 5],
      [10, 5],
      [10, 0],
    ];

    expect(pointInPolygon([2, 8], lPolygon)).toBe(true); // inside top section
    expect(pointInPolygon([8, 2], lPolygon)).toBe(true); // inside bottom section
    expect(pointInPolygon([8, 8], lPolygon)).toBe(false); // outside in empty cutout of L
  });

  it('parses polygon string and formats polygon points bi-directionally', () => {
    const str = '4.735,-74.05 4.725,-74.05 4.725,-74.04';
    const parsed = parsePolygonString(str);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual([4.735, -74.05]);
    expect(parsed[1]).toEqual([4.725, -74.05]);
    expect(parsed[2]).toEqual([4.725, -74.04]);

    const formatted = formatPolygonString(parsed);
    expect(formatted).toBe(str);
  });

  it('creates geofence entity with default parameters and alert flags', () => {
    const gf = createGeofence({
      fleetId: 'fleet-101',
      name: 'Depot Central',
      type: 'depot',
      vertices: squarePolygon,
    });

    expect(gf.id).toMatch(/^geo_/);
    expect(gf.fleetId).toBe('fleet-101');
    expect(gf.name).toBe('Depot Central');
    expect(gf.type).toBe('depot');
    expect(gf.alertOnEnter).toBe(true);
    expect(gf.alertOnExit).toBe(true);
    expect(gf.vertices).toEqual(squarePolygon);
  });
});
