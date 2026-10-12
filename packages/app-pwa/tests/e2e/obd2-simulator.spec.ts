import { test, expect } from './fixtures';

/**
 * E2E tests for OBD2 Bluetooth & Simulator panel on tracking page.
 */

test.describe('OBD2 Bluetooth Adaptador + Simulador', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/fleet/tracking');
  });

  test('muestra panel OBD2 y botón "Conectar OBD2" con fallback de navegador', async ({ page }) => {
    await expect(page.getByTestId('obd2-control-panel')).toBeVisible();
    await expect(page.getByTestId('obd2-status-badge')).toBeVisible();

    const btnConnect = page.getByTestId('btn-connect-obd2');
    await expect(btnConnect).toBeVisible();

    // In Playwright headless Chrome without Bluetooth flags, Web Bluetooth is unsupported
    // Verify button is disabled or handles unsupported status smoothly
    const isDisabled = await btnConnect.isDisabled();
    if (isDisabled) {
      await expect(page.locator('#obd2-browser-notice')).toContainText(/no soportado/i);
    }
  });

  test('toggle simulador genera registros de telemetría visibles en la tabla', async ({ page }) => {
    // El checkbox es custom (input oculto + slider visible): interactuar vía label.
    const toggle = page.getByTestId('toggle-obd2-simulator');
    await expect(toggle).toBeHidden();
    const slider = page.locator('.simulator-toggle');
    await expect(slider).toBeVisible();

    // Enable simulator
    await slider.click();

    // Status text should reflect simulator active
    await expect(page.getByTestId('obd2-status-badge')).toContainText(/Simulando/i);

    // Wait for synthetic row to be prepended to tracking table
    const tableBody = page.locator('[data-testid="tracking-table"] tbody');
    await expect(tableBody).toContainText('SIM-8888', { timeout: 10000 });
    await expect(tableBody).toContainText('km/h');

    // Turn simulator off
    await slider.click();
    await expect(page.getByTestId('obd2-status-badge')).toContainText(/Desconectado/i);
  });
});
