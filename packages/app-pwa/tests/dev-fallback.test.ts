/**
 * tests/dev-fallback.test.ts — ningún endpoint puede devolver admin sin sesión válida.
 *
 * Contexto: dos ficheros tenían un bypass que devolvía el usuario admin cuando el
 * token NO existía en KV:
 *   - src/pages/api/fleetApi/auth.ts   (getAuthUser)
 *   - src/middleware.ts                (getSessionUser, 3 ramas)
 *
 * Con un token inventado, cualquiera entraba como admin. Verificado que en el
 * Worker desplegado (2026-09-03) aún no estaba, pero el código local sí lo tenía:
 * un merge + redeploy lo activaba.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { getAuthUser } from '../src/pages/api/fleetApi/auth.js';

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const envMock = env as unknown as Record<string, unknown>;

function reqWithToken(token: string): Request {
  return new Request('https://gara-g.swal.network/api/fleet/vehicle', {
    headers: { cookie: `session=${token}` },
  });
}

describe('getAuthUser: sin bypass de admin cuando el token no existe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKv.get.mockResolvedValue(null);
    mockKv.put.mockResolvedValue(undefined);
    envMock.SESSION = mockKv;
    envMock.ENVIRONMENT = 'production';
    delete envMock.DEV_ADMIN_SESSION;
  });

  it('devuelve null con un token inventado (KV presente, sin registro)', async () => {
    expect(await getAuthUser(reqWithToken('token-inventado-abc'))).toBeNull();
  });

  it('devuelve null si la sesión expiró, y limpia KV', async () => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({ userId: 'usr_001', email: 'a@b.cl', role: 'admin', exp: Date.now() - 1000 }),
    );
    expect(await getAuthUser(reqWithToken('token-expirado'))).toBeNull();
    expect(mockKv.delete).toHaveBeenCalledWith('token:token-expirado');
  });

  it('devuelve el usuario cuando la sesión es válida', async () => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({
        userId: 'usr_002',
        email: 'op@chile.cl',
        role: 'operator',
        instanceId: 'flota-01',
        exp: Date.now() + 60_000,
      }),
    );
    const user = await getAuthUser(reqWithToken('token-bueno'));
    expect(user?.role).toBe('operator');
    expect(user?.instanceId).toBe('flota-01');
  });

  it('devuelve null si no hay cookie de sesión', async () => {
    const req = new Request('https://gara-g.swal.network/api/fleet/vehicle');
    expect(await getAuthUser(req)).toBeNull();
  });
});

describe('getAuthUser: el fallback de desarrollo exige opt-in y entorno de desarrollo', () => {
  // Antes bastaba ENVIRONMENT != production: staging/preview (o un deploy sin la var)
  // aceptaban una cookie inventada como admin. Ahora hacen falta DEV_ADMIN_SESSION="true"
  // Y ENVIRONMENT development/local.
  beforeEach(() => {
    vi.clearAllMocks();
    mockKv.get.mockResolvedValue(null);
    envMock.SESSION = mockKv;
    delete envMock.DEV_ADMIN_SESSION;
  });

  it('NO da admin con ENVIRONMENT=production y token inexistente', async () => {
    envMock.ENVIRONMENT = 'production';
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
  });

  it('NO da admin en production aunque DEV_ADMIN_SESSION=true', async () => {
    envMock.ENVIRONMENT = 'production';
    envMock.DEV_ADMIN_SESSION = 'true';
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
  });

  it.each(['staging', 'preview'])('NO da admin con ENVIRONMENT=%s, ni siquiera con DEV_ADMIN_SESSION=true', async (environment) => {
    envMock.ENVIRONMENT = environment;
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
    envMock.DEV_ADMIN_SESSION = 'true';
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
  });

  it('NO da admin con ENVIRONMENT ausente (antes: dev por defecto)', async () => {
    delete envMock.ENVIRONMENT;
    envMock.DEV_ADMIN_SESSION = 'true';
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
  });

  it('NO da admin con ENVIRONMENT=development sin el opt-in', async () => {
    envMock.ENVIRONMENT = 'development';
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
    envMock.DEV_ADMIN_SESSION = '1'; // solo "true" literal cuenta
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
  });

  it.each(['development', 'local'])('da admin con ENVIRONMENT=%s y DEV_ADMIN_SESSION=true', async (environment) => {
    envMock.ENVIRONMENT = environment;
    envMock.DEV_ADMIN_SESSION = 'true';
    const user = await getAuthUser(reqWithToken('cualquiera'));
    expect(user?.role).toBe('admin');
  });
});

describe('getAuthUser: sin binding KV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.ENVIRONMENT = 'production';
    delete envMock.SESSION;
    delete envMock.DEV_ADMIN_SESSION;
  });

  it('NO da admin en produccion aunque no haya KV bindeado', async () => {
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
  });

  it('NO da admin en staging sin KV bindeado', async () => {
    envMock.ENVIRONMENT = 'staging';
    envMock.DEV_ADMIN_SESSION = 'true';
    expect(await getAuthUser(reqWithToken('cualquiera'))).toBeNull();
  });

  it('da admin en desarrollo con opt-in si no hay KV bindeado', async () => {
    envMock.ENVIRONMENT = 'development';
    envMock.DEV_ADMIN_SESSION = 'true';
    const user = await getAuthUser(reqWithToken('cualquiera'));
    expect(user?.role).toBe('admin');
  });
});
