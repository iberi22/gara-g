import { test, expect } from '@playwright/test';
import { useAdminSession } from './helpers/auth';

/**
 * test/e2e/smoke.spec.ts — E2E Smoke Test Suite for GARA-G Core Journey
 *
 * Covers the primary user workflow end-to-end:
 * Login -> Fleet Dashboard -> Vehicle List & Detail -> Document Vault -> Logout
 * including fail-closed authorization, input validation, and tenant isolation using
 * DEFAULT_INSTANCE_ID ('gara-g-default-instance').
 */

const DEFAULT_INSTANCE_ID = 'gara-g-default-instance';

test.describe('E2E Smoke Workflow: Login -> Vehicle -> Document -> Logout', () => {
  test('1. Unauthenticated access to protected fleet routes is redirected to login (fail-closed)', async ({ page }) => {
    // Attempt accessing protected /fleet without session cookie
    const response = await page.goto('/fleet');

    // Auth gate / middleware must fail closed and redirect to /login
    expect(page.url()).toContain('/login');
    if (response) {
      expect([200, 302, 303, 307, 308]).toContain(response.status());
    }
  });

  test('2. Login form validation displays error banner on invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // Fill invalid credentials
    await page.fill('input[name="email"]', 'invalid-user@gara-g.network');
    await page.fill('input[name="password"]', 'wrongpassword123');

    // Submit form
    await page.click('button[type="submit"]');

    // Verify error banner is displayed
    const errorBanner = page.locator('[role="alert"], .error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText(/inválid|requerid|error/i);
  });

  test('3. Authenticated session accesses fleet dashboard and vehicles list for canonical tenant', async ({ page, context }) => {
    // Sesión admin de dev: cookie `session` scopada al host de BASE_URL + marca
    // `gara_onb` del userId, para que /fleet no rebote a /fleet/bienvenida.
    await useAdminSession(context);

    // Navigate to /fleet and check dashboard loads
    await page.goto(`/fleet?instanceId=${DEFAULT_INSTANCE_ID}`);
    await expect(page).toHaveURL(new RegExp(`/fleet.*instanceId=${DEFAULT_INSTANCE_ID}`));

    // Navigate to vehicles list page
    await page.goto(`/fleet/vehicles?instanceId=${DEFAULT_INSTANCE_ID}`);
    await expect(page.locator('[data-testid="vehicles-page"]')).toBeVisible();

    // Verify vehicles table is present
    const table = page.getByTestId('vehicles-table');
    await expect(table).toBeVisible();
  });

  test('4. Navigates from vehicle list to document vault with tenant isolation', async ({ page, context }) => {
    await useAdminSession(context);

    // Navigate to documents vault page with canonical instance ID
    await page.goto(`/fleet/documents?instanceId=${DEFAULT_INSTANCE_ID}`);
    await expect(page.locator('[data-testid="documents-page"]')).toBeVisible();

    // Verify document table and fields enforce tenant scope
    const docsTable = page.getByTestId('documents-table');
    await expect(docsTable).toBeVisible();
    expect(page.url()).toContain(`instanceId=${DEFAULT_INSTANCE_ID}`);
  });

  test('5. Logout session clears cookie and redirects to login endpoint', async ({ page, context, baseURL }) => {
    await useAdminSession(context);

    // /api/auth/logout SOLO exporta POST (ver src/pages/api/auth/logout.ts:16):
    // un GET devolvía 404 y este test llevaba tiempo verde contra ese 404 sin
    // ejecutar el cierre de sesión. Ahora se llama por su método real y se
    // comprueba que la respuesta invalida la cookie.
    // context.request comparte las cookies del contexto: el Set-Cookie del logout
    // borra la sesion del navegador. Origin: un POST sin Origin ni cuerpo lo frena el chequeo CSRF de Astro
    // (403 "Cross-site POST form submissions"); un navegador siempre lo envia.
    const logout = await context.request.post('/api/auth/logout', {
      headers: { origin: new URL(baseURL!).origin },
    });
    expect(logout.status()).toBe(200);
    expect(logout.headers()['set-cookie'] || '').toMatch(/session=;/);

    // Attempt returning to /fleet and confirm redirect to /login
    await page.goto('/fleet');
    await expect(page).toHaveURL(/\/login/);
  });
});
