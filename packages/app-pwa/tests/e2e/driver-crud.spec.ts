import { test, expect } from './fixtures';
import { MARKET } from '../../src/lib/market';

test.describe('Driver Table CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate directly to /drivers page
    await page.goto('/drivers');
    await page.waitForLoadState('networkidle');
  });

  test('Crear driver vía UI, verificar en tabla', async ({ page }) => {
    // Verify page header
    const heading = page.getByRole('heading', { name: 'Conductores GARA-G' });
    await expect(heading).toBeVisible();

    // Click "+ Nuevo Conductor" button
    const addButton = page.locator('[data-testid="add-driver-btn"]');
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Verify driver form is visible
    const form = page.locator('[data-testid="driver-form"]');
    await expect(form).toBeVisible();

    // Fill out driver creation form
    await page.locator('[data-testid="input-name"]').fill('Alejandro Morales');
    await page.locator('[data-testid="input-cedula"]').fill('1020304050');
    await page.locator('[data-testid="input-licenseCategory"]').selectOption(MARKET.truckLicenseClass);
    await page.locator('[data-testid="input-licenseExpiry"]').fill('2029-06-30');
    await page.locator('[data-testid="input-phone"]').fill(`${MARKET.phonePrefix} 3109876543`);
    await page.locator('[data-testid="input-status"]').selectOption('active');
    await page.locator('[data-testid="input-fleetId"]').fill('fleet-bogota');
    await page.locator('[data-testid="input-vehicleId"]').fill('veh-202');

    // Submit form
    await page.locator('[data-testid="submit-driver-btn"]').click();

    // Verify driver appears in table row
    const driverRow = page.locator('[data-testid="driver-row"]', { hasText: 'Alejandro Morales' });
    await expect(driverRow).toBeVisible();

    // Verify driver status tag and cedula
    await expect(driverRow.locator('[data-testid="driver-status"]')).toContainText('Activo');
    await expect(driverRow).toContainText('1020304050');
  });

  test('Filtrar por status active y contar filas', async ({ page }) => {
    // 1. Create active driver
    await page.locator('[data-testid="add-driver-btn"]').click();
    await page.locator('[data-testid="input-name"]').fill('Driver Activo E2E');
    await page.locator('[data-testid="input-cedula"]').fill('88888888');
    await page.locator('[data-testid="input-status"]').selectOption('active');
    await page.locator('[data-testid="submit-driver-btn"]').click();

    // 2. Create suspended driver
    await page.locator('[data-testid="add-driver-btn"]').click();
    await page.locator('[data-testid="input-name"]').fill('Driver Suspendido E2E');
    await page.locator('[data-testid="input-cedula"]').fill('99999999');
    await page.locator('[data-testid="input-status"]').selectOption('suspended');
    await page.locator('[data-testid="submit-driver-btn"]').click();

    // 3. Filter by 'active' status
    const filterSelect = page.locator('[data-testid="status-filter"]');
    await filterSelect.selectOption('active');

    // Assert only active driver row is visible
    const activeDriverRow = page.locator('[data-testid="driver-row"]', { hasText: 'Driver Activo E2E' });
    await expect(activeDriverRow).toBeVisible();

    const suspendedDriverRow = page.locator('[data-testid="driver-row"]', { hasText: 'Driver Suspendido E2E' });
    await expect(suspendedDriverRow).not.toBeVisible();

    // 4. Reset filter to 'all' and verify suspended driver appears
    await filterSelect.selectOption('all');
    await expect(suspendedDriverRow).toBeVisible();
  });
});
