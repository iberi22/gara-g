/**
 * tests/mesh-ice-api.test.ts — GET /api/mesh/ice: servidores ICE/TURN de la malla.
 *
 * Contrato: siempre 200, no-store; sin secretos / limitador que dice no / error o timeout del
 * upstream -> solo STUN con relay:false; con upstream bueno, sus iceServers y el ttl; el token
 * de la API de TURN nunca sale en la respuesta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { GET, ICE_TTL_SECONDS, STUN_ONLY } from '../src/pages/api/mesh/ice';

const envMock = env as unknown as Record<string, unknown>;
const TOKEN = 'turn-api-token-FIXTURE-1234567890';
const UPSTREAM = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' },
];

const call = async (ip = '1.2.3.4') => {
  const res = await GET({ request: new Request('https://gara-g.swal.network/api/mesh/ice', { headers: { 'cf-connecting-ip': ip } }) } as any);
  return { res, text: await res.clone().text(), body: (await res.json()) as any };
};
const upstreamOk = () =>
  vi.fn(async () => new Response(JSON.stringify({ iceServers: UPSTREAM }), { status: 201 }));

beforeEach(() => {
  envMock.TURN_KEY_ID = 'key-id-1';
  envMock.TURN_KEY_API_TOKEN = TOKEN;
  delete envMock.MESH_ICE_LIMITER;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete envMock.TURN_KEY_ID;
  delete envMock.TURN_KEY_API_TOKEN;
  delete envMock.MESH_ICE_LIMITER;
});

describe('/api/mesh/ice', () => {
  it('sin secretos: STUN publico de Cloudflare, relay:false, sin llamar a nadie', async () => {
    delete envMock.TURN_KEY_ID;
    delete envMock.TURN_KEY_API_TOKEN;
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.iceServers).toEqual(STUN_ONLY);
    expect(body.iceServers[0].urls).toBe('stun:stun.cloudflare.com:3478');
    expect(body.relay).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('con upstream: devuelve sus iceServers, ttl de 1 h y relay:true; pide con Bearer y ttl', async () => {
    const f = upstreamOk();
    vi.stubGlobal('fetch', f);
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ ok: true, iceServers: UPSTREAM, ttl: ICE_TTL_SECONDS, relay: true });
    expect(ICE_TTL_SECONDS).toBe(3600);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-id-1/credentials/generate-ice-servers');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ ttl: ICE_TTL_SECONDS });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('el token de la API nunca aparece en la respuesta', async () => {
    vi.stubGlobal('fetch', upstreamOk());
    for (const mk of [() => upstreamOk(), () => vi.fn(async () => new Response('x', { status: 500 }))]) {
      vi.stubGlobal('fetch', mk());
      const { text, res } = await call();
      expect(text).not.toContain(TOKEN);
      expect(JSON.stringify([...res.headers])).not.toContain(TOKEN);
    }
  });

  it('error del upstream (5xx, 401), red caida, timeout o JSON roto: STUN-only, nunca 5xx', async () => {
    const cases = [
      vi.fn(async () => new Response('boom', { status: 500 })),
      vi.fn(async () => new Response('no', { status: 401 })),
      vi.fn(async () => { throw new TypeError('network'); }),
      vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }),
      vi.fn(async () => new Response('<html>', { status: 201 })),
      vi.fn(async () => new Response(JSON.stringify({ iceServers: 'x' }), { status: 201 })),
    ];
    for (const f of cases) {
      vi.stubGlobal('fetch', f);
      const { res, body, text } = await call();
      expect(res.status).toBe(200);
      expect(body.iceServers).toEqual(STUN_ONLY);
      expect(body.relay).toBe(false);
      expect(text).not.toContain(TOKEN);
    }
  });

  it('limitador que dice no: STUN-only sin llamar a Cloudflare; con si: pasa; clave = IP', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    envMock.MESH_ICE_LIMITER = { limit };
    const f = upstreamOk();
    vi.stubGlobal('fetch', f);
    const denied = await call('9.9.9.9');
    expect(denied.res.status).toBe(200);
    expect(denied.body.relay).toBe(false);
    expect(denied.body.iceServers).toEqual(STUN_ONLY);
    expect(limit).toHaveBeenCalledWith({ key: '9.9.9.9' });
    expect(f).not.toHaveBeenCalled();

    limit.mockResolvedValue({ success: true });
    expect((await call('9.9.9.9')).body.relay).toBe(true);
  });

  it('un limitador que lanza tambien cae a STUN-only', async () => {
    envMock.MESH_ICE_LIMITER = { limit: vi.fn(async () => { throw new Error('x'); }) };
    vi.stubGlobal('fetch', upstreamOk());
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(body.relay).toBe(false);
  });

  it('descarta entradas sin forma de RTCIceServer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ iceServers: [null, { urls: 5 }, { foo: 1 }, UPSTREAM[1]] }), { status: 201 })));
    const { body } = await call();
    expect(body.iceServers).toEqual([UPSTREAM[1]]);
  });
});
