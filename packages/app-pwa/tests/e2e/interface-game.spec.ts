import { test, expect } from './fixtures';

/**
 * E2E Spec: Interfaz de Videojuego (Garaje NFS) y Control por Flag GAME_UI_ENABLED
 * Cobertura:
 * - Renderiza el garaje con vista 3D-ish, showcase, tarjetas de stats y HUD telemétrico cuando está habilitado.
 * - Muestra pantalla de desactivación segura cuando GAME_UI_ENABLED=false (query o env).
 */

test.describe('Interfaz de Videojuego (Garaje NFS)', () => {
  test('renders garage showcase and live telemetry HUD when enabled', async ({ page }) => {
    await page.goto('/fleet/game?game_enabled=true');

    // 1. Vista principal del garaje
    await expect(page.getByTestId('game-garage-view')).toBeVisible();

    // 2. Showcase vehicular
    await expect(page.getByTestId('vehicle-showcase')).toBeVisible();

    // 3. Selector de vehículos del parque automotor
    await expect(page.getByTestId('garage-vehicle-selector')).toBeVisible();

    // 4. Ficha técnica y estadísticas
    await expect(page.getByTestId('car-stat-card')).toBeVisible();
    await expect(page.getByTestId('car-stat-card')).toContainText('POTENCIA');

    // 5. HUD de telemetría en vivo
    await expect(page.getByTestId('car-hud-telemetry')).toBeVisible();
    await expect(page.getByTestId('car-hud-telemetry')).toContainText('RPM');
  });

  test('displays safe fallback when GAME_UI_ENABLED is disabled', async ({ page }) => {
    await page.goto('/fleet/game?game_enabled=false');

    // Debe mostrar la vista de desactivación
    const fallback = page.getByTestId('game-disabled-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText('GAME_UI_ENABLED=false');
  });
});
