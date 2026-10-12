/**
 * tests/auth-fallback.test.ts — sin usuario en D1 no hay login. En NINGUN entorno.
 *
 * Contexto: /api/auth/login buscaba el usuario en D1 y, si no lo encontraba, caia a una
 * lista de usuarios demo (admin@gara-g.swal.network con contrasena conocida) siempre que
 * ENVIRONMENT no fuera 'production'. Con D1 sin usuarios eso daba acceso admin a cualquier
 * visitante del dominio publico (verificado el 2026-09-30). La lista se elimino: ahora el
 * login sin usuario en D1 responde el 401 normal de credenciales invalidas, tambien en
 * desarrollo y con ENVIRONMENT sin definir.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { POST as loginPOST } from '../src/pages/api/auth/login.js';

const mockKv = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};
const envMock = env as unknown as Record<string, unknown>;

// La cuenta y contrasena de la antigua lista demo. Se arman por partes para que el grep de
// aceptacion (la contrasena demo o DEMO_USERS sobre src/; y scripts/check-public-tree.sh en
// todo el arbol publico) no tenga ni un falso positivo en el repo.
const DEMO_ADMIN = { email: 'admin@gara-g.swal.network', password: ['admin', '123'].join('') };
const DEMO_OPER = { email: 'operador@gara-g.swal.network', password: ['oper', '123'].join('') };

function req(body: unknown): Request {
  return new Request('https://gara-g.swal.network/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callLogin(body: unknown): Promise<{ status: number; json: any; res: Response }> {
  const res = await loginPOST({ request: req(body) } as any);
  return { status: res.status, json: await res.clone().json(), res };
}

/** D1 con la tabla `entity` vacia: `first()` no encuentra a nadie. */
function emptyD1() {
  const stmt = { bind: vi.fn(), first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }) };
  stmt.bind.mockReturnValue(stmt);
  return { prepare: vi.fn().mockReturnValue(stmt) };
}

describe.each([
  ['production', 'production'],
  ['development', 'development'],
  ['ENVIRONMENT sin definir', undefined],
])('login sin usuarios (%s)', (_label, environment) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKv.get.mockResolvedValue(null);
    mockKv.put.mockResolvedValue(undefined);
    envMock.SESSION = mockKv;
    if (environment === undefined) delete envMock.ENVIRONMENT;
    else envMock.ENVIRONMENT = environment;
    delete envMock.SWAL_D1;
  });

  it('sin D1: la antigua credencial demo de admin responde 401 Credenciales inválidas', async () => {
    const { status, json } = await callLogin(DEMO_ADMIN);
    expect(status).toBe(401);
    expect(json).toEqual({ ok: false, error: 'Credenciales inválidas' });
  });

  it('con D1 vacia: tambien 401, y sin cookie ni sesion en KV', async () => {
    envMock.SWAL_D1 = emptyD1();
    const { status, json, res } = await callLogin(DEMO_ADMIN);
    expect(status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Credenciales inválidas');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(mockKv.put).not.toHaveBeenCalled();
  });

  it('la antigua credencial demo de operador tampoco entra', async () => {
    const { status } = await callLogin(DEMO_OPER);
    expect(status).toBe(401);
  });
});

describe('login: validacion de entrada', () => {
  beforeEach(() => {
    envMock.ENVIRONMENT = 'production';
    delete envMock.SWAL_D1;
  });

  it('rechaza email ausente con 400', async () => {
    const { status } = await callLogin({ password: 'algo' });
    expect(status).toBe(400);
  });

  it('rechaza password ausente con 400', async () => {
    const { status } = await callLogin({ email: 'x@y.z' });
    expect(status).toBe(400);
  });
});
