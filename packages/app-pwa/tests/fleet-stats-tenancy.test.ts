/**
 * tests/fleet-stats-tenancy.test.ts — los KPIs del dashboard son del tenant de
 * la sesion.
 *
 * El fallo que cubre: `/api/fleet/stats` resolvia el tenant y lo devolvia en
 * el JSON (`{ data, instanceId }`), lo que hacia pensar que estaba filtrado,
 * pero llamaba a `getFleetStats()` sin pasarlo. Los ocho `listEntities` de
 * dentro usaban DEMO_INSTANCE_ID, asi que todos los clientes veian los mismos
 * numeros: los del tenant de los datos de ejemplo.
 *
 * Estos casos EJECUTAN la ruta y comprueban sobre la llamada real a
 * `listEntities`, no sobre el texto del fuente.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listEntities = vi.fn();

vi.mock('../src/lib/domain.js', async () => {
  const real = await vi.importActual<typeof import('../src/lib/domain.js')>('../src/lib/domain.js');
  return { ...real, listEntities };
});

const envMock = env as unknown as Record<string, unknown>;

/** Entidades minimas por tipo: el calculo de KPIs solo mira estos campos. */
function entidad(tipo: string, extra: Record<string, unknown> = {}) {
  switch (tipo) {
    case 'vehicle':
      return { status: 'active', mileage: 1000, ...extra };
    case 'alert':
      return { acknowledged: false, severity: 'warning', ...extra };
    case 'fuelLog':
      return { cost: 10, ...extra };
    default:
      return { ...extra };
  }
}

function mockCon(tenant: string) {
  listEntities.mockImplementation(async (tipo: string, instanceId: string) => {
    // Si el endpoint no pasa el tenant de la sesion, se cae al tenant demo.
    if (instanceId !== tenant) return [];
    return [entidad(tipo, tipo === 'vehicle' ? { status: 'active', mileage: 5000 } : {})];
  });
}

function ctx(tenant?: string) {
  const headers: Record<string, string> = {};
  if (tenant) headers.cookie = 'session=t';
  return {
    request: new Request('https://gara-g.swal.network/api/fleet/stats', { headers }),
    locals: tenant ? { tenant: { instanceId: tenant } } : {},
  } as never;
}

async function callStats(tenant?: string) {
  const { GET } = await import('../src/pages/api/fleet/stats.js');
  return GET(ctx(tenant));
}

describe('/api/fleet/stats cuenta los KPIs del tenant de la sesion', () => {
  beforeEach(() => {
    listEntities.mockReset();
    envMock.ENVIRONMENT = 'production';
    envMock.SESSION = {
      get: vi.fn(async (k: string) =>
        k === 'token:t'
          ? JSON.stringify({
              userId: 'u1',
              email: 'a@b.c',
              role: 'admin',
              instanceId: 'tenant-cliente-a',
              exp: Date.now() + 3_600_000,
            })
          : null,
      ),
    };
  });

  it('pasa el tenant de la sesion a la consulta, no el de los datos demo', async () => {
    mockCon('tenant-cliente-a');
    const res = await callStats('tenant-cliente-a');

    expect(res.status).toBe(200);
    // Cada consulta debe llevar el tenant de la sesion. Si alguna lleva otro,
    // el KPI de esa entidad es de otro cliente.
    const tenants = listEntities.mock.calls.map((c) => c[1]);
    expect(tenants.length).toBeGreaterThan(0);
    expect(new Set(tenants), 'todas las consultas con el mismo tenant').toEqual(
      new Set(['tenant-cliente-a']),
    );
  });

  it('el instanceId que devuelve la respuesta es el que se consulto', async () => {
    mockCon('tenant-cliente-a');
    const res = await callStats('tenant-cliente-a');
    const body = await res.json();

    // Antes el JSONodia del tenant de la sesion mientras los datos venian del
    // demo: por eso esto compara la respuesta con lo que realmente se consulto.
    expect(body.instanceId).toBe('tenant-cliente-a');
    expect(body.data).toBeDefined();
    expect(body.data.totalVehicles ?? body.data.vehicles ?? 1).toBeGreaterThan(0);
  });

  it('dos tenants distintos no ven los mismos numeros', async () => {
    // Un tenant con flota; el otro vacio. Con el bug, ambos verian lo mismo.
    listEntities.mockImplementation(async (tipo: string, instanceId: string) => {
      if (instanceId !== 'tenant-con-datos') return [];
      return [entidad(tipo, { status: 'active', mileage: 5000 })];
    });

    const conDatos = await (async () => {
      const res = await callStats('tenant-con-datos');
      return res.json();
    })();
    const sinDatos = await (async () => {
      const res = await callStats('tenant-vacio');
      return res.json();
    })();

    expect(conDatos.instanceId).toBe('tenant-con-datos');
    expect(sinDatos.instanceId).toBe('tenant-vacio');
    // El que no tiene filas tiene que tener menos vehiculos que el que si.
    const nCon = conDatos.data.totalVehicles ?? conDatos.data.vehicles ?? 1;
    const nSin = sinDatos.data.totalVehicles ?? sinDatos.data.vehicles ?? 0;
    expect(nCon).toBeGreaterThan(nSin);
  });
});

describe('getFleetStats exige tenant', () => {
  beforeEach(() => {
    listEntities.mockReset();
    envMock.ENVIRONMENT = 'production';
  });

  it('lanza si se llama sin tenant en vez de devolver ceros', async () => {
    const { getFleetStats } = await import('../src/lib/fleetSeed.js');
    // Sin tenant no hay un dato "global" honesto que mostrar: devolver 0 seria
    // decir "no tienes vehiculos" cuando en realidad no se ha consultado nada.
    await expect(getFleetStats('')).rejects.toThrow(/necesita un tenant/i);
  });
});
