/**
 * packages/app-pwa/tests/fleet-maintenance.test.ts
 *
 * Cobertura de contratos para la página y endpoints de mantención de la flota (/api/fleet/maintenance).
 * Verifica:
 * - Autenticación Falla Cerrado (401 sin sesión/expirada)
 * - RBAC (permisos por rol: admin, operator, observer)
 * - Aislamiento de Tenant (no ver ni modificar datos de otro tenant)
 * - Validación de entrada y comportamiento del dominio de mantención (rangos de fecha invertidos, fechas inválidas, etc.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { GET, POST, PATCH, DELETE } from '../src/pages/api/fleet/[entity].js';
import * as domain from '../src/lib/domain.js';
import {
  parseISODate,
  toISODate,
  addMonthsISO,
  computeNextService,
  serviceState,
  filterByVehicle,
  sortByNextDate,
  groupByDay,
  SERVICE_INTERVAL_KM,
  SERVICE_INTERVAL_MONTHS,
  type MaintenanceFields,
} from '../src/lib/maintenance.js';

vi.mock('../src/lib/domain.js', () => ({
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  getEntity: vi.fn(),
  updateEntity: vi.fn(),
  deleteEntity: vi.fn(),
}));

vi.mock('../src/lib/fleetSeed.js', () => ({
  ensureSeedData: vi.fn().mockResolvedValue(undefined),
  DEMO_INSTANCE_ID: 'gara-g-default-instance',
}));

const envMock = env as unknown as Record<string, unknown>;

const mockKv = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const TENANT_A = 'flota-chile-01';
const TENANT_B = 'flota-peru-02';

function mkCtx(
  entity = 'maintenance',
  urlStr = 'https://gara-g.swal.network/api/fleet/maintenance',
  method = 'GET',
  body?: any,
  role = 'admin',
  instanceId = TENANT_A,
  token = 'token-valido-123'
) {
  const reqInit: RequestInit = {
    method,
    headers: {
      cookie: token ? `session=${token}` : '',
      'content-type': 'application/json',
    },
  };
  if (body) {
    reqInit.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const request = new Request(urlStr, reqInit);
  return {
    params: { entity },
    request,
    url: new URL(urlStr),
    locals: {
      tenant: { instanceId },
      user: { role, instanceId },
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.ENVIRONMENT = 'production';
  envMock.SESSION = mockKv;
  envMock.SWAL_KV = mockKv;

  // Sesión por defecto válida para token-valido-123
  mockKv.get.mockImplementation(async (key: string) => {
    if (key === 'token:token-valido-123') {
      return JSON.stringify({
        userId: 'usr_admin',
        email: 'admin@chile.cl',
        role: 'admin',
        instanceId: TENANT_A,
        exp: Date.now() + 60_000,
      });
    }
    if (key === 'token:token-operator-123') {
      return JSON.stringify({
        userId: 'usr_op',
        email: 'operador@chile.cl',
        role: 'operator',
        instanceId: TENANT_A,
        exp: Date.now() + 60_000,
      });
    }
    if (key === 'token:token-observer-123') {
      return JSON.stringify({
        userId: 'usr_obs',
        email: 'observador@chile.cl',
        role: 'observer',
        instanceId: TENANT_A,
        exp: Date.now() + 60_000,
      });
    }
    if (key === 'token:token-expirado') {
      return JSON.stringify({
        userId: 'usr_exp',
        email: 'expirado@chile.cl',
        role: 'admin',
        instanceId: TENANT_A,
        exp: Date.now() - 1000,
      });
    }
    return null;
  });

  (domain.listEntities as any).mockResolvedValue([]);
  (domain.createEntity as any).mockResolvedValue({ id: 'maint_001', vehicleId: 'vh_01', type: 'preventivo' });
  (domain.getEntity as any).mockResolvedValue({ id: 'maint_001', vehicleId: 'vh_01', type: 'preventivo' });
  (domain.updateEntity as any).mockResolvedValue({ id: 'maint_001', vehicleId: 'vh_01', type: 'preventivo' });
  (domain.deleteEntity as any).mockResolvedValue(true);
});

describe('1. Autenticación Falla Cerrado (Fail-Closed Auth)', () => {
  it('GET /api/fleet/maintenance sin cookie devuelve 401', async () => {
    const ctx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance', 'GET', undefined, 'admin', TENANT_A, '');
    const res = await GET(ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('No autenticado');
  });

  it('POST /api/fleet/maintenance con cookie inexistente en KV devuelve 401', async () => {
    const ctx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance', 'POST', { type: 'preventivo' }, 'admin', TENANT_A, 'token-inventado');
    const res = await POST(ctx);
    expect(res.status).toBe(401);
    expect(domain.createEntity).not.toHaveBeenCalled();
  });

  it('PATCH /api/fleet/maintenance con token expirado devuelve 401 y limpia la sesión', async () => {
    const ctx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance?id=maint_001', 'PATCH', { cost: 50000 }, 'admin', TENANT_A, 'token-expirado');
    const res = await PATCH(ctx);
    expect(res.status).toBe(401);
    expect(mockKv.delete).toHaveBeenCalledWith('token:token-expirado');
    expect(domain.updateEntity).not.toHaveBeenCalled();
  });

  it('DELETE /api/fleet/maintenance sin token devuelve 401', async () => {
    const ctx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance?id=maint_001', 'DELETE', undefined, 'admin', TENANT_A, '');
    const res = await DELETE(ctx);
    expect(res.status).toBe(401);
    expect(domain.deleteEntity).not.toHaveBeenCalled();
  });
});

describe('2. Control de Acceso Basado en Roles (RBAC)', () => {
  it('Rol observer: puede consultar GET pero se rechazan POST, PATCH y DELETE con 403', async () => {
    const getCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance', 'GET', undefined, 'observer', TENANT_A, 'token-observer-123');
    const getRes = await GET(getCtx);
    expect(getRes.status).toBe(200);

    const postCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance', 'POST', { type: 'correctivo' }, 'observer', TENANT_A, 'token-observer-123');
    const postRes = await POST(postCtx);
    expect(postRes.status).toBe(403);

    const patchCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance?id=maint_001', 'PATCH', { cost: 100 }, 'observer', TENANT_A, 'token-observer-123');
    const patchRes = await PATCH(patchCtx);
    expect(patchRes.status).toBe(403);

    const deleteCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance?id=maint_001', 'DELETE', undefined, 'observer', TENANT_A, 'token-observer-123');
    const deleteRes = await DELETE(deleteCtx);
    expect(deleteRes.status).toBe(403);
  });

  it('Rol operator: puede GET, POST y PATCH, pero DELETE es rechazado con 403', async () => {
    const postCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance', 'POST', { type: 'preventivo', vehicleId: 'vh_01' }, 'operator', TENANT_A, 'token-operator-123');
    const postRes = await POST(postCtx);
    expect(postRes.status).toBe(201);

    const patchCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance?id=maint_001', 'PATCH', { status: 'in_progress' }, 'operator', TENANT_A, 'token-operator-123');
    const patchRes = await PATCH(patchCtx);
    expect(patchRes.status).toBe(200);

    const deleteCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance?id=maint_001', 'DELETE', undefined, 'operator', TENANT_A, 'token-operator-123');
    const deleteRes = await DELETE(deleteCtx);
    expect(deleteRes.status).toBe(403);
  });

  it('Rol admin: puede ejecutar DELETE exitosamente (200)', async () => {
    const deleteCtx = mkCtx('maintenance', 'https://gara-g.swal.network/api/fleet/maintenance?id=maint_001', 'DELETE', undefined, 'admin', TENANT_A, 'token-valido-123');
    const deleteRes = await DELETE(deleteCtx);
    expect(deleteRes.status).toBe(200);
    expect(domain.deleteEntity).toHaveBeenCalledWith('maintenance', 'maint_001', TENANT_A);
  });
});

describe('3. Aislamiento de Tenant (Tenancy Isolation)', () => {
  it('Usuario NO-admin/observer no puede ver ni consultar mantención de otro tenant aunque mande query string ?instanceId=', async () => {
    const ctx = mkCtx(
      'maintenance',
      `https://gara-g.swal.network/api/fleet/maintenance?instanceId=${TENANT_B}`,
      'GET',
      undefined,
      'observer',
      TENANT_A,
      'token-observer-123'
    );
    const res = await GET(ctx);
    expect(res.status).toBe(200);
    expect(domain.listEntities).toHaveBeenCalledWith('maintenance', TENANT_A);
    expect(domain.listEntities).not.toHaveBeenCalledWith('maintenance', TENANT_B);
  });

  it('Usuario no puede crear mantención en tenant ajeno via headers x-instance-id', async () => {
    const ctx = mkCtx(
      'maintenance',
      'https://gara-g.swal.network/api/fleet/maintenance',
      'POST',
      { type: 'preventivo', vehicleId: 'vh_99' },
      'operator',
      TENANT_A,
      'token-operator-123'
    );
    ctx.request.headers.set('x-instance-id', TENANT_B);
    const res = await POST(ctx);
    expect(res.status).toBe(201);
    expect(domain.createEntity).toHaveBeenCalledWith('maintenance', expect.anything(), TENANT_A);
    expect(domain.createEntity).not.toHaveBeenCalledWith('maintenance', expect.anything(), TENANT_B);
  });

  it('Eliminación de mantención opera estrictamente sobre el tenant de la sesión', async () => {
    const ctx = mkCtx(
      'maintenance',
      `https://gara-g.swal.network/api/fleet/maintenance?id=maint_123&instanceId=${TENANT_B}`,
      'DELETE',
      undefined,
      'admin',
      TENANT_A,
      'token-valido-123'
    );
    const res = await DELETE(ctx);
    expect(res.status).toBe(200);
    expect(domain.deleteEntity).toHaveBeenCalledWith('maintenance', 'maint_123', TENANT_A);
    expect(domain.deleteEntity).not.toHaveBeenCalledWith('maintenance', 'maint_123', TENANT_B);
  });
});

describe('4. Contratos del Dominio de Mantenimiento y Validación de Rangos/Fechas', () => {
  it('Rango de fechas invertido (nextDate anterior a date o referencia) se maneja sin fallos y evalúa estado como vencido', () => {
    const recordInvertido: MaintenanceFields = {
      vehicleId: 'vh_01',
      type: 'preventivo',
      km: 50000,
      date: '2026-06-15',
      nextDate: '2026-01-01', // Invertido: próx. fecha anterior a la fecha de servicio
      cost: 150000,
      workshop: 'Taller Central',
      status: 'scheduled',
    };

    // Al tener nextDate ('2026-01-01') menor a la fecha de hoy ('2026-02-01'), debe catalogarse como 'vencido'
    const estado = serviceState(recordInvertido, '2026-02-01');
    expect(estado).toBe('vencido');
  });

  it('Registros completados o cancelados siempre retornan estado "completado" independientemente de fechas invertidas', () => {
    const recordCompletado: MaintenanceFields = {
      vehicleId: 'vh_01',
      type: 'aceite',
      km: 30000,
      date: '2026-05-01',
      nextDate: '2020-01-01',
      cost: 80000,
      workshop: 'Speedy Auto',
      status: 'completed',
    };
    expect(serviceState(recordCompletado, '2026-02-01')).toBe('completado');

    const recordCancelado: MaintenanceFields = {
      ...recordCompletado,
      status: 'cancelled',
    };
    expect(serviceState(recordCancelado, '2026-02-01')).toBe('completado');
  });

  it('Manejo seguro de fechas malformadas y nulas en parseISODate y computeNextService', () => {
    expect(parseISODate('invalido')).toBeNull();
    expect(parseISODate('2026-13-45')).toBeNull();
    expect(parseISODate('')).toBeNull();

    const recordInvalido: MaintenanceFields = {
      vehicleId: 'vh_02',
      type: 'inspeccion',
      km: 10000,
      date: 'fecha-no-iso',
      cost: 0,
      workshop: '',
      status: 'scheduled',
    };

    const next = computeNextService(recordInvalido);
    expect(next.nextKm).toBe(10000 + SERVICE_INTERVAL_KM);
    expect(next.nextDate).toBeNull(); // No se pudo derivar fecha por formato inválido
  });

  it('computeNextService deriva automáticamente +10,000 km y +6 meses cuando no se especifican', () => {
    const recordBase: MaintenanceFields = {
      vehicleId: 'vh_03',
      type: 'reparacion',
      km: 25000,
      date: '2026-01-15',
      cost: 200000,
      workshop: 'Taller Express',
      status: 'scheduled',
    };

    const derived = computeNextService(recordBase);
    expect(derived.nextKm).toBe(35000);
    expect(derived.nextDate).toBe('2026-07-15');
  });

  it('filterByVehicle filtra exactamente por vehículo y maneja "all"', () => {
    const records = [
      { id: '1', vehicleId: 'vh_A' },
      { id: '2', vehicleId: 'vh_B' },
      { id: '3', vehicleId: 'vh_A' },
    ];

    expect(filterByVehicle(records, 'vh_A')).toHaveLength(2);
    expect(filterByVehicle(records, 'vh_B')).toHaveLength(1);
    expect(filterByVehicle(records, 'all')).toHaveLength(3);
  });

  it('sortByNextDate ordena ascendentemente por próxima fecha y ubica registros sin fecha al final', () => {
    const records: MaintenanceFields[] = [
      { vehicleId: 'v1', type: 'a', km: 0, date: '2026-01-01', nextDate: '2026-12-01', cost: 0, workshop: '', status: 'ok' },
      { vehicleId: 'v2', type: 'b', km: 0, date: '2026-01-01', nextDate: '2026-05-01', cost: 0, workshop: '', status: 'ok' },
      { vehicleId: 'v3', type: 'c', km: 0, date: 'invalida', cost: 0, workshop: '', status: 'ok' },
    ];

    const sorted = sortByNextDate(records);
    expect(sorted[0].vehicleId).toBe('v2'); // '2026-05-01'
    expect(sorted[1].vehicleId).toBe('v1'); // '2026-12-01'
    expect(sorted[2].vehicleId).toBe('v3'); // sin próxima fecha válida ('zzzz')
  });

  it('groupByDay agrupa por YYYY-MM-DD y clasifica fechas no válidas bajo "sin-fecha"', () => {
    const records: MaintenanceFields[] = [
      { vehicleId: 'v1', type: 'preventivo', km: 10, date: '2026-03-10', cost: 0, workshop: '', status: 'ok' },
      { vehicleId: 'v2', type: 'correctivo', km: 20, date: '2026-03-10', cost: 0, workshop: '', status: 'ok' },
      { vehicleId: 'v3', type: 'llantas', km: 30, date: 'corrupto', cost: 0, workshop: '', status: 'ok' },
    ];

    const grouped = groupByDay(records);
    expect(grouped.get('2026-03-10')).toHaveLength(2);
    expect(grouped.get('sin-fecha')).toHaveLength(1);
  });
});
