/**
 * packages/app-pwa/tests/fleet-geofences.test.ts
 *
 * Cobertura de contratos de geocercas, algoritmo point-in-polygon,
 * serialización de polígonos, entidad de dominio geofence,
 * y seguridad/aislamiento en endpoints REST de geocercas (/api/fleet/geofence).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  pointInPolygon,
  createGeofence,
  parsePolygonString,
  formatPolygonString,
  type GeofencePoint,
} from '../src/lib/geofence.js';
import { GET, POST, PATCH, DELETE } from '../src/pages/api/fleet/[entity].ts';

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const envMock = env as unknown as Record<string, unknown>;

function createApiContext(
  entity: string,
  method = 'GET',
  urlParams = '',
  body: unknown = null,
  cookieToken?: string,
  localsTenant?: string,
) {
  const headers: Record<string, string> = {};
  if (cookieToken) {
    headers['cookie'] = `session=${cookieToken}`;
  }
  if (body && (method === 'POST' || method === 'PATCH')) {
    headers['content-type'] = 'application/json';
  }

  const fullUrl = `https://gara-g.swal.network/api/fleet/${entity}${urlParams}`;
  const requestInit: RequestInit = {
    method,
    headers,
  };
  if (body) {
    requestInit.body = JSON.stringify(body);
  }

  const req = new Request(fullUrl, requestInit);

  return {
    params: { entity },
    request: req,
    locals: localsTenant ? ({ tenant: { instanceId: localsTenant } } as any) : {},
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockKv.get.mockResolvedValue(null);
  mockKv.put.mockResolvedValue(undefined);
  envMock.SESSION = mockKv;
  envMock.SWAL_KV = mockKv;
  envMock.ENVIRONMENT = 'production';
});

// ---------------------------------------------------------------------------
// 1. Point-in-Polygon Engine Contract Tests
// ---------------------------------------------------------------------------
describe('Geofence Motor Geometrico: pointInPolygon', () => {
  const simpleTriangle: GeofencePoint[] = [
    [0, 0],
    [0, 10],
    [10, 0],
  ];

  const convexSquare: GeofencePoint[] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ];

  const concaveL: GeofencePoint[] = [
    [0, 0],
    [0, 10],
    [5, 10],
    [5, 5],
    [10, 5],
    [10, 0],
  ];

  it('devuelve false para polígonos degenerados con menos de 3 vértices', () => {
    expect(pointInPolygon([5, 5], [])).toBe(false);
    expect(pointInPolygon([5, 5], [[0, 0]])).toBe(false);
    expect(pointInPolygon([5, 5], [[0, 0], [10, 10]])).toBe(false);
  });

  it('determina correctamente puntos dentro y fuera de un triángulo simple', () => {
    expect(pointInPolygon([2, 2], simpleTriangle)).toBe(true);
    expect(pointInPolygon([8, 8], simpleTriangle)).toBe(false);
    expect(pointInPolygon([-1, 0], simpleTriangle)).toBe(false);
  });

  it('evalúa puntos con coordenadas negativas y flotantes', () => {
    const latLngBox: GeofencePoint[] = [
      [-33.45, -70.66],
      [-33.45, -70.60],
      [-33.40, -70.60],
      [-33.40, -70.66],
    ];

    expect(pointInPolygon([-33.42, -70.63], latLngBox)).toBe(true);
    expect(pointInPolygon([-33.39, -70.63], latLngBox)).toBe(false);
    expect(pointInPolygon([-33.42, -70.67], latLngBox)).toBe(false);
  });

  it('maneja polígonos cóncavos en forma de L discriminando el área recortada', () => {
    expect(pointInPolygon([2, 8], concaveL)).toBe(true);
    expect(pointInPolygon([8, 2], concaveL)).toBe(true);
    // El punto (8,8) está en el hueco recortado de la L
    expect(pointInPolygon([8, 8], concaveL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. String Parsing & Formatting Contract Tests
// ---------------------------------------------------------------------------
describe('Geofence Utility Contracts: parsePolygonString & formatPolygonString', () => {
  it('parsea cadenas válidas con múltiples coordenadas y espacios', () => {
    const raw = '4.735,-74.05  4.725,-74.05\n4.725,-74.04';
    const points = parsePolygonString(raw);
    expect(points).toEqual([
      [4.735, -74.05],
      [4.725, -74.05],
      [4.725, -74.04],
    ]);
  });

  it('filtra pares malformados o con valores no numéricos', () => {
    const raw = '4.735,-74.05 invalido,coord 100 4.725,-74.04';
    const points = parsePolygonString(raw);
    expect(points).toEqual([
      [4.735, -74.05],
      [4.725, -74.04],
    ]);
  });

  it('devuelve un array vacío ante entradas vacías o que no son string', () => {
    expect(parsePolygonString('')).toEqual([]);
    expect(parsePolygonString('   ')).toEqual([]);
    expect(parsePolygonString(null as any)).toEqual([]);
    expect(parsePolygonString(undefined as any)).toEqual([]);
  });

  it('formatea un array de puntos a su representación textual', () => {
    const points: GeofencePoint[] = [
      [10.5, -66.9],
      [10.6, -66.8],
    ];
    expect(formatPolygonString(points)).toBe('10.5,-66.9 10.6,-66.8');
  });

  it('formatea correctamente listas vacías o entradas inválidas', () => {
    expect(formatPolygonString([])).toBe('');
    expect(formatPolygonString(null as any)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. Entity Factory Contract Tests
// ---------------------------------------------------------------------------
describe('Geofence Entity Factory: createGeofence', () => {
  it('asigna ID por defecto con prefijo geo_ y valores por defecto', () => {
    const gf = createGeofence({
      fleetId: 'flota-bogota-01',
      name: 'Zona Industrial norte',
      vertices: [
        [4.7, -74.0],
        [4.8, -74.0],
        [4.8, -74.1],
      ],
    });

    expect(gf.id).toMatch(/^geo_\d+_[a-z0-9]+$/);
    expect(gf.fleetId).toBe('flota-bogota-01');
    expect(gf.name).toBe('Zona Industrial norte');
    expect(gf.type).toBe('custom');
    expect(gf.alertOnEnter).toBe(true);
    expect(gf.alertOnExit).toBe(true);
    expect(gf.vertices).toHaveLength(3);
  });

  it('respeta las opciones de tipo y banderas de alerta cuando son provistas', () => {
    const gf = createGeofence({
      id: 'custom_geo_id',
      fleetId: 'flota-medellin-02',
      name: 'Puerto Seco',
      type: 'depot',
      alertOnEnter: false,
      alertOnExit: true,
      vertices: [
        [6.2, -75.5],
        [6.3, -75.5],
        [6.3, -75.6],
      ],
    });

    expect(gf.id).toBe('custom_geo_id');
    expect(gf.type).toBe('depot');
    expect(gf.alertOnEnter).toBe(false);
    expect(gf.alertOnExit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. REST API Endpoint Security & RBAC Contract Tests (/api/fleet/geofence)
// ---------------------------------------------------------------------------
describe('REST Endpoint /api/fleet/geofence: Seguridad y Autenticacion', () => {
  it('rechaza con 401 GET a /api/fleet/geofence sin cookie de sesión', async () => {
    const ctx = createApiContext('geofence', 'GET');
    const res = await GET(ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('rechaza con 401 POST a /api/fleet/geofence con sesión inventada en prod', async () => {
    mockKv.get.mockResolvedValue(null); // token invalido en KV
    const ctx = createApiContext(
      'geofence',
      'POST',
      '',
      { name: 'Intruso', vertices: [] },
      'session_falsa',
    );
    const res = await POST(ctx);
    expect(res.status).toBe(401);
  });

  it('rechaza con 401 PATCH a /api/fleet/geofence sin sesión', async () => {
    const ctx = createApiContext('geofence', 'PATCH', '?id=geo_123', { name: 'Cambio' });
    const res = await PATCH(ctx);
    expect(res.status).toBe(401);
  });

  it('rechaza con 401 DELETE a /api/fleet/geofence sin sesión', async () => {
    const ctx = createApiContext('geofence', 'DELETE', '?id=geo_123');
    const res = await DELETE(ctx);
    expect(res.status).toBe(401);
  });
});

describe('REST Endpoint /api/fleet/geofence: RBAC y Aislamiento de Tenant', () => {
  const sessionObserver = JSON.stringify({
    userId: 'usr_obs',
    email: 'obs@empresa.com',
    role: 'observer',
    instanceId: 'flota-real-01',
    exp: Date.now() + 60_000,
  });

  const sessionAdmin = JSON.stringify({
    userId: 'usr_admin',
    email: 'admin@empresa.com',
    role: 'admin',
    instanceId: 'flota-real-01',
    exp: Date.now() + 60_000,
  });

  it('permite a un rol observer consultar GET /api/fleet/geofence', async () => {
    mockKv.get.mockResolvedValue(sessionObserver);
    const ctx = createApiContext('geofence', 'GET', '', null, 'token_observer', 'flota-real-01');
    const res = await GET(ctx);
    expect(res.status).toBe(200);
  });

  it('bloquea con 403 a un rol observer al intentar POST /api/fleet/geofence', async () => {
    mockKv.get.mockResolvedValue(sessionObserver);
    const ctx = createApiContext(
      'geofence',
      'POST',
      '',
      { name: 'Nueva Geocerca', fleetId: 'flota-real-01' },
      'token_observer',
      'flota-real-01',
    );
    const res = await POST(ctx);
    expect(res.status).toBe(403);
  });

  it('bloquea con 403 a un rol observer al intentar DELETE /api/fleet/geofence', async () => {
    mockKv.get.mockResolvedValue(sessionObserver);
    const ctx = createApiContext(
      'geofence',
      'DELETE',
      '?id=geo_100',
      null,
      'token_observer',
      'flota-real-01',
    );
    const res = await DELETE(ctx);
    expect(res.status).toBe(403);
  });

  it('permite a un rol admin consultar y crear geocercas bajo su propio tenant', async () => {
    mockKv.get.mockResolvedValue(sessionAdmin);
    const ctxList = createApiContext('geofence', 'GET', '', null, 'token_admin', 'flota-real-01');
    const resList = await GET(ctxList);
    expect(resList.status).toBe(200);

    const ctxCreate = createApiContext(
      'geofence',
      'POST',
      '',
      {
        name: 'Zona Deposito',
        fleetId: 'flota-real-01',
        type: 'depot',
        polygon: '4.7,-74.0 4.8,-74.0 4.8,-74.1',
      },
      'token_admin',
      'flota-real-01',
    );
    const resCreate = await POST(ctxCreate);
    expect(resCreate.status).toBe(201);
  });
});
