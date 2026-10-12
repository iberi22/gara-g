import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import * as domain from '../src/lib/domain.js';
import { GET, POST, PATCH, DELETE } from '../src/pages/api/fleet/[entity].ts';
import { computeDriverStatus } from '../src/lib/driver.js';
import { DEFAULT_INSTANCE_ID } from '../src/lib/domain.config.js';

vi.mock('../src/lib/domain.js', () => ({
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  getEntity: vi.fn(),
  updateEntity: vi.fn(),
  deleteEntity: vi.fn(),
  getMemoryAdapter: vi.fn(),
  setStorageAdapter: vi.fn(),
}));

const envMock = env as unknown as Record<string, unknown>;

function createMockContext(
  entity: string = 'driver',
  q = '',
  body?: unknown,
  method = 'GET',
  role: string | null = 'admin',
  sessionTenant = 'tenant-driver-sec',
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role !== null) {
    headers['cookie'] = 'session=valid-test-token';
  }

  const req = new Request(`https://gara-g.swal.network/api/fleet/${entity}${q}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const locals: Record<string, unknown> = {};
  if (sessionTenant) {
    locals.tenant = { instanceId: sessionTenant };
  }

  return {
    params: { entity },
    request: req,
    locals,
    url: new URL(`https://gara-g.swal.network/api/fleet/${entity}${q}`),
  } as any;
}

describe('Gestión de Conductores — Autenticación y Autorización (Fail Closed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.ENVIRONMENT = 'production';
    envMock.SESSION = {
      get: vi.fn().mockImplementation(async (key: string) => {
        if (key === 'token:valid-test-token') {
          return JSON.stringify({
            userId: 'usr_admin',
            email: 'admin@gara-g.network',
            role: 'admin',
            exp: Date.now() + 3600000,
          });
        }
        if (key === 'token:observer-token') {
          return JSON.stringify({
            userId: 'usr_observer',
            email: 'observer@gara-g.network',
            role: 'observer',
            exp: Date.now() + 3600000,
          });
        }
        if (key === 'token:operator-token') {
          return JSON.stringify({
            userId: 'usr_operator',
            email: 'operator@gara-g.network',
            role: 'operator',
            exp: Date.now() + 3600000,
          });
        }
        return null;
      }),
      delete: vi.fn(),
    } as any;
  });

  it('GET /api/fleet/driver sin token de sesión responde 401 Unauthorized', async () => {
    const ctx = createMockContext('driver', '', undefined, 'GET', null);
    const res = await GET(ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/autenticado/i);
  });

  it('POST /api/fleet/driver con rol observer responde 403 Forbidden', async () => {
    const ctx = createMockContext('driver', '', { name: 'Conductor Test' }, 'POST', 'observer');
    // Replace cookie token with observer-token
    ctx.request.headers.set('cookie', 'session=observer-token');
    const res = await POST(ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Acceso denegado|Rol observer no puede crear driver/i);
  });

  it('DELETE /api/fleet/driver con rol operator responde 403 Forbidden', async () => {
    const ctx = createMockContext('driver', '?id=drv-001', undefined, 'DELETE', 'operator');
    ctx.request.headers.set('cookie', 'session=operator-token');
    const res = await DELETE(ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Rol operator no puede borrar driver/i);
  });
});

describe('Gestión de Conductores — Aislamiento de Tenant', () => {
  const CANONICAL_TENANT = DEFAULT_INSTANCE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.ENVIRONMENT = 'production';
    envMock.SESSION = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          userId: 'usr_admin',
          email: 'admin@gara-g.network',
          role: 'admin',
          exp: Date.now() + 3600000,
        })
      ),
    } as any;
    
    // Setup default mocks for domain functions
    (domain.listEntities as any).mockResolvedValue([]);
    (domain.createEntity as any).mockImplementation(async (entity, data, instanceId) => ({
      id: `${entity}-mock-id`,
      ...data,
    }));
  });

  it('GET /api/fleet/driver utiliza el tenant de la sesión y no el tenant demo', async () => {
    // Ensure listEntities returns empty to pass ensureSeedData check
    (domain.listEntities as any).mockImplementation(async (entity, instanceId) => {
      if (entity === 'driver') return []; // No existing drivers
      return []; // No existing entities
    });

    const ctx = createMockContext('driver', '?instanceId=tenant-spoofed', undefined, 'GET', 'admin', CANONICAL_TENANT);
    const res = await GET(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Verify that listEntities was called with the canonical tenant, not the spoofed one
    expect(domain.listEntities).toHaveBeenCalledWith('driver', CANONICAL_TENANT);
    expect(domain.listEntities).not.toHaveBeenCalledWith('driver', 'tenant-spoofed');
  });

  it('POST /api/fleet/driver crea el conductor exclusivamente en el tenant de la sesión', async () => {
    const driverPayload = {
      name: 'Jorge Ramirez',
      cedula: '80123456',
      licenseCategory: 'C2',
      licenseExpiry: '2028-06-30',
      phone: '+573100000000',
      status: 'active',
      fleetId: 'fleet-bogota',
      vehicleId: 'veh-505',
    };

    (domain.createEntity as any).mockResolvedValue({ id: 'drv-101', ...driverPayload });

    const ctx = createMockContext('driver', '', driverPayload, 'POST', 'admin', 'tenant-acero');
    await POST(ctx);

    expect(domain.createEntity).toHaveBeenCalledWith('driver', driverPayload, 'tenant-acero');
    expect(domain.createEntity).not.toHaveBeenCalledWith('driver', driverPayload, 'demo-flota');
  });
});

describe('Gestión de Conductores — Validaciones de Entrada e Invariantes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.ENVIRONMENT = 'production';
    envMock.SESSION = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          userId: 'usr_admin',
          role: 'admin',
          exp: Date.now() + 3600000,
        })
      ),
    } as any;
  });

  it('Rechaza entidad inválida que no pertenezca al esquema con 400 Bad Request', async () => {
    const ctx = createMockContext('invalid-entity-type', '', undefined, 'GET');
    const res = await GET(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid entity/i);
  });

  it('PATCH /api/fleet/driver sin id parámetro devuelve 400 Bad Request', async () => {
    const ctx = createMockContext('driver', '', { name: 'Sin ID' }, 'PATCH');
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Missing id/i);
  });

  it('DELETE /api/fleet/driver sin id parámetro devuelve 400 Bad Request', async () => {
    const ctx = createMockContext('driver', '', undefined, 'DELETE');
    const res = await DELETE(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Missing id/i);
  });
});

describe('Gestión de Conductores — Lógica del Dominio y PII (computeDriverStatus)', () => {
  it('Marca status como expired cuando la fecha de vencimiento de licencia transcurrió', () => {
    const driver = {
      name: 'Carlos Ruiz',
      status: 'active',
      licenseExpiry: '2020-05-15',
    };
    expect(computeDriverStatus(driver)).toBe('expired');
  });

  it('Mantiene el status active o personalizado si la licencia se encuentra vigente', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);
    const expiryStr = futureDate.toISOString().split('T')[0];

    const activeDriver = { name: 'Lucia Gomez', status: 'active', licenseExpiry: expiryStr };
    expect(computeDriverStatus(activeDriver)).toBe('active');

    const leaveDriver = { name: 'Marta Diaz', status: 'on_leave', licenseExpiry: expiryStr };
    expect(computeDriverStatus(leaveDriver)).toBe('on_leave');
  });

  it('Maneja datos incompletos o malformados de fecha sin arrojar excepciones de runtime', () => {
    expect(computeDriverStatus({ status: 'suspended', licenseExpiry: 'fecha-invalida' })).toBe('suspended');
    expect(computeDriverStatus({ status: 'active' })).toBe('active');
    expect(computeDriverStatus({})).toBe('active');
  });
});
