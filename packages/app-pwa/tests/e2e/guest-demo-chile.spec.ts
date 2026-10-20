/**
 * guest-demo-chile.spec.ts — Recorrido del invitado para la demo del cliente chileno:
 * /fleet/bienvenida → modo local → garage con el camion de ejemplo (no "TU PARQUE ESTÁ
 * VACÍO") → vista de solo lectura de la flota `flota-demo-chile`, sin ningun redirect a /login.
 *
 * Sin sesion y sin el fixture de admin: es lo que ve un visitante que llega de la landing.
 * Corre en escritorio y en un viewport de movil.
 */
import { type Page, expect, test } from '@playwright/test';

const slow = expect.configure({ timeout: 45_000 });

const VIEWPORTS = [
  { name: 'escritorio', viewport: { width: 1366, height: 860 }, isMobile: false, hasTouch: false },
  { name: 'móvil', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
] as const;

/** Toda respuesta 3xx que mande a /login: el recorrido invitado no debe tener ninguna. */
function watchLoginRedirects(page: Page): string[] {
  const hits: string[] = [];
  page.on('response', (res) => {
    const loc = res.headers()['location'] ?? '';
    if (res.status() >= 300 && res.status() < 400 && loc.includes('/login')) hits.push(`${res.status()} ${new URL(res.url()).pathname} → ${loc}`);
  });
  return hits;
}

for (const vp of VIEWPORTS) {
  test.describe(`invitado → flota demo Chile (${vp.name})`, () => {
    test.use({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
    // Dev compila bajo demanda (three.js, islas): margen amplio.
    test.setTimeout(240_000);

    test('bienvenida → garage con el camión de ejemplo → flota demo de solo lectura', async ({ page, context }) => {
      const loginRedirects = watchLoginRedirects(page);
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      // 1. Asistente publico: elegir "este dispositivo" y entrar.
      await page.goto('/fleet/bienvenida');
      await slow(page.getByTestId('onboarding-wizard')).toBeVisible();
      await page.getByRole('button', { name: 'Siguiente' }).click();
      await page.getByTestId('backup-checkbox').uncheck();
      await page.getByTestId('choose-local').click();
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
      await expect(page.getByTestId('wizard-step')).toContainText('6 / 6');
      const garage = page.waitForResponse((r) => new URL(r.url()).pathname === '/fleet/garage');
      await page.getByRole('button', { name: 'Entrar' }).click();
      expect((await garage).status()).toBe(200);
      await expect(page).toHaveURL(/\/fleet\/garage/);
      expect((await context.cookies()).find((c) => c.name === 'gara_mode')?.value).toBe('guest');

      // 2. El garage abre con el camión de ejemplo, no vacío.
      await slow(page.getByText('ZZBC-11').first()).toBeVisible();
      await expect(page.getByText('TU PARQUE ESTÁ VACÍO')).toBeHidden();

      // 3. Desde el garage, a la flota demo de solo lectura.
      const fleetRes = page.waitForResponse((r) => new URL(r.url()).pathname === '/fleet/garage/flota-demo-chile');
      await page.getByTestId('guest-demo-fleet').click();
      expect((await fleetRes).status()).toBe(200);
      await slow(page).toHaveURL(/\/fleet\/garage\/flota-demo-chile$/);

      const fleet = page.getByTestId('demo-fleet-chile');
      await slow(fleet).toBeVisible();
      await expect(page.getByTestId('demo-fleet-readonly')).toContainText('no permite editar');
      await expect(page.getByTestId('demo-kpi-vehicles')).toHaveText('10');
      await expect(page.getByTestId('demo-kpi-drivers')).toHaveText('8');
      await expect(page.getByTestId('demo-vehicles').locator('tbody tr')).toHaveCount(10);
      await expect(page.getByTestId('demo-vehicles')).toContainText('ZZBC-11');
      await expect(page.getByTestId('demo-drivers').locator('tbody tr')).toHaveCount(8);
      await expect(page.getByTestId('demo-geofences').locator('li')).toHaveCount(3);
      await expect(page.getByTestId('demo-geofences')).toContainText('Calama');
      await expect(page.getByTestId('demo-documents')).toContainText('Por vencer');

      // Solo lectura: ni formularios ni botones de escritura en la vista.
      await expect(fleet.locator('form, input, select, textarea')).toHaveCount(0);
      await expect(fleet.getByRole('button')).toHaveCount(0);

      // Movil: la pagina no desborda en horizontal (las tablas hacen scroll dentro de su caja).
      if (vp.isMobile) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      }

      // Volver al garage sigue en modo local. La vuelta va por el ClientRouter y
      // rehidrata el garage 3D (WebGL por software en CI): timeout amplio.
      await page.getByTestId('demo-fleet-back').click();
      await slow(page).toHaveURL(/\/fleet\/garage$/);

      expect(loginRedirects, 'redirecciones a /login en el recorrido invitado').toEqual([]);
      expect(pageErrors, 'errores de pagina').toEqual([]);
    });
  });
}
