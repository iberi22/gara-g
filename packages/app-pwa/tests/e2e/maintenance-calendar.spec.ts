// maintenance-calendar.spec.ts — E2E del calendario de mantenimiento (WAVE-11.05, issue #874).
import { test, expect } from './fixtures';

test.describe('Maintenance calendar', () => {
  test('muestra calendario y próximos servicios', async ({ page }) => {
    await page.goto('/fleet/maintenance');
    await expect(page.getByTestId('maintenance-page')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('maintenance-calendar')).toBeVisible();
    await expect(page.getByTestId('upcoming-services')).toBeVisible();
  });

  test('filtro por vehículo vía query param', async ({ page }) => {
    await page.goto('/fleet/maintenance?vehicleId=all');
    await expect(page.getByTestId('maintenance-calendar')).toBeVisible({
      timeout: 15_000,
    });
    const select = page.locator('#cal-vehicle');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('all');
  });
});
