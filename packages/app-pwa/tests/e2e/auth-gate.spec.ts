import { test, expect } from '@playwright/test';

/**
 * E2E tests for middleware auth-gate (W13.6 fix-middleware-authgate).
 *
 * Validates:
 * 1. Default (PUBLIC_DEMO flag off): unauthenticated GET /fleet/vehicles redirects to /login?redirect=%2Ffleet%2Fvehicles.
 * 2. PUBLIC_DEMO flag on (via query public_demo=true or header): unauthenticated GET /fleet/vehicles?public_demo=true returns 200.
 * 3. AI Inference Tier Gate (/api/ai/infer): returns HTTP 402 Payment Required for free/unauthenticated requests in both default and public_demo modes.
 */

test.describe('Auth Gate Middleware & PUBLIC_DEMO', () => {
  test('default (flag off): unauthenticated /fleet/vehicles redirects to /login', async ({ request }) => {
    const response = await request.get('/fleet/vehicles', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = response.headers()['location'] || '';
    expect(location).toContain('/login');
    expect(location).toContain('redirect');
  });

  test('public demo enabled (flag on): unauthenticated /fleet/vehicles?public_demo=true returns 200', async ({ request }) => {
    const response = await request.get('/fleet/vehicles?public_demo=true');
    expect(response.status()).toBe(200);
  });

  test('AI tier gate: /api/ai/infer returns 402 for free/unauthenticated requests with flag off', async ({ request }) => {
    const response = await request.post('/api/ai/infer', {
      data: { prompt: 'Test telemetry analysis' },
    });
    expect(response.status()).toBe(402);
    const body = await response.json().catch(() => ({}));
    expect(body.code).toBe(402);
  });

  test('AI tier gate: /api/ai/infer returns 402 for free/unauthenticated requests with flag on', async ({ request }) => {
    const response = await request.post('/api/ai/infer?public_demo=true', {
      data: { prompt: 'Test telemetry analysis' },
    });
    expect(response.status()).toBe(402);
    const body = await response.json().catch(() => ({}));
    expect(body.code).toBe(402);
  });
});
