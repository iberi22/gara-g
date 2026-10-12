import { env } from 'cloudflare:workers';
/**
 * tests/xavier-proxy.test.ts — la memoria de agentes debe salir del navegador.
 *
 * Contexto: src/lib/xavier.ts apunta a `http://localhost:8006` y xavierSync.ts hace
 * `fetch(syncUrl)` desde el navegador. El navegador del usuario final (en Santiago,
 * o en una voleadora) no resuelve localhost:8006, así que la memoria de agentes nunca
 * llegaba a Xavier en producción: el código existía, el flujo no.
 *
 * El fix es un proxy server-side en el Worker. Estos tests fijan su contrato.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as add } from '../src/pages/api/xavier/add.js';
import { GET as health } from '../src/pages/api/xavier/health.js';
import { POST as search } from '../src/pages/api/xavier/search.js';

const envMock = env as unknown as Record<string, unknown>;

// Import estatico a proposito: con import() dinamico + resetModules() el `env` que ve
// el proxy recargado no es el mismo objeto que este import, y todo devolvia 503.

// La sesion es obligatoria desde el 2026-10-01: search exige sesion y add exige
// ademas rol admin (ver tests/xavier-proxy-locked.test.ts). Estos tests miden el
// transporte a Xavier, asi que se simula una sesion valida.
const SESSION_TOKEN = 'tok-de-prueba';
const mockKvGet = vi.fn(async (key: string) => {
  if (key === `token:${SESSION_TOKEN}`) {
    return JSON.stringify({
      userId: 'usr_test',
      email: 'test@gara-g.swal.network',
      role: 'admin',
      instanceId: 'gara-g-default-instance',
      exp: Date.now() + 3_600_000,
    });
  }
  return null;
});
const mockKvPut = vi.fn();
const mockKvDelete = vi.fn();

const apiCtx = (body = '{}', method = 'POST') =>
  ({
    request: new Request('https://gara-g.swal.network/api/xavier/search', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : body,
    }),
    cookies: { get: (name: string) => (name === 'session' ? { value: SESSION_TOKEN } : undefined) },
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  envMock.SESSION = { get: mockKvGet, put: mockKvPut, delete: mockKvDelete } as any;
  envMock.XAVIER_URL = 'https://xavier.swal.network';
  envMock.XAVIER_API_KEY = 'test-key';
});

describe('proxy de Xavier: configuracion', () => {
  it('search responde 503 si XAVIER_URL no esta configurado', async () => {
    delete envMock.XAVIER_URL;
    const res = await search(apiCtx(JSON.stringify({ query: 'prueba' })));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('XAVIER_URL');
  });

  it('health responde 503 si XAVIER_URL no esta configurado', async () => {
    delete envMock.XAVIER_URL;
    const res = await health(apiCtx(undefined, 'GET'));
    expect(res.status).toBe(503);
  });
});

describe('proxy de Xavier: search', () => {
  it('reenvia el cuerpo a /v1/memories/search', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [{ id: 'm1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await search(apiCtx(JSON.stringify({ query: 'mantenimientos', limit: 5 })));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://xavier.swal.network/v1/memories/search');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('mantenimientos');
    expect(res.status).toBe(200);
  });

  it('envia la API key de Xavier cuando esta configurada', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );

    await search(apiCtx(JSON.stringify({ query: 'x' })));

    const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(JSON.stringify(headers)).toContain('test-key');
  });

  it('propaga el codigo de error de Xavier (401 sin credenciales)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await search(apiCtx(JSON.stringify({ query: 'prueba' })));
    expect(res.status).toBe(401);
  });

  it('devuelve 502 si Xavier es inalcanzable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const res = await search(apiCtx(JSON.stringify({ query: 'prueba' })));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe('proxy de Xavier: add y health', () => {
  it('add reenvia a /v1/memories', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await add(
      apiCtx(JSON.stringify({ text: 'vehiculo AB1234 al taller', kind: 'episodic' })),
    );

    expect(fetchSpy.mock.calls[0][0]).toBe('https://xavier.swal.network/v1/memories');
    expect(res.status).toBe(200);
  });

  it('health consulta /health en modo GET', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, service: 'xaviercloud' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await health(apiCtx(undefined, 'GET'));

    expect(fetchSpy.mock.calls[0][0]).toBe('https://xavier.swal.network/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
