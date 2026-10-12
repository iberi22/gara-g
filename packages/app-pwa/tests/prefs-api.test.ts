/**
 * tests/prefs-api.test.ts — GET/PUT /api/prefs: preferencias por usuario y tenant.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { GET, PUT } from '../src/pages/api/prefs';
import { GARA_PREFS_SCHEMA } from '../src/lib/prefs.config';

const envMock = env as unknown as Record<string, unknown>;
const SESSIONS: Record<string, { userId: string; instanceId: string }> = {
  'tok-ana': { userId: 'usr_ana', instanceId: 'tenant-a' },
  'tok-beto': { userId: 'usr_beto', instanceId: 'tenant-a' },
  'tok-ana-b': { userId: 'usr_ana', instanceId: 'tenant-b' },
};

function ctx(token: string | null, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.cookie = `session=${token}`;
  const request = new Request('https://gara-g.swal.network/api/prefs', {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const s = token ? SESSIONS[token] : undefined;
  return { request, locals: s ? { tenant: { instanceId: s.instanceId } } : {} } as any;
}

beforeEach(() => {
  envMock.ENVIRONMENT = 'production';
  envMock.SESSION = {
    get: vi.fn(async (key: string) => {
      const s = SESSIONS[key.replace('token:', '')];
      return s ? JSON.stringify({ ...s, email: 'x@y.z', role: 'observer', exp: Date.now() + 60_000 }) : null;
    }),
    delete: vi.fn(),
  };
});

describe('/api/prefs', () => {
  it('sin sesion responde 401', async () => {
    expect((await GET(ctx(null))).status).toBe(401);
    expect((await PUT(ctx(null, 'PUT', { prefs: {} }))).status).toBe(401);
  });

  it('GET sin nada guardado devuelve los defaults sin onboarding', async () => {
    const data = await (await GET(ctx('tok-beto'))).json();
    expect(data.prefs.onboarded).toBe(false);
    expect(data.prefs.modules.dashboard).toBe(true);
    expect(data.prefs.version).toBe(GARA_PREFS_SCHEMA.version);
  });

  it('PUT guarda, valida y fija la cookie de onboarding; GET la devuelve', async () => {
    const res = await PUT(
      ctx('tok-ana', 'PUT', {
        prefs: { version: GARA_PREFS_SCHEMA.version, onboarded: true, modules: { fuel: false, dashboard: false, hack: true }, panels: { shop: { enabled: false } } },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^gara_onb=usr_ana;.*HttpOnly; Secure/);
    const back = await (await GET(ctx('tok-ana'))).json();
    expect(back.prefs.modules.fuel).toBe(false);
    expect(back.prefs.modules.dashboard).toBe(true); // required
    expect('hack' in back.prefs.modules).toBe(false);
    expect(back.prefs.panels.shop.enabled).toBe(false);
    expect(back.prefs.onboarded).toBe(true);
  });

  it('las preferencias son por usuario y por tenant', async () => {
    await PUT(ctx('tok-ana', 'PUT', { prefs: { version: GARA_PREFS_SCHEMA.version, modules: { tracking: false } } }));
    expect((await (await GET(ctx('tok-beto'))).json()).prefs.modules.tracking).toBe(true);
    expect((await (await GET(ctx('tok-ana-b'))).json()).prefs.modules.tracking).toBe(true);
  });

  it('sin onboarded no fija cookie', async () => {
    const res = await PUT(ctx('tok-beto', 'PUT', { prefs: { modules: { fuel: false } } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rechaza JSON roto, cuerpos sin prefs y cuerpos enormes', async () => {
    expect((await PUT(ctx('tok-ana', 'PUT', '{nope'))).status).toBe(400);
    expect((await PUT(ctx('tok-ana', 'PUT', { other: 1 }))).status).toBe(400);
    expect((await PUT(ctx('tok-ana', 'PUT', { prefs: { pad: 'x'.repeat(20_000) } }))).status).toBe(413);
  });
});
