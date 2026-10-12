/**
 * geofence.ts — Domain logic, Ray Casting Point-in-Polygon algorithm, and type definitions
 * for GARA-G DePIN PWA Geofencing sub-system.
 */

export type GeofencePoint = [number, number]; // [lat, lng]

export type GeofenceType =
  | 'workzone'
  | 'restricted'
  | 'depot'
  | 'custom'
  | 'port'
  | 'service'
  | 'client';

export type AlertFlags = {
  alertOnEnter: boolean;
  alertOnExit: boolean;
};

export interface Geofence {
  id: string;
  fleetId: string;
  name: string;
  type: GeofenceType;
  alertOnEnter: boolean;
  alertOnExit: boolean;
  vertices: GeofencePoint[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateGeofenceInput {
  id?: string;
  fleetId: string;
  name: string;
  type?: GeofenceType;
  alertOnEnter?: boolean;
  alertOnExit?: boolean;
  vertices: GeofencePoint[];
}

/**
 * Point-in-Polygon algorithm using horizontal Ray Casting.
 * Determines if point [lat, lng] is inside a polygon defined by vertices [[lat, lng], ...].
 *
 * @param point - [lat, lng] coordinates
 * @param polygon - array of [lat, lng] vertex pairs
 * @returns boolean true if inside, false if outside
 */
export function pointInPolygon(point: GeofencePoint, polygon: GeofencePoint[]): boolean {
  if (!polygon || polygon.length < 3) return false;

  const [x, y] = point; // x = lat, y = lng
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    // Check if ray intersects edge (j, i)
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Helper to construct a validated Geofence entity.
 */
export function createGeofence(input: CreateGeofenceInput): Geofence {
  const now = Date.now();
  return {
    id: input.id || `geo_${now}_${Math.random().toString(36).substring(2, 7)}`,
    fleetId: input.fleetId,
    name: input.name,
    type: input.type || 'custom',
    alertOnEnter: input.alertOnEnter ?? true,
    alertOnExit: input.alertOnExit ?? true,
    vertices: input.vertices || [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Parse string coordinate representation "lat,lng lat,lng ..." to GeofencePoint[]
 */
export function parsePolygonString(str: string): GeofencePoint[] {
  if (!str || typeof str !== 'string') return [];
  return str
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const parts = pair.split(',');
      if (parts.length !== 2) return null;
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      return Number.isFinite(lat) && Number.isFinite(lng) ? ([lat, lng] as GeofencePoint) : null;
    })
    .filter((p): p is GeofencePoint => p !== null);
}

/**
 * Format GeofencePoint[] back to "lat,lng lat,lng ..." string
 */
export function formatPolygonString(points: GeofencePoint[]): string {
  if (!points || !Array.isArray(points)) return '';
  return points.map(([lat, lng]) => `${lat},${lng}`).join(' ');
}
