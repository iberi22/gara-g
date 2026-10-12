import { test, expect } from './fixtures';
import { loginAsE2EUser } from './helpers/login';

/**
 * E2E Navigation Performance & ViewTransitions Test (W13.3).
 * Verifica navegaciones SPA sin reload completo entre Dashboard -> Vehículos -> Mantenimiento,
 * visibilidad de skeletons y de los elementos de contenido con testid.
 */

test.describe('Navigation Performance & ViewTransitions', () => {
  test('navigates Dashboard -> Vehicles -> Maintenance without full page reload under 5s', async ({ page }) => {
    // 1. Cargar Dashboard principal (/fleet)
    await page.goto('/fleet');

    // Esperar a que la navegación inicial se complete
    await page.waitForLoadState('domcontentloaded');

    // Sin sesion valida el SSR manda a /login: se entra con el usuario e2e (sin credenciales en el repo).
    if (page.url().includes('/login')) {
      await loginAsE2EUser(page);
      await page.goto('/fleet');
      await page.waitForLoadState('domcontentloaded');
    }

    await expect(page.getByTestId('fleet-sidebar')).toBeVisible({ timeout: 30000 });

    // Warmup: compilar una vez cada página (dev-mode) fuera del cronómetro
    for (const warm of ['/fleet/vehicles', '/fleet/maintenance', '/fleet']) {
      await page.goto(warm);
      await page.waitForLoadState('domcontentloaded');
    }
    await page.goto('/fleet');
    await page.waitForLoadState('domcontentloaded');

    // Skeletons y contenido del Dashboard
    await expect(page.getByTestId('loading-skeleton')).toBeAttached();
    await expect(page.getByTestId('dashboard-charts')).toBeVisible();

    // Marcar el objeto window para verificar que no hay reload completo durante SPA navigation
    await page.evaluate(() => {
      (window as any).__SPA_MARKER__ = 'gara_spa_active';
    });

    const startTime = Date.now();

    // 2. Navegar a Vehículos usando nav item del sidebar
    const navVehicles = page.getByTestId('nav-vehicles');
    await expect(navVehicles).toBeVisible();
    await navVehicles.click();

    // Confirmar que el skeleton estuvo o está presente
    await expect(page.getByTestId('loading-skeleton')).toBeAttached();

    // Confirmar que la página de Vehículos cargó
    await expect(page.getByTestId('vehicles-page')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('vehicles-table')).toBeVisible();

    // Assert que el window object persiste (SPA navigation sin full reload)
    const markerAfterVehicles = await page.evaluate(() => (window as any).__SPA_MARKER__);
    expect(markerAfterVehicles).toBe('gara_spa_active');

    // Assert document.title cambió
    const vehiclesTitle = await page.title();
    expect(vehiclesTitle).toContain('Vehículos');

    // 3. Navegar a Mantenimiento usando nav item del sidebar
    const navMaintenance = page.getByTestId('nav-maintenance');
    await expect(navMaintenance).toBeVisible();
    await navMaintenance.click();

    // Confirmar que el skeleton estuvo o está presente
    await expect(page.getByTestId('loading-skeleton')).toBeAttached();

    // Confirmar que la página de Mantenimiento cargó
    await expect(page.getByTestId('maintenance-page')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('maintenance-table')).toBeVisible();

    // Assert window object sigue marcado (sin full reload)
    const markerAfterMaintenance = await page.evaluate(() => (window as any).__SPA_MARKER__);
    expect(markerAfterMaintenance).toBe('gara_spa_active');

    // Assert document.title cambió
    const maintenanceTitle = await page.title();
    expect(maintenanceTitle).toContain('Mantenimiento');

    // 4. Medir tiempo total de las 3 navegaciones (< 5s)
    const navTime = Date.now() - startTime;
    expect(navTime).toBeLessThan(5000);
  });
});
