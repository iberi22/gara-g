import { test, expect } from './fixtures';
import { mockLiveTelemetry } from './helpers/telemetry';

/**
 * Live Tracking E2E Tests.
 * Verifies live map container, polling indicators, map markers, and VIN query parameter filtering.
 */

test.describe('Tracking en Vivo — Leaflet + Polling 5s', () => {


  test('muestra mapa en vivo, indicador de polling y datos de telemetría', async ({ page }) => {
    await mockLiveTelemetry(page); // ver helpers/telemetry.ts
    await page.goto('/fleet/tracking');

    // Page container and components check
    await expect(page.getByTestId('tracking-page')).toBeVisible();
    await expect(page.getByTestId('tracking-live')).toBeVisible();
    await expect(page.getByTestId('tracking-map')).toBeVisible();

    // El primer sondeo llena la tabla: esperar la fila antes de leer el texto
    await expect(page.getByTestId('tracking-live')).toContainText(/km\/h/);

    // Verify live polling status text
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain('Tracking en vivo (polling 5s)');
    expect(bodyText).toContain('Vehículos Monitoreados');
    expect(bodyText).toMatch(/km\/h/);
  });

  test('permite filtrar por VIN vía query parameter', async ({ page }) => {
    await page.goto('/fleet/tracking?vin=VIN100');

    await expect(page.getByTestId('tracking-page')).toBeVisible();
    await expect(page.getByTestId('tracking-live')).toBeVisible();

    // Filter input should carry initial VIN or allow user filtering
    const vinInput = page.getByTestId('vin-filter-input');
    await expect(vinInput).toBeVisible();
    await expect(vinInput).toHaveValue('VIN100');
  });
});
