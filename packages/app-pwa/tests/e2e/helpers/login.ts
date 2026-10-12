import { type Page, expect } from '@playwright/test';

/**
 * helpers/login.ts — Sesion para los specs que antes iniciaban sesion con la cuenta demo
 * (admin@gara-g.swal.network + contrasena conocida). Esa cuenta ya no existe: el login solo
 * acepta usuarios de D1 (PR #1052). Aqui no se escribe ninguna credencial.
 *
 * - Con E2E_USER_EMAIL y E2E_USER_PASSWORD en el entorno: login REAL por el formulario con el
 *   usuario que crea `scripts/seed-demo-chile.mjs --e2e-user` en la D1 del entorno (staging o
 *   una D1 local). Es el modo de BASE_URL=https://... contra un despliegue.
 * - Sin ellas (dev local, sin D1): no hay usuario con el que iniciar sesion; se usa la sesion
 *   de desarrollo que ya pone el fixture (`useAdminSession`, solo valida fuera de produccion)
 *   y se comprueba que de verdad abre /fleet en vez de rebotar a /login.
 */
export function e2eCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  return email && password ? { email, password } : null;
}

export async function loginAsE2EUser(page: Page): Promise<void> {
  const creds = e2eCredentials();
  if (creds) {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(creds.email);
    await page.locator('input[name="password"]').fill(creds.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => url.pathname.startsWith('/fleet'), { timeout: 30_000 });
    return;
  }
  await page.goto('/fleet/vehicles');
  await page.waitForLoadState('domcontentloaded');
  await expect(page, 'sin E2E_USER_* el fixture debe dar sesion de desarrollo').not.toHaveURL(/\/login/);
}
