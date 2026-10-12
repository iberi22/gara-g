import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = env as unknown as Record<string, unknown>;

/**
 * Verificado contra el Xavier real (localhost:8006) el 2026-09-30:
 *   X-Xavier-Token: <XAVIER_TOKEN>  -> 200 con resultados
 *   X-API-Key:      <XAVIER_TOKEN>  -> 401 Unauthorized
 *   Authorization:  Bearer <...>    -> 401 Unauthorized
 *
 * Es decir: el header que acepta es X-Xavier-Token, no X-API-Key. Por eso el
 * secret se llama XAVIER_API_KEY aunque viaje en X-Xavier-Token.
 */
async function loadSearch() {
  const { POST } = await import('../src/pages/api/xavier/search.js');
  return POST;
}

// Sesion obligatoria desde el 2026-10-01: sin cookie, search responde 401 antes
// de tocar fetch. Aqui se simula una sesion admin valida para poder observar los
// headers que salen hacia Xavier.
const SESSION_TOKEN = 'tok-de-prueba';
const mockKvGet = vi.fn(async (key: string) =>
  key === `token:${SESSION_TOKEN}`
    ? JSON.stringify({
        userId: 'usr_test',
        email: 'test@gara-g.swal.network',
        role: 'admin',
        instanceId: 'gara-g-default-instance',
        exp: Date.now() + 3_600_000,
      })
    : null,
);

const apiCtx = (body = JSON.stringify({ query: 'prueba' })) =>
  ({
    request: new Request('https://gara-g.swal.network/api/xavier/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    cookies: { get: (name: string) => (name === 'session' ? { value: SESSION_TOKEN } : undefined) },
  }) as any;

/** Headers que el proxy envia a Xavier. */
function sentHeaders(spy: any): Record<string, string> {
  return (spy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
}

describe('proxy de Xavier: el header de autenticacion que Xavier acepta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.SESSION = { get: mockKvGet, put: vi.fn(), delete: vi.fn() } as any;
    vi.restoreAllMocks();
    envMock.XAVIER_URL = 'http://localhost:8006';
    envMock.XAVIER_API_KEY = 'token-de-prueba';
  });

  it('envia X-Xavier-Token, que es el unico que acepta Xavier', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"results":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const search = await loadSearch();
    await search(apiCtx());

    expect(sentHeaders(spy)['X-Xavier-Token']).toBe('token-de-prueba');
  });

  it('NO manda solo X-API-Key, que Xavier rechaza con 401', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );

    const search = await loadSearch();
    await search(apiCtx());

    const h = sentHeaders(spy);
    // Puede mandarlos como fallback, pero nunca SOLO esos.
    const tieneElBueno = Boolean(h['X-Xavier-Token']);
    const soloLosMalos = !tieneElBueno && Boolean(h['X-API-Key'] || h.Authorization);
    expect(soloLosMalos).toBe(false);
  });

  it('propaga el 401 de Xavier cuando la key no vale', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const search = await loadSearch();
    const res = await search(apiCtx());
    expect(res.status).toBe(401);
  });

  it('sin secret no manda ningun header de credencial', async () => {
    envMock.XAVIER_API_KEY = undefined;
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );

    const search = await loadSearch();
    await search(apiCtx());

    const h = sentHeaders(spy);
    expect(h['X-Xavier-Token']).toBeUndefined();
    expect(h['X-API-Key']).toBeUndefined();
    expect(h.Authorization).toBeUndefined();
  });
});
