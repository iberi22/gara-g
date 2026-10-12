/**
 * tests/stripe-webhook-route.test.ts — /api/webhooks/stripe con el modulo cloud APAGADO
 * (build publico). La ruta sigue detras de la sesion y, con sesion, responde 404
 * "cloud disabled". Con el modulo activo (GARA_CLOUD=1) la abre el middleware sin sesion: eso
 * lo prueba private/cloud/packages/app-pwa/tests/stripe-webhook-middleware.test.ts con el
 * handler real.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_PUBLIC_PATHS, cloud, isCloudPublicPath } from '../src/cloud';
import { onRequest } from '../src/middleware.js';
import { POST } from '../src/pages/api/webhooks/stripe';

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const envMock = env as unknown as Record<string, unknown>;

function ctx(cookie = '') {
  const url = 'https://gara-g.swal.network/api/webhooks/stripe';
  const jar = Object.fromEntries(
    cookie.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v),
  ) as Record<string, string>;
  return {
    url: new URL(url),
    request: new Request(url, {
      method: 'POST',
      body: '{"type":"customer.subscription.created"}',
      headers: { 'stripe-signature': 't=1,v1=00', ...(cookie ? { cookie } : {}) },
    }),
    cookies: { get: (k: string) => (jar[k] ? { value: jar[k] } : undefined) },
    locals: {} as Record<string, unknown>,
    redirect: (to: string, code: number) => new Response(null, { status: code, headers: { Location: to } }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockKv.get.mockResolvedValue(null);
  envMock.SESSION = mockKv;
  envMock.SWAL_KV = mockKv;
  delete envMock.SWAL_D1;
  delete envMock.DEV_ADMIN_SESSION;
  envMock.ENVIRONMENT = 'production';
});

describe('/api/webhooks/stripe sin modulo cloud', () => {
  it('el modulo activo en los tests es el local (apagado)', () => {
    expect(cloud.enabled).toBe(false);
  });

  it('la ruta solo se abre sin sesion con el modulo cloud activo', () => {
    expect(CLOUD_PUBLIC_PATHS).toEqual(['/api/webhooks/stripe']);
    expect(isCloudPublicPath('/api/webhooks/stripe')).toBe(false);
    expect(isCloudPublicPath('/api/webhooks/stripe', { enabled: true })).toBe(true);
    // Coincidencia exacta: ni subrutas ni prefijos.
    expect(isCloudPublicPath('/api/webhooks/stripe/x', { enabled: true })).toBe(false);
    expect(isCloudPublicPath('/api/webhooks', { enabled: true })).toBe(false);
  });

  it('sin sesion: 401 del middleware, el handler no se ejecuta', async () => {
    const handler = vi.fn(async () => new Response('handler', { status: 200 }));
    const res = await onRequest(ctx(), handler);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('con sesion: llega a la ruta, que responde 404 "cloud disabled"', async () => {
    mockKv.get.mockResolvedValue(
      JSON.stringify({ userId: 'usr_001', email: 'a@b.cl', role: 'admin', instanceId: 'flota-1', exp: Date.now() + 60_000 }),
    );
    const c = ctx('session=token-real');
    const res = await onRequest(c, () => POST(c));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'cloud disabled' });
  });
});
