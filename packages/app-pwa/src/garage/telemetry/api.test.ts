/**
 * telemetry/api.test.ts — POST de ingesta y GET de monitoreo: sesion, rol, tenant y VIN.
 *
 * Ejecuta los handlers contra el `listEntities`/`createEntity` reales (MemoryAdapter), como
 * tests/fleet-stats-tenancy.test.ts. El caso que mas importa: un VIN de otro tenant NO se
 * escribe. Sin esa comprobacion, un operator del cliente A inyectaria muestras en el vehiculo
 * del cliente B y su mapa en vivo se moveria solo.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntity, getMemoryAdapter, listEntities, setStorageAdapter } from '../../lib/domain';
import { GET } from '../../pages/api/garage/telemetry/[vin]';
import { POST } from '../../pages/api/garage/telemetry/index';

const envMock = env as unknown as Record<string, unknown>;

const TENANT_A = 'tenant-tel-a';
const TENANT_B = 'tenant-tel-b';
const VIN_A = '1HGCM82633A004352';
const VIN_B = '1HGCM82633A004353';

function mockSession(role: string, instanceId: string) {
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

function ctx(url: string, tenant?: string, params: Record<string, string> = {}, body?: unknown) {
  return {
    request: new Request(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie: 'session=t', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: tenant ? { tenant: { instanceId: tenant } } : {},
    params,
  } as never;
}

const post = (tenant: string, body: unknown) =>
  POST(ctx('https://gara-g.swal.network/api/garage/telemetry', tenant, {}, body));

const get = (vin: string, tenant: string) =>
  GET(ctx('https://gara-g.swal.network/api/garage/telemetry/x', tenant, { vin }));

/** Lectura tipada del JSON: los asserts sobre `unknown` no compilan con strict. */
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

const sample = (vin: string, extra: Record<string, unknown> = {}) => ({
  vin,
  ts: new Date().toISOString(),
  speedKmh: 42,
  rpm: 2300,
  coolantC: 88,
  fuelPct: 63,
  source: 'apk',
  ...extra,
});

beforeEach(async () => {
  getMemoryAdapter().clear();
  setStorageAdapter(getMemoryAdapter());
  mockSession('admin', TENANT_A);
  await createEntity(
    'vehicle',
    { vin: VIN_A, plate: 'AAA-111', make: 'Yamaha', model: 'FZ16' },
    TENANT_A,
  );
  await createEntity(
    'vehicle',
    { vin: VIN_B, plate: 'BBB-222', make: 'Toyota', model: 'Hilux' },
    TENANT_B,
  );
});

describe('POST /api/garage/telemetry: sesion y rol', () => {
  it('sin sesion devuelve 401', async () => {
    const res = await POST({
      request: new Request('https://gara-g.swal.network/api/garage/telemetry', { method: 'POST' }),
      locals: { tenant: { instanceId: TENANT_A } },
    } as never);
    expect(res.status).toBe(401);
  });

  it('un observer (solo lectura) no puede escribir: 403', async () => {
    mockSession('observer', TENANT_A);
    const res = await post(TENANT_A, { samples: [sample(VIN_A)] });
    expect(res.status).toBe(403);
  });

  it('un operator si puede', async () => {
    mockSession('operator', TENANT_A);
    const res = await post(TENANT_A, { samples: [sample(VIN_A)] });
    expect(res.status).toBe(200);
    expect((await json(res)).accepted).toBe(1);
  });
});

describe('POST /api/garage/telemetry: validacion y conteo de motivos', () => {
  it('acepta las validas y cuenta las invalidas por motivo', async () => {
    const res = await post(TENANT_A, {
      samples: [
        sample(VIN_A),
        sample(VIN_A, { speedKmh: 5000 }),
        sample('VIN-CORTO'),
        { vin: VIN_A },
      ],
    });
    const body = await json(res);
    expect(body.accepted).toBe(1);
    expect((body.rejected as Record<string, number>).rango).toBe(1);
    expect((body.rejected as Record<string, number>).vin_invalido).toBe(1);
    expect((body.rejected as Record<string, number>).ts_invalido).toBe(1);
  });

  it('sin `samples` devuelve 400', async () => {
    const res = await post(TENANT_A, {});
    expect(res.status).toBe(400);
  });

  it('lo que se acepta queda en la entidad `telemetry` del tenant', async () => {
    await post(TENANT_A, { samples: [sample(VIN_A, { dtc: ['P0420'] })] });
    const rows = await listEntities('telemetry', TENANT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].vin).toBe(VIN_A);
    expect(rows[0].coolantTemp).toBe(88);
    expect(rows[0].troubleCodes).toEqual(['P0420']);
  });

  it('las muestras invalidas NO se escriben', async () => {
    await post(TENANT_A, { samples: [sample(VIN_A, { coolantC: 999 })] });
    expect(await listEntities('telemetry', TENANT_A)).toHaveLength(0);
  });

  it('un lote de 201 se acota y cuenta lote_excedido', async () => {
    const batch = Array.from({ length: 201 }, () => sample(VIN_A));
    const res = await post(TENANT_A, { samples: batch });
    const body = await json(res);
    expect(body.accepted).toBe(200);
    expect((body.rejected as Record<string, number>).lote_excedido).toBe(1);
  });
});

describe('POST /api/garage/telemetry: el VIN debe ser del tenant', () => {
  it('una muestra con VIN de otro vehiculo se rechaza y no se escribe', async () => {
    const res = await post(TENANT_A, { samples: [sample(VIN_B)] });
    const body = await json(res);
    expect(body.accepted).toBe(0);
    expect((body.rejected as Record<string, number>).vin_ajeno).toBe(1);
    expect(await listEntities('telemetry', TENANT_A)).toHaveLength(0);
    expect(await listEntities('telemetry', TENANT_B)).toHaveLength(0);
  });

  it('un lote mixto acepta lo propio y rechaza lo ajeno, contando cada motivo', async () => {
    // '1HGCM82633A004399' tiene formato valido pero no es de este tenant: cuenta como ajeno,
    // no como vin_invalido (que seria el caso de un VIN con caracteres prohibidos).
    const res = await post(TENANT_A, {
      samples: [sample(VIN_A), sample(VIN_B), sample('1HGCM82633A004399')],
    });
    const body = await json(res);
    expect(body.accepted).toBe(1);
    expect((body.rejected as Record<string, number>).vin_ajeno).toBe(2);
    expect((body.rejected as Record<string, number>).vin_invalido).toBeUndefined();
  });

  it('un VIN que no existe en absoluto tambien cuenta como vin_ajeno', async () => {
    const res = await post(TENANT_A, { samples: [sample('1HGCM82633A004399')] });
    expect(((await json(res)).rejected as Record<string, number>).vin_ajeno).toBe(1);
  });

  it('el tenant B puede escribir en su propio VIN sin ver el del tenant A', async () => {
    mockSession('admin', TENANT_B);
    const res = await post(TENANT_B, { samples: [sample(VIN_B), sample(VIN_A)] });
    expect((await json(res)).accepted).toBe(1);
    expect((await listEntities('telemetry', TENANT_B)).map((r) => r.vin)).toEqual([VIN_B]);
    expect(await listEntities('telemetry', TENANT_A)).toHaveLength(0);
  });
});

describe('GET /api/garage/telemetry/:vin: MonitoringState', () => {
  it('sin sesion devuelve 401', async () => {
    const res = await GET({
      request: new Request('https://gara-g.swal.network/api/garage/telemetry/x'),
      locals: { tenant: { instanceId: TENANT_A } },
      params: { vin: VIN_A },
    } as never);
    expect(res.status).toBe(401);
  });

  it('devuelve connected con una muestra recien enviada', async () => {
    await post(TENANT_A, { samples: [sample(VIN_A)] });
    const res = await get(VIN_A, TENANT_A);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.vin).toBe(VIN_A);
    expect(body.connected).toBe(true);
    expect(body.series).toHaveLength(1);
    expect((body.latest as { coolantC: number }).coolantC).toBe(88);
  });

  it('un VIN de otro tenant da 404', async () => {
    await post(TENANT_A, { samples: [sample(VIN_B)] }); // no entra: es ajeno a A
    const res = await get(VIN_B, TENANT_A);
    expect(res.status).toBe(404);
  });

  it('un VIN con vehiculo pero sin muestras: 200 con "sin señal", no 404', async () => {
    const res = await get(VIN_A, TENANT_A);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.connected).toBe(false);
    expect(body.series).toHaveLength(0);
  });

  it('connected=false si la ultima muestra es vieja', async () => {
    await createEntity(
      'telemetry',
      { vin: VIN_A, timestamp: Date.now() - 10 * 60_000, speed: 10 },
      TENANT_A,
    );
    const body = await json(await get(VIN_A, TENANT_A));
    expect(body.connected).toBe(false);
    expect(body.lastSeen).toBeTruthy();
  });

  it('el VIN se acepta en minusculas (la APK puede mandarlo asi)', async () => {
    await post(TENANT_A, { samples: [sample(VIN_A)] });
    const res = await get(VIN_A.toLowerCase(), TENANT_A);
    expect(res.status).toBe(200);
    expect((await json(res)).vin).toBe(VIN_A);
  });

  it('un VIN con formato invalido da 400', async () => {
    const res = await get('CORTO', TENANT_A);
    expect(res.status).toBe(400);
  });

  it('no se ve la telemetria del otro tenant al pedir el propio VIN', async () => {
    await mockSession('admin', TENANT_A);
    await createEntity('telemetry', { vin: VIN_A, timestamp: Date.now(), speed: 1 }, TENANT_A);
    await createEntity('telemetry', { vin: VIN_B, timestamp: Date.now(), speed: 99 }, TENANT_B);

    const bodyA = await json(await get(VIN_A, TENANT_A));
    expect((bodyA.series as { speedKmh: number }[])[0]?.speedKmh).toBe(1);

    mockSession('admin', TENANT_B);
    const bodyB = await json(await get(VIN_B, TENANT_B));
    expect((bodyB.series as { speedKmh: number }[])[0]?.speedKmh).toBe(99);
  });

  it('un observer si puede leer (es una lectura)', async () => {
    mockSession('observer', TENANT_A);
    const res = await get(VIN_A, TENANT_A);
    expect(res.status).toBe(200);
  });
});
