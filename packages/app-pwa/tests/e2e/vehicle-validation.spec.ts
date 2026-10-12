// vehicle-validation.spec.ts — E2E validación VIN/placa en API + formularios (feat-vehicle-validators).
import { test, expect } from './fixtures';
import { loginAsE2EUser } from './helpers/login';

const GOOD_VIN = '1HGCM82633A004352';

test.describe('Vehicle validation', () => {
  test('formulario muestra campo VIN', async ({ page }) => {
    await page.goto('/fleet/vehicles');
    await expect(page.getByTestId('vehicles-page')).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('.g-create-toggle').click();
    await expect(page.locator('input[name="vin"]')).toBeVisible();
  });

  test('API rechaza VIN inválido con 400', async ({ page }) => {
    await loginAsE2EUser(page);
    const res = await page.request.post(
      '/api/fleet/vehicle',
      {
        data: {
          plate: 'ABC-123',
          vin: 'CORTO',
          make: 'Toyota',
          model: 'Hilux',
          year: 2022,
          status: 'active',
          fleetId: 'f1',
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('vin');
  });

  test('API acepta vehículo válido', async ({ page }) => {
    await loginAsE2EUser(page);
    const res = await page.request.post(
      '/api/fleet/vehicle',
      {
        data: {
          plate: 'TST-101',
          vin: GOOD_VIN,
          make: 'Toyota',
          model: 'Hilux',
          year: 2022,
          status: 'active',
          fleetId: 'f1',
        },
      },
    );
    expect(res.ok()).toBeTruthy();
  });
});
