import { test, expect } from '@playwright/test';
import { ADMIN_SESSION_TOKEN, authCookieUrl, DEV_ADMIN_USER_ID } from './helpers/auth';

/**
 * Onboarding y ajustes de interfaz.
 * Sesion admin SIN la cookie `gara_onb` (a proposito: es lo que ve un usuario nuevo), asi que
 * no usa el fixture ni useAdminSession, que la ponen.
 */
test.describe('Onboarding y ajustes de interfaz', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'session', value: ADMIN_SESSION_TOKEN, url: authCookieUrl() }]);
  });

  test('primer acceso: /fleet lleva al asistente; "Mi vehículo" filtra el menú', async ({ page, context }) => {
    // Un usuario nuevo: sin preferencias guardadas (el servidor de dev las conserva entre corridas).
    const reset = await context.request.put('/api/prefs', { data: { prefs: {} } });
    expect(reset.ok()).toBe(true);
    await page.goto('/fleet');
    await expect(page).toHaveURL(/\/fleet\/bienvenida/);
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // Con sesion ya es la nube: bienvenida, perfil, menu, paneles y listo, sin elegir donde guardar.
    await expect(page.getByTestId('wizard-step')).toContainText('1 / 5');
    await expect(page.getByTestId('wizard-free')).toHaveText('Sin cobro · 3 piden cuenta');
    await expect(page.getByTestId('feature-garage')).toBeVisible();
    await expect(page.getByTestId('step-storage')).toHaveCount(0);
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: /^Mi vehículo Una moto/ }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByTestId('wizard-step')).toContainText('5 / 5');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await page.waitForURL(/\/fleet\/?$/);
    await expect(page.getByTestId('nav-vehicles')).toBeVisible();
    await expect(page.getByTestId('nav-drivers')).toBeHidden();
  });

  test('necesidades: "Conductores" y "Rastreo en vivo" arman el menú y el resumen lo explica', async ({ page, context }) => {
    const reset = await context.request.put('/api/prefs', { data: { prefs: {} } });
    expect(reset.ok()).toBe(true);
    await page.goto('/fleet/bienvenida');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByTestId('need-drivers').click();
    await page.getByTestId('need-live').click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByTestId('wizard-step')).toContainText('5 / 5');
    await expect(page.getByTestId('sum-reasons')).toContainText('Conductores');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await page.waitForURL(/\/fleet\/?$/);
    await expect(page.getByTestId('nav-drivers')).toBeVisible();
    await expect(page.getByTestId('nav-tracking')).toBeVisible();
    await expect(page.getByTestId('nav-fuel')).toBeHidden();
    await expect(page.getByTestId('nav-fleets')).toBeHidden();
  });

  test('con sesion /fleet/bienvenida no ofrece modo local ni deja cookie de invitado', async ({ page, context }) => {
    await page.goto('/fleet/bienvenida?again=1');
    await expect(page.getByTestId('wizard-step')).toContainText('1 / 5');
    await page.getByRole('button', { name: 'Omitir' }).click();
    await page.waitForURL(/\/fleet\/?$/);
    expect((await context.cookies()).find((c) => c.name === 'gara_mode')).toBeUndefined();
    await expect(page.getByTestId('guest-banner')).toHaveCount(0);
    await expect(page.getByTestId('nav-vehicles')).not.toHaveAttribute('data-locked', 'true');
  });

  test('ajustes: apagar "Combustible" lo quita del menú tras recargar', async ({ page, context }) => {
    await context.addCookies([{ name: 'gara_onb', value: DEV_ADMIN_USER_ID, url: authCookieUrl() }]);
    await page.goto('/fleet/ajustes');
    const sw = page.getByRole('switch', { name: /Combustible/ });
    await expect(sw).toBeVisible();
    if (!(await sw.isChecked())) await sw.check();
    await sw.uncheck();
    await expect(page.getByTestId('settings-status')).toContainText(/Guardado/);

    await page.reload();
    await expect(page.getByTestId('nav-vehicles')).toBeVisible();
    await expect(page.getByTestId('nav-fuel')).toBeHidden();

    // Deja el estado limpio para otros specs.
    await page.getByRole('button', { name: 'Restablecer valores por defecto' }).click();
    await expect(page.getByTestId('settings-status')).toContainText(/Guardado/);
  });
});
