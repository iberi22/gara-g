import { test, expect } from '@playwright/test';
import { PUBLIC_DEMO } from './helpers/features';

/**
 * E2E tests for middleware auth-gate (W13.6 fix-middleware-authgate).
 *
 * El comportamiento de /fleet* depende del modo demo del ENTORNO (PUBLIC_DEMO):
 * con el flag apagado exige sesión (303 a /login); con el flag encendido sirve
 * /fleet* sin sesión (200). Cada prueba declara el modo que la corre y se salta
 * con motivo cuando la suite corre en el otro: nunca asume uno solo.
 *
 * El bypass por query/header (?public_demo=true) está cerrado desde el incidente
 * del 2026-10-01; se conserva una regresión que lo comprueba en modo sin demo.
 */
test.describe('Auth Gate Middleware & PUBLIC_DEMO', () => {
  test('PUBLIC_DEMO apagado: /fleet/vehicles sin sesión redirige a /login', async ({ request }) => {
    test.skip(PUBLIC_DEMO, 'PUBLIC_DEMO encendido: /fleet* es de acceso público demo');
    const response = await request.get('/fleet/vehicles', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = response.headers()['location'] || '';
    expect(location).toContain('/login');
    expect(location).toContain('redirect');
  });

  test('PUBLIC_DEMO encendido: /fleet/vehicles sin sesión se sirve (200) sin mandar a /login', async ({ request }) => {
    test.skip(!PUBLIC_DEMO, 'PUBLIC_DEMO apagado: /fleet* exige sesión');
    const response = await request.get('/fleet/vehicles', { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()['location']).toBeUndefined();
  });

  test('la query public_demo=true NO abre /fleet por sí sola (bypass cerrado)', async ({ request }) => {
    test.skip(PUBLIC_DEMO, 'el modo demo del entorno ya abre /fleet*; aquí se prueba que la query no manda');
    const response = await request.get('/fleet/vehicles?public_demo=true', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location'] || '').toContain('/login');
  });

  test('AI tier gate: /api/ai/infer returns 402 for free/unauthenticated requests', async ({ request }) => {
    const response = await request.post('/api/ai/infer', {
      data: { prompt: 'Test telemetry analysis' },
    });
    expect(response.status()).toBe(402);
    const body = await response.json().catch(() => ({}));
    expect(body.code).toBe(402);
  });

  test('AI tier gate: /api/ai/infer returns 402 with ?public_demo=true', async ({ request }) => {
    const response = await request.post('/api/ai/infer?public_demo=true', {
      data: { prompt: 'Test telemetry analysis' },
    });
    expect(response.status()).toBe(402);
    const body = await response.json().catch(() => ({}));
    expect(body.code).toBe(402);
  });
});
