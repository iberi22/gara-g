/**
 * domain/api.test.ts — Las dos rutas de lectura del garage: sesion, tenant y 404.
 *
 * Estos casos EJECUTAN el handler (igual que tests/fleet-stats-tenancy.test.ts) contra el
 * `listEntities` real de src/lib/domain.ts con su MemoryAdapter, y comprueban la llamada, no
 * el texto del fuente: un tenant no puede ver vehiculos de otro aunque conozca el id.
 *
 * El fallo que cubren: si una ruta leyera del tenant por defecto o aceptara `?instanceId=`
 * de la request, cualquier usuario autenticado veria el garage de otro cliente.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntity, getMemoryAdapter, listEntities, setStorageAdapter } from '../../lib/domain';
import { ensureSeeded } from '../../lib/fleetApi';
import { GET as GET_VEHICLE } from '../../pages/api/garage/vehicle/[id]';
import { GET as GET_VEHICLES } from '../../pages/api/garage/vehicles';

const envMock = env as unknown as Record<string, unknown>;

const TENANT_A = 'tenant-garage-a';
const TENANT_B = 'tenant-garage-b';
const VIN_A = '1HGCM82633A004352';
const VIN_B = '1HGCM82633A004353';

/** Ids reales que devuelve `createEntity` (los genera el helper, no los elegimos). */
let idA = '';
let idB = '';

/** Sesion de KV que devuelve getAuthUser: token 't' = admin del tenant indicado. */
function mockSession(role = 'admin', instanceId = TENANT_A) {
  envMock.ENVIRONMENT = 'production';
  envMock.SESSION = {
    get: vi.fn(async (k: string) =>
      k === 'token:t'
        ? JSON.stringify({
            userId: 'u1',
            email: 'a@b.c',
            role,
            instanceId,
            exp: Date.now() + 3_600_000,
          })
        : null,
    ),
  };
}

function ctx(url: string, tenant?: string, params: Record<string, string> = {}) {
  const headers: Record<string, string> = { cookie: 'session=t' };
  return {
    request: new Request(url, { headers }),
    locals: tenant ? { tenant: { instanceId: tenant } } : {},
    params,
  } as never;
}

/** Lectura tipada del JSON: los asserts sobre `unknown` no compilan con strict. */
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** `body.vehicles` ya tipado, para los asserts sobre la lista. */
async function vehicles(res: Response): Promise<{ id: string; [k: string]: unknown }[]> {
  const parsed = await json(res);
  return (parsed.vehicles ?? []) as { id: string }[];
}

async function seed(
  tenant: string,
  vin: string,
  name: string,
  extra: Record<string, unknown> = {},
) {
  return createEntity(
    'vehicle',
    {
      plate: 'ABC-123',
      vin,
      make: 'Yamaha',
      model: 'FZ16',
      year: 2021,
      status: 'active',
      mileage: 10_000,
      name,
      ...extra,
    },
    tenant,
  );
}

beforeEach(async () => {
  getMemoryAdapter().clear();
  setStorageAdapter(getMemoryAdapter());
  envMock.SWAL_D1 = undefined;
  mockSession();
  // El seed demo (`demo-flota`) es perezoso y se inyecta en la PRIMERA peticion que pasa por
  // `ensureSeeded`. Si esa primera peticion es la de un test que espia `listEntities`, el seed
  // aparece entre las llamadas y el assert "todo se consulta por el tenant de la sesion" falla
  // con `demo-flota`. Dispararlo aqui, antes de que ningun test instale su espia, hace que el
  // resultado no dependa del orden de ejecucion (con `--sequence.shuffle` fallaba 1 de cada N).
  await ensureSeeded();
  // Los tenants de prueba nunca son 'demo-flota' ni el de por defecto: todo se consulta por
  // el tenant de la sesion, que es justo lo que estos tests comprueban.
  const a = await seed(TENANT_A, VIN_A, 'FZ16 de A');
  const b = await seed(TENANT_B, VIN_B, 'Hilux de B', {
    make: 'Toyota',
    model: 'Hilux',
    mileage: 45_200,
    plate: 'XYZ-789',
  });
  idA = a.id;
  idB = b.id;
});

describe('GET /api/garage/vehicles: sesion y tenant', () => {
  it('sin cookie de sesion devuelve 401 y no consulta nada', async () => {
    const res = await GET_VEHICLES({
      request: new Request('https://gara-g.swal.network/api/garage/vehicles'),
      locals: { tenant: { instanceId: TENANT_A } },
    } as never);
    expect(res.status).toBe(401);
  });

  it('devuelve solo los vehiculos del tenant de la sesion', async () => {
    const res = await GET_VEHICLES(
      ctx('https://gara-g.swal.network/api/garage/vehicles', TENANT_A),
    );
    expect(res.status).toBe(200);
    const parsed = await json(res);
    const list = parsed.vehicles as { id: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(idA);
    expect(parsed.generatedAt).toBeTruthy();
  });

  it('un tenant con sesion distinta ve SU vehiculo, no el del otro', async () => {
    const res = await GET_VEHICLES(
      ctx('https://gara-g.swal.network/api/garage/vehicles', TENANT_B),
    );
    expect((await vehicles(res)).map((v) => v.id)).toEqual([idB]);
  });

  it('ignora ?instanceId= de la request: manda el de la sesion', async () => {
    const url = `https://gara-g.swal.network/api/garage/vehicles?instanceId=${TENANT_B}`;
    const res = await GET_VEHICLES(ctx(url, TENANT_A));
    // Si el parametro ganara, veria el vehiculo de B.
    expect((await vehicles(res)).map((v) => v.id)).toEqual([idA]);
  });

  it('el snapshot trae la forma que el HUD espera (spec, version, partes, compromisos)', async () => {
    const res = await GET_VEHICLES(
      ctx('https://gara-g.swal.network/api/garage/vehicles', TENANT_A),
    );
    const [v] = await vehicles(res);
    const spec = v?.spec as { family: string; paint: { baseColor: string } };
    const version = v?.version as { key: string };
    const indicators = v?.indicators as { left: { id: string }[] };
    expect(spec.family).toBe('moto');
    expect(spec.paint.baseColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(version.key).toBe('yamaha-fz16-2019-2024');
    expect(Array.isArray(v?.parts)).toBe(true);
    expect(Array.isArray(v?.commitments)).toBe(true);
    expect(indicators.left.map((i) => i.id)).toEqual(['health', 'odo', 'next', 'docs']);
  });
});

describe('GET /api/garage/vehicle/:id: 404 y aislamiento', () => {
  // El handler de Astro recibe un APIContext; aqui se construye el shape minimo que usa.
  const withId = (id: string, tenant: string) =>
    ({
      request: new Request('https://gara-g.swal.network/api/garage/vehicle/x', {
        headers: { cookie: 'session=t' },
      }),
      locals: { tenant: { instanceId: tenant } },
      params: { id },
    }) as unknown as Parameters<typeof GET_VEHICLE>[0];

  it('devuelve el vehiculo con su historial', async () => {
    const res = await GET_VEHICLE(withId(idA, TENANT_A));
    expect(res.status).toBe(200);
    const parsed = await json(res);
    expect((parsed.vehicle as { id: string }).id).toBe(idA);
    expect(Array.isArray(parsed.history)).toBe(true);
  });

  it('un vehiculo de OTRO tenant da 404 (no lo ve, y no se confirma que exista)', async () => {
    const res = await GET_VEHICLE(withId(idB, TENANT_A));
    expect(res.status).toBe(404);
  });

  it('sin sesion devuelve 401', async () => {
    const res = await GET_VEHICLE({
      request: new Request('https://gara-g.swal.network/api/garage/vehicle/veh-a'),
      locals: { tenant: { instanceId: TENANT_A } },
      params: { id: idA },
    } as never);
    expect(res.status).toBe(401);
  });

  it('un id inexistente da 404', async () => {
    const res = await GET_VEHICLE(withId('no-existe', TENANT_A));
    expect(res.status).toBe(404);
  });

  it('las consultas usan el tenant de la sesion, nunca el demo', async () => {
    const spy = vi.spyOn(await import('../../lib/domain'), 'listEntities');
    await GET_VEHICLE(withId(idA, TENANT_A));
    for (const call of spy.mock.calls) {
      expect(call[1]).toBe(TENANT_A);
      expect(call[1]).not.toBe('demo-flota');
    }
    spy.mockRestore();
  });

  it('el historial junta mantenimiento, combustible, alertas y DTC', async () => {
    await createEntity(
      'maintenance',
      {
        vehicleId: idA,
        type: 'Cambio de aceite',
        km: 9_000,
        date: '2026-02-01',
        cost: 45_000,
        workshop: 'Taller',
        status: 'completed',
      },
      TENANT_A,
    );
    await createEntity(
      'maintenance',
      {
        vehicleId: idA,
        type: 'preventivo',
        km: 9_200,
        date: '2026-02-20',
        cost: 90_000,
        workshop: 'Taller',
        status: 'completed',
      },
      TENANT_A,
    );
    await createEntity(
      'fuelLog',
      { vehicleId: idA, date: '2026-03-01', km: 9_500, gallons: 2, cost: 29_000, kmPerGallon: 25 },
      TENANT_A,
    );
    await createEntity(
      'alert',
      {
        vehicleId: idA,
        kind: 'speed',
        severity: 'high',
        message: 'Exceso',
        acknowledged: false,
        created_at: '2026-04-01T00:00:00.000Z',
      },
      TENANT_A,
    );
    await createEntity(
      'telemetry',
      {
        vin: VIN_A,
        timestamp: Date.parse('2026-04-02T00:00:00.000Z'),
        troubleCodes: ['P0301'],
        speed: 30,
      },
      TENANT_A,
    );

    const res = await GET_VEHICLE(withId(idA, TENANT_A));
    const kinds = new Set<string>(
      ((await json(res)).history as { kind: string }[]).map((e) => e.kind),
    );
    // "Cambio de aceite" nombra una pieza, asi que es un part_change; "preventivo" no, y queda
    // como mantenimiento. Las dos cosas entran en la misma linea de tiempo.
    expect(kinds.has('maintenance')).toBe(true);
    expect(kinds.has('part_change')).toBe(true);
    expect(kinds.has('fuel')).toBe(true);
    expect(kinds.has('alert')).toBe(true);
    expect(kinds.has('dtc')).toBe(true);
  });

  it('las entidades del otro tenant no se mezclan en el historial', async () => {
    await createEntity(
      'maintenance',
      {
        vehicleId: idB,
        type: 'Cambio de aceite',
        km: 100,
        date: '2026-02-01',
        cost: 1,
        workshop: 'Otro',
        status: 'completed',
      },
      TENANT_B,
    );
    const res = await GET_VEHICLE(withId(idA, TENANT_A));
    expect((await json(res)).history).toHaveLength(0);
  });
});

describe('aislamiento en la capa de datos', () => {
  it('listEntities separa los dos tenants', async () => {
    expect((await listEntities('vehicle', TENANT_A)).map((v) => v.id)).toEqual([idA]);
    expect((await listEntities('vehicle', TENANT_B)).map((v) => v.id)).toEqual([idB]);
  });
});
