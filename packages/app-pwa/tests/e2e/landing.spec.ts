import { test, expect } from './fixtures';

/**
 * E2E Spec: Portada pública de GARA-G
 * Cobertura:
 * - Hero con la propuesta, "100 % gratis" y los dos CTA
 * - Qué ofrece, "gratis de verdad", modos de datos y FAQ
 * - Que la sección de precios vieja (Socio / PAYG) ya no aparece
 * - Sin desbordes horizontales en teléfono
 */

test.describe('Portada pública GARA-G', () => {
  test('muestra el hero, las secciones y los CTA', async ({ page }) => {
    await page.goto('/?inicio=1');

    await expect(page.getByTestId('hero-section')).toBeVisible();
    const title = page.getByTestId('hero-title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('taller digital');
    await expect(page.getByTestId('hero-section')).toContainText('100 % gratis');

    const start = page.getByTestId('cta-start');
    await expect(start).toBeVisible();
    await expect(start).toHaveText(/Empezar gratis, sin cuenta/);
    await expect(start).toHaveAttribute('href', '/fleet/bienvenida');

    const login = page.getByTestId('cta-login');
    await expect(login).toBeVisible();
    await expect(login).toHaveText(/Entrar con mi cuenta/);
    await expect(login).toHaveAttribute('href', '/login');

    await expect(page.getByTestId('features-section')).toBeVisible();
    await expect(page.getByTestId('group-vehiculo')).toBeVisible();
    await expect(page.getByTestId('group-flota')).toBeVisible();
    await expect(page.getByTestId('group-todos')).toBeVisible();
    await expect(page.getByTestId('feature-garage-3d')).toBeVisible();

    await expect(page.getByTestId('free-section')).toBeVisible();
    await expect(page.getByTestId('data-modes-section')).toBeVisible();
    await expect(page.getByTestId('mode-local')).toContainText('solo en este navegador');
    await expect(page.getByTestId('mode-e2ee')).toContainText('nadie puede recuperar');
    await expect(page.getByTestId('faq-section')).toBeVisible();
    await expect(page.getByTestId('landing-footer')).toBeVisible();
  });

  test('ya no ofrece planes ni cuenta pública', async ({ page }) => {
    await page.goto('/?inicio=1');
    await expect(page.getByTestId('pricing-section')).toHaveCount(0);
    await expect(page.getByTestId('plan-socio')).toHaveCount(0);
    await expect(page.getByTestId('plan-payg')).toHaveCount(0);
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/Socio|PAYG|P2P|Yjs|Crear cuenta/);
  });

  test('el FAQ se abre y dice la verdad sobre el modo sin conexión', async ({ page }) => {
    await page.goto('/?inicio=1');
    const offline = page.locator('details', { hasText: '¿Funciona sin internet?' });
    await expect(offline.locator('p')).toBeHidden();
    await offline.locator('summary').click();
    await expect(offline.locator('p')).toBeVisible();
    // #10 entrego la app shell: el HTML y los datos locales ya se sirven sin red, asi que la
    // FAQ ya no puede decir "Todavia no" (era lo que afirmaba y lo desmentia la propia app).
    await expect(offline.locator('p')).not.toContainText('Todavía no');
    await expect(offline.locator('p')).toContainText('sin conexión');
    await expect(offline.locator('p')).toContainText('sincroniza');
  });

  test('el CTA principal lleva a la bienvenida', async ({ page, context }) => {
    // Es lo que hace quien llega sin cuenta. Con la sesion admin del fixture y el onboarding ya
    // hecho (otro spec lo deja en las preferencias), /fleet/bienvenida redirige a /fleet.
    await context.clearCookies();
    await page.goto('/?inicio=1');
    await page.getByTestId('cta-start').click();
    await expect(page).toHaveURL(/\/fleet\/bienvenida/);
  });

  test('en teléfono no desborda en horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/?inicio=1');
    await expect(page.getByTestId('hero-title')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
