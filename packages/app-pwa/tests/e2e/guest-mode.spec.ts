import { test, expect } from '@playwright/test';

/**
 * Modo invitado (sin cuenta). Sin sesion ni cookies: es lo que ve quien llega desde la landing.
 * El contenido del garage local es del frente del almacen local; aqui basta con que la pagina
 * cargue. No usa el fixture: la sesion de admin taparia justo lo que se prueba.
 */
test.describe('Modo invitado', () => {
  test('flujo completo: landing → modo local → garage → portada redirige → salir', async ({ page, context }) => {
    // En modo invitado el garage no pide /api/garage/*: si lo hiciera, esto lo delata.
    const garageApi: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/garage/')) garageApi.push(r.url()); });

    // 1. Sin nada, / es la landing.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('hero-section')).toBeVisible();

    // 2. El onboarding es publico. Se elige modo local y se desmarca el respaldo.
    await page.goto('/fleet/bienvenida');
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();
    await expect(page.getByTestId('wizard-step')).toContainText('1 / 6');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByTestId('storage-warning')).toBeVisible();
    await expect(page.getByTestId('backup-checkbox')).toBeChecked();
    await page.getByTestId('backup-checkbox').uncheck();
    await page.getByTestId('choose-local').click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByTestId('wizard-step')).toContainText('6 / 6');
    const garage = page.waitForResponse((r) => new URL(r.url()).pathname === '/fleet/garage');
    await page.getByRole('button', { name: 'Entrar' }).click();
    expect((await garage).status()).toBe(200);
    await expect(page).toHaveURL(/\/fleet\/garage/);

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'gara_mode')?.value).toBe('guest');
    expect(cookies.find((c) => c.name === 'gara_app')?.value).toBe('1');

    // 3. El banner de modo local es visible, con sus dos enlaces.
    await page.goto('/fleet/ajustes');
    const banner = page.getByTestId('guest-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Modo local: tus datos están solo en este navegador.');
    await expect(banner.getByRole('link', { name: 'Activar respaldo cifrado' })).toHaveAttribute('href', '/fleet/respaldo');
    await expect(banner.getByRole('link', { name: 'Entrar con cuenta' })).toHaveAttribute('href', '/login');

    // 4. Volver a la portada lleva al garage; con ?inicio=1 se ve la landing.
    await page.goto('/');
    await expect(page).toHaveURL(/\/fleet\/garage/);
    await page.goto('/?inicio=1');
    await expect(page).toHaveURL(/\/\?inicio=1/);
    await expect(page.getByTestId('hero-section')).toBeVisible();

    // 5. Una seccion que necesita cuenta explica por que.
    await page.goto('/fleet/vehicles');
    await expect(page).toHaveURL(/\/fleet\/cuenta-requerida\?from=\/fleet\/vehicles/);
    await expect(page.getByTestId('cuenta-requerida')).toBeVisible();
    await expect(page.getByTestId('cuenta-from')).toHaveText('/fleet/vehicles');
    await expect(page.getByTestId('cr-garage')).toHaveAttribute('href', '/fleet/garage');

    // 6. Salir del modo local borra la cookie, deja los datos y lleva a la landing.
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('exit-local')).toBeVisible();
    expect(garageApi, 'el garage invitado no debe pedir /api/garage/*').toEqual([]);
    await page.getByTestId('exit-local').click();
    await expect(page).toHaveURL(/\/\?inicio=1/);
    expect((await context.cookies()).find((c) => c.name === 'gara_mode')).toBeUndefined();
    // Sin modo local y sin sesion, el garage ya no abre.
    await page.goto('/fleet/garage');
    await expect(page).toHaveURL(/\/login/);
  });

  test('el menu muestra con candado lo que necesita cuenta, y el aviso se descarta por pestaña', async ({ page, context }) => {
    await context.addCookies([{ name: 'gara_mode', value: 'guest', url: (process.env.BASE_URL ?? 'http://localhost:4321') + '/' }]);
    await page.goto('/fleet/ajustes');
    const vehicles = page.getByTestId('nav-vehicles');
    await expect(vehicles).toHaveAttribute('data-locked', 'true');
    await expect(vehicles).toHaveAttribute('href', '/fleet/cuenta-requerida?from=/fleet/vehicles');
    await expect(page.getByTestId('nav-game')).not.toHaveAttribute('data-locked', 'true');
    await expect(page.getByTestId('about-link')).toHaveAttribute('href', '/?inicio=1');

    await page.getByTestId('guest-banner-close').click();
    await expect(page.getByTestId('guest-banner')).toBeHidden();
    await page.goto('/fleet/catalog');
    await expect(page.getByTestId('guest-banner')).toBeHidden();
  });

  test('una cookie de modo local no abre las APIs', async ({ context }) => {
    await context.addCookies([{ name: 'gara_mode', value: 'guest', url: (process.env.BASE_URL ?? 'http://localhost:4321') + '/' }]);
    for (const path of ['/api/fleet/vehicle', '/api/prefs']) {
      const res = await context.request.get(path);
      expect(res.status(), path).toBe(401);
    }
  });

  test('el login ofrece usar sin cuenta', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-guest-link').click();
    await expect(page).toHaveURL(/\/fleet\/bienvenida/);
  });
});
