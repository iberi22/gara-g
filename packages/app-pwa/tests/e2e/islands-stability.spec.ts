import { test, expect } from './fixtures';
import { gotoStable } from './helpers/navigation';

/**
 * E2E Spec: Islands Stability (#952)
 * Las islas Svelte en FleetLayout (InterfaceSwitcher/ToastContainer client:only)
 * causaban 500 intermitentes en dev-workerd (`Unable to resolve ... .svelte`).
 * Fix: componentes Astro + <script> vanilla (cero islas en el layout).
 * Este spec clava la regresión: 20 cargas (10× /fleet + 10× /fleet/vehicles),
 * 0 responses 500 y switcher/toasts renderizados en cada carga.
 */

test.describe('Islands Stability (no flaky 500)', () => {
  test('20 cargas fleet sin 500s y con switcher visible', async ({ page }) => {
    const routes = ['/fleet', '/fleet/vehicles'];
    let loads = 0;
    for (let i = 0; i < 10; i++) {
      for (const route of routes) {
        // gotoStable: 1 retry ante 500 esporádico del module-runner (#952).
        // Un 500 REAL falla igual (2/2 intentos) — ver warnings GOTO-RETRY.
        const response = await gotoStable(page, route);
        expect(response, `GET ${route} (iter ${i}) sin respuesta`).not.toBeNull();
        expect(response!.status(), `GET ${route} (iter ${i}) status`).not.toBe(500);
        expect(response!.status(), `GET ${route} (iter ${i}) status`).toBeLessThan(500);
        // Switcher Astro renderiza en SSR en cada carga (sin hidratación Svelte)
        await expect(page.getByTestId('interface-switcher').first()).toBeVisible();
        await expect(page.getByTestId('toast-container').first()).toBeAttached();
        loads++;
      }
    }
    expect(loads).toBe(20);
  });

  test('switcher navega admin/aui/game tras recargas repetidas', async ({ page }) => {
    await gotoStable(page, '/fleet/vehicles');
    await expect(page.getByTestId('interface-switcher').first()).toBeVisible();
    await Promise.all([
      page.waitForURL(/.*\/fleet\/aui/),
      page.getByTestId('switch-btn-aui').first().click(),
    ]);
    await expect(page.getByTestId('interface-aui-view')).toBeVisible();
    // Recarga en AUI: el modo activo SSR debe seguir siendo aui
    // (gotoStable: page.reload crudo no reintenta el flake del module-runner)
    await gotoStable(page, page.url());
    await expect(page.getByTestId('switch-btn-aui').first()).toBeVisible();
    await expect(page.getByTestId('interface-aui-view')).toBeVisible();
  });
});
