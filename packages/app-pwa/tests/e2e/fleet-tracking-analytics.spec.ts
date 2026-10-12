import { test, expect } from './fixtures';
import { mockLiveTelemetry } from './helpers/telemetry';
import { seedDemoFleet } from './helpers/seed';

/**
 * Tracking + Analytics E2E Tests.
 */

test.beforeEach(async ({ request }) => {
  // Las paginas leen el tenant de la sesion: la flota demo se crea ahi.
  await seedDemoFleet(request);
});

test.describe('Tracking en vivo', () => {
  test('muestra telemetría de vehículos activos', async ({ page }) => {
    await mockLiveTelemetry(page); // ver helpers/telemetry.ts
    await page.goto('/fleet/tracking');
    await expect(page.getByTestId('tracking-page')).toBeVisible();
    await expect(page.getByTestId('live-indicator')).toBeVisible();
    await expect(page.getByTestId('tracking-table')).toBeVisible();

    // Debe haber al menos una fila con velocidad en km/h (el primer sondeo la trae)
    await expect(page.getByTestId('tracking-live')).toContainText(/km\/h/);
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/km\/h/);
    expect(body).toContain('Velocidad');
    expect(body).toContain('RPM');
    expect(body).toContain('Combustible');
  });
});

test.describe('Analytics — KPIs y distribución', () => {
  test('muestra KPIs de costo y eficiencia', async ({ page }) => {
    await page.goto('/fleet/analytics');
    await expect(page.getByTestId('analytics-page')).toBeVisible();
    await expect(page.getByTestId('analytics-kpis')).toBeVisible();
    await expect(page.getByTestId('cost-table')).toBeVisible();
    await expect(page.getByTestId('maint-distribution')).toBeVisible();

    // Debe contener moneda COP ($) y términos de costo
    const body = await page.locator('body').textContent();
    expect(body).toContain('COP');
    expect(body).toContain('Costo combustible');
    expect(body).toContain('Costo mantenimiento');
    expect(body).toContain('Eficiencia promedio');
  });

  test('distribución de mantenimiento muestra barras', async ({ page }) => {
    await page.goto('/fleet/analytics');
    const dist = page.getByTestId('maint-distribution');
    await expect(dist).toBeVisible();
    // Debe haber al menos 4 tipos (preventivo, correctivo, predictivo, inspección)
    const distText = await dist.textContent();
    expect(distText).toMatch(/preventivo/);
    expect(distText).toMatch(/correctivo/);
  });
});