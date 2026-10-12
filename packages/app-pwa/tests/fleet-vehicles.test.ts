import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  validateVIN,
  validatePlate,
  validateVehicleFields,
} from '../src/lib/vehicle.js';
import {
  GET as getEntityEndpoint,
  POST as postEntityEndpoint,
  PATCH as patchEntityEndpoint,
  DELETE as deleteEntityEndpoint,
} from '../src/pages/api/fleet/[entity].js';
import { GET as getTelemetryEndpoint } from '../src/pages/api/fleet/telemetry.js';
import { createEntity, getMemoryAdapter } from '../src/lib/domain.js';
import { domainConfig } from '../src/lib/domain.config.js';

const mockKv = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const envMock = env as unknown as Record<string, unknown>;

function makeCtx(
  urlStr: string,
  method = 'GET',
  body?: any,
  headers: Record<string, string> = {},
  locals: Record<string, unknown> = {},
  params: Record<string, string> = { entity: 'vehicle' },
) {
  const reqInit: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof FormData) {
      reqInit.body = body;
    } else {
      reqInit.body = JSON.stringify(body);
      if (!reqInit.headers) reqInit.headers = {};
      (reqInit.headers as Record<string, string>)['content-type'] = 'application/json';
    }
  }
  return {
    params,
    request: new Request(urlStr, reqInit),
    locals,
  } as any;
}

function createSessionToken(role = 'admin', instanceId = domainConfig.instanceId): string {
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  mockKv.get.mockImplementation(async (key: string) => {
    if (key === `token:${token}`) {
      return JSON.stringify({
        userId: 'usr_test_123',
        email: 'admin@flota.test',
        role,
        instanceId,
        exp: Date.now() + 3600_000,
      });
    }
    return null;
  });
  return token;
}

beforeEach(() => {
  vi.clearAllMocks();
  getMemoryAdapter().clear();
  envMock.ENVIRONMENT = 'production';
  envMock.SESSION = mockKv;
  mockKv.get.mockResolvedValue(null);
});

describe('Contratos de Validación Pura de Vehículos', () => {
  describe('validateVIN', () => {
    it('acepta VIN válido de 17 caracteres ISO 3779 / US NHTSA', () => {
      expect(validateVIN('1HGCM82633A004352')).toBe(true);
    });

    it('rechaza VIN corto con menos de 17 caracteres', () => {
      expect(validateVIN('1HGCM82633A004')).toBe(false);
    });

    it('rechaza VIN con caracteres prohibidos I, O, Q', () => {
      expect(validateVIN('1HGCM82633I004352')).toBe(false);
      expect(validateVIN('1HGCM82633O004352')).toBe(false);
      expect(validateVIN('1HGCM82633Q004352')).toBe(false);
    });

    it('rechaza VIN con símbolos no alfanuméricos', () => {
      expect(validateVIN('1HGCM82633A00435!')).toBe(false);
    });
  });

  describe('validatePlate', () => {
    it('acepta matrículas con formato Colombia (ABC-123) y Mercosur (ABC1D23)', () => {
      expect(validatePlate('ABC-123')).toBe(true);
      expect(validatePlate('ABC1D23')).toBe(true);
    });

    it('rechaza matrículas mal formadas o vacías', () => {
      expect(validatePlate('')).toBe(false);
      expect(validatePlate('123-ABC')).toBe(false);
      expect(validatePlate('AB-12345')).toBe(false);
    });

    it('es case-sensitive y rechaza minúsculas sin transformar', () => {
      expect(validatePlate('abc-123')).toBe(false);
    });
  });

  describe('validateVehicleFields', () => {
    const validPayload = {
      vin: '1HGCM82633A004352',
      plate: 'ABC-123',
      make: 'Toyota',
      model: 'Hilux',
      year: 2022,
      fleetId: 'fleet-001',
      status: 'active' as const,
    };

    it('retorna ok=true para payload completo válido', () => {
      const res = validateVehicleFields(validPayload);
      expect(res.ok).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('exige fleetId obligatorio y falla si falta', () => {
      const res = validateVehicleFields({ ...validPayload, fleetId: '' });
      expect(res.ok).toBe(false);
      expect(res.errors).toContain('fleetId es obligatorio');
    });

    it('exige vin obligatorio y falla si es inválido o corto', () => {
      const res = validateVehicleFields({ ...validPayload, vin: 'CORTO' });
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('vin inválido'))).toBe(true);
    });

    it('exige plate obligatoria y falla si está mal formada', () => {
      const res = validateVehicleFields({ ...validPayload, plate: 'INVALID' });
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('plate inválida'))).toBe(true);
    });

    it('exige make, model y year dentro de rango razonable', () => {
      const resMake = validateVehicleFields({ ...validPayload, make: '  ' });
      expect(resMake.ok).toBe(false);

      const resYear = validateVehicleFields({ ...validPayload, year: 1800 });
      expect(resYear.ok).toBe(false);
      expect(resYear.errors.some((e) => e.includes('year fuera de rango'))).toBe(true);
    });

    it('rechaza status no contemplado en VEHICLE_STATUSES', () => {
      const res = validateVehicleFields({ ...validPayload, status: 'desconocido' as any });
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('status inválido'))).toBe(true);
    });

    it('limita la capacidad a máximo 40 caracteres', () => {
      const res = validateVehicleFields({ ...validPayload, capacity: 'A'.repeat(45) });
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes('capacity debe tener máximo'))).toBe(true);
    });
  });
});

describe('Contratos de Seguridad & Fallo Cerrado (Auth y RBAC)', () => {
  const endpointUrl = 'https://gara-g.swal.network/api/fleet/vehicle';

  it('responde 401 Unauthorized sin cookie de sesión en produccion (GET, POST, PATCH, DELETE)', async () => {
    const ctxGet = makeCtx(endpointUrl, 'GET');
    const resGet = await getEntityEndpoint(ctxGet);
    expect(resGet.status).toBe(401);

    const ctxPost = makeCtx(endpointUrl, 'POST', { plate: 'ABC-123' });
    const resPost = await postEntityEndpoint(ctxPost);
    expect(resPost.status).toBe(401);

    const ctxPatch = makeCtx(`${endpointUrl}?id=v1`, 'PATCH', { status: 'active' });
    const resPatch = await patchEntityEndpoint(ctxPatch);
    expect(resPatch.status).toBe(401);

    const ctxDelete = makeCtx(`${endpointUrl}?id=v1`, 'DELETE');
    const resDelete = await deleteEntityEndpoint(ctxDelete);
    expect(resDelete.status).toBe(401);
  });

  it('responde 403 Forbidden cuando el rol observer intenta crear o eliminar vehículos', async () => {
    const token = createSessionToken('observer', 'tenant-a');
    const headers = { cookie: `session=${token}` };
    const locals = { tenant: { instanceId: 'tenant-a' } };

    const ctxPost = makeCtx(endpointUrl, 'POST', { plate: 'ABC-123' }, headers, locals);
    const resPost = await postEntityEndpoint(ctxPost);
    expect(resPost.status).toBe(403);

    const ctxDelete = makeCtx(`${endpointUrl}?id=v1`, 'DELETE', undefined, headers, locals);
    const resDelete = await deleteEntityEndpoint(ctxDelete);
    expect(resDelete.status).toBe(403);
  });

  it('responde 400 Bad Request si la entidad no está whitelisteada', async () => {
    const token = createSessionToken('admin');
    const headers = { cookie: `session=${token}` };
    const ctx = makeCtx(
      'https://gara-g.swal.network/api/fleet/hackEntity',
      'GET',
      undefined,
      headers,
      {},
      { entity: 'hackEntity' },
    );
    const res = await getEntityEndpoint(ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid entity');
  });
});

describe('Contratos CRUD de Vehículos via Endpoint REST', () => {
  const endpointUrl = 'https://gara-g.swal.network/api/fleet/vehicle';
  const tenantId = 'tenant-test-crud';

  it('POST rechaza vehículo con VIN corto o datos inválidos con HTTP 400', async () => {
    const token = createSessionToken('admin', tenantId);
    const headers = { cookie: `session=${token}` };
    const locals = { tenant: { instanceId: tenantId } };

    const invalidBody = {
      vin: 'VIN-INCORRECTO',
      plate: 'ABC-123',
      make: 'Toyota',
      model: 'Hilux',
      year: 2022,
      fleetId: 'flota-1',
    };

    const ctx = makeCtx(endpointUrl, 'POST', invalidBody, headers, locals);
    const res = await postEntityEndpoint(ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Vehículo inválido');
  });

  it('POST crea vehículo válido con HTTP 201', async () => {
    const token = createSessionToken('admin', tenantId);
    const headers = { cookie: `session=${token}` };
    const locals = { tenant: { instanceId: tenantId } };

    const validBody = {
      vin: '1HGCM82633A004352',
      plate: 'ABC-123',
      make: 'Toyota',
      model: 'Hilux',
      year: 2022,
      fleetId: 'flota-1',
      status: 'active',
    };

    const ctx = makeCtx(endpointUrl, 'POST', validBody, headers, locals);
    const res = await postEntityEndpoint(ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.plate).toBe('ABC-123');
    expect(json.data.vin).toBe('1HGCM82633A004352');
    expect(json.data.instance_id).toBe(tenantId);
  });

  it('PATCH requiere id y valida campos fusionados', async () => {
    const token = createSessionToken('admin', tenantId);
    const headers = { cookie: `session=${token}` };
    const locals = { tenant: { instanceId: tenantId } };

    // PATCH sin id
    const ctxNoId = makeCtx(endpointUrl, 'PATCH', { make: 'Ford' }, headers, locals);
    const resNoId = await patchEntityEndpoint(ctxNoId);
    expect(resNoId.status).toBe(400);

    // Crear vehículo primero
    const created = await createEntity(
      'vehicle',
      {
        vin: '1HGCM82633A004352',
        plate: 'ABC-123',
        make: 'Toyota',
        model: 'Hilux',
        year: 2022,
        fleetId: 'flota-1',
        status: 'active',
      },
      tenantId,
    );

    // PATCH con VIN inválido en el patch
    const ctxBadPatch = makeCtx(
      `${endpointUrl}?id=${created.id}`,
      'PATCH',
      { vin: 'VIN-MALO' },
      headers,
      locals,
    );
    const resBadPatch = await patchEntityEndpoint(ctxBadPatch);
    expect(resBadPatch.status).toBe(400);

    // PATCH válido
    const ctxOkPatch = makeCtx(
      `${endpointUrl}?id=${created.id}`,
      'PATCH',
      { model: 'Hilux GR-Sport' },
      headers,
      locals,
    );
    const resOkPatch = await patchEntityEndpoint(ctxOkPatch);
    expect(resOkPatch.status).toBe(200);
    const okJson = await resOkPatch.json();
    expect(okJson.data.model).toBe('Hilux GR-Sport');
  });

  it('POST crea un camión chileno (zzbc11 → ZZBC-11) y PATCH lo edita', async () => {
    const token = createSessionToken('admin', tenantId);
    const headers = { cookie: `session=${token}` };
    const locals = { tenant: { instanceId: tenantId } };

    const ctx = makeCtx(
      endpointUrl,
      'POST',
      {
        vin: '1XKAD49X0DJ000011',
        plate: 'zzbc11',
        make: 'Kenworth',
        model: 'T800 Volqueta',
        type: 'volqueta',
        year: 2019,
        fleetId: 'flota-chile',
        status: 'active',
      },
      headers,
      locals,
    );
    const res = await postEntityEndpoint(ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.plate).toBe('ZZBC-11');

    // Editar otro campo de un camión con placa chilena ya guardada (antes: 400 por la placa).
    const ctxPatch = makeCtx(
      `${endpointUrl}?id=${json.data.id}`,
      'PATCH',
      { status: 'maintenance' },
      headers,
      locals,
    );
    const resPatch = await patchEntityEndpoint(ctxPatch);
    expect(resPatch.status).toBe(200);
    expect((await resPatch.json()).data.status).toBe('maintenance');

    // Cambiar a placa antigua chilena sin guion: se guarda como AB-1234.
    const ctxPlate = makeCtx(
      `${endpointUrl}?id=${json.data.id}`,
      'PATCH',
      { plate: 'ab1234' },
      headers,
      locals,
    );
    const resPlate = await patchEntityEndpoint(ctxPlate);
    expect(resPlate.status).toBe(200);
    expect((await resPlate.json()).data.plate).toBe('AB-1234');

    // Una placa chilena mal formada sigue dando 400.
    const ctxBad = makeCtx(
      `${endpointUrl}?id=${json.data.id}`,
      'PATCH',
      { plate: 'ZZBC-1' },
      headers,
      locals,
    );
    expect((await patchEntityEndpoint(ctxBad)).status).toBe(400);
  });

  it('DELETE requiere id y elimina el vehículo', async () => {
    const token = createSessionToken('admin', tenantId);
    const headers = { cookie: `session=${token}` };
    const locals = { tenant: { instanceId: tenantId } };

    // DELETE sin id
    const ctxNoId = makeCtx(endpointUrl, 'DELETE', undefined, headers, locals);
    const resNoId = await deleteEntityEndpoint(ctxNoId);
    expect(resNoId.status).toBe(400);

    // Crear vehículo y borrarlo
    const created = await createEntity(
      'vehicle',
      { vin: '1HGCM82633A004352', plate: 'ABC-123', make: 'Toyota', model: 'Corolla', year: 2021, fleetId: 'f1' },
      tenantId,
    );

    const ctxDel = makeCtx(`${endpointUrl}?id=${created.id}`, 'DELETE', undefined, headers, locals);
    const resDel = await deleteEntityEndpoint(ctxDel);
    expect(resDel.status).toBe(200);
    const delJson = await resDel.json();
    expect(delJson.ok).toBe(true);
  });

  it('soporta POST form-encoded con _method=DELETE y redirige con HTTP 303', async () => {
    const token = createSessionToken('admin', tenantId);
    const headers = {
      cookie: `session=${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    };
    const locals = { tenant: { instanceId: tenantId } };

    const created = await createEntity(
      'vehicle',
      { vin: '1HGCM82633A004352', plate: 'XYZ-999', make: 'Nissan', model: 'Frontier', year: 2020, fleetId: 'f1' },
      tenantId,
    );

    const body = new URLSearchParams({
      _method: 'DELETE',
      id: created.id,
    }).toString();

    const ctxForm = makeCtx(`${endpointUrl}?id=${created.id}`, 'POST', body, headers, locals);
    const resForm = await postEntityEndpoint(ctxForm);
    expect(resForm.status).toBe(303);
    expect(resForm.headers.get('Location')).toContain(`/fleet/vehicles?instanceId=${tenantId}&deleted=${created.id}`);
  });
});

describe('Aislamiento Estricto de Tenant para Vehículos', () => {
  const endpointUrl = 'https://gara-g.swal.network/api/fleet/vehicle';
  const tenantAlpha = 'tenant-alpha-01';
  const tenantBeta = 'tenant-beta-02';

  it('un vehículo de tenant-alpha no es visible en las consultas de tenant-beta', async () => {
    // Crear vehículo en tenant-alpha
    await createEntity(
      'vehicle',
      {
        vin: '1HGCM82633A004352',
        plate: 'ALP-100',
        make: 'Volvo',
        model: 'FH16',
        year: 2023,
        fleetId: 'flota-a',
      },
      tenantAlpha,
    );

    // Consultar como tenant-beta
    const tokenBeta = createSessionToken('admin', tenantBeta);
    const ctxBeta = makeCtx(
      endpointUrl,
      'GET',
      undefined,
      { cookie: `session=${tokenBeta}` },
      { tenant: { instanceId: tenantBeta } },
    );
    const resBeta = await getEntityEndpoint(ctxBeta);
    expect(resBeta.status).toBe(200);
    const dataBeta = await resBeta.json();
    expect(dataBeta.data).toHaveLength(0);

    // Consultar como tenant-alpha
    const tokenAlpha = createSessionToken('admin', tenantAlpha);
    const ctxAlpha = makeCtx(
      endpointUrl,
      'GET',
      undefined,
      { cookie: `session=${tokenAlpha}` },
      { tenant: { instanceId: tenantAlpha } },
    );
    const resAlpha = await getEntityEndpoint(ctxAlpha);
    expect(resAlpha.status).toBe(200);
    const dataAlpha = await resAlpha.json();
    expect(dataAlpha.data).toHaveLength(1);
    expect(dataAlpha.data[0].plate).toBe('ALP-100');
  });
});

describe('Contratos de Vista de Tracking y Telemetría (/api/fleet/telemetry)', () => {
  const telemetryUrl = 'https://gara-g.swal.network/api/fleet/telemetry';
  const tenantId = 'tenant-tracking-01';

  it('devuelve la telemetría más reciente formateada y enlazada con la placa del vehículo', async () => {
    const vinVal = '1HGCM82633A004352';

    // Seed vehículo y telemetría
    await createEntity(
      'vehicle',
      { vin: vinVal, plate: 'TRK-555', make: 'Chevrolet', model: 'NHR', year: 2022, fleetId: 'f1' },
      tenantId,
    );

    await createEntity(
      'telemetry',
      {
        vin: vinVal,
        speed: 65,
        rpm: 2100,
        coolantTemp: 88,
        fuelLevel: 75,
        latitude: 4.6097,
        longitude: -74.0817,
        timestamp: Date.now() - 10000,
      },
      tenantId,
    );

    await createEntity(
      'telemetry',
      {
        vin: vinVal,
        speed: 80,
        rpm: 2400,
        coolantTemp: 90,
        fuelLevel: 74,
        latitude: 4.6150,
        longitude: -74.0850,
        timestamp: Date.now(),
      },
      tenantId,
    );

    const token = createSessionToken('admin', tenantId);
    const ctx = makeCtx(
      `${telemetryUrl}?recent=1`,
      'GET',
      undefined,
      { cookie: `session=${token}` },
      { tenant: { instanceId: tenantId } },
    );

    const res = await getTelemetryEndpoint(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    const row = json.data[0];
    expect(row.vin).toBe(vinVal);
    expect(row.plate).toBe('TRK-555');
    expect(row.speed).toBe(80);
    expect(row.formattedSpeed).toBe('80 km/h');
    expect(row.formattedTemp).toBe('90°C');
    expect(row.formattedFuel).toBe('74%');
  });

  it('permite filtrar la telemetría por parámetro VIN', async () => {
    const vin1 = '1HGCM82633A004352';
    const vin2 = '2HGCM82633A009999';

    await createEntity('telemetry', { vin: vin1, speed: 50, timestamp: Date.now() }, tenantId);
    await createEntity('telemetry', { vin: vin2, speed: 90, timestamp: Date.now() }, tenantId);

    const token = createSessionToken('admin', tenantId);
    const ctx = makeCtx(
      `${telemetryUrl}?recent=1&vin=${vin1}`,
      'GET',
      undefined,
      { cookie: `session=${token}` },
      { tenant: { instanceId: tenantId } },
    );

    const res = await getTelemetryEndpoint(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.data[0].vin).toBe(vin1);
  });

  it('maneja flotas sin telemetría retornando data vacía de forma segura', async () => {
    const emptyTenant = 'tenant-vacio-telemetry';
    const token = createSessionToken('admin', emptyTenant);
    const ctx = makeCtx(
      `${telemetryUrl}?recent=1`,
      'GET',
      undefined,
      { cookie: `session=${token}` },
      { tenant: { instanceId: emptyTenant } },
    );

    const res = await getTelemetryEndpoint(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(0);
    expect(json.data).toEqual([]);
  });
});
