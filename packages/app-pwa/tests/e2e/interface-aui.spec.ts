import { test, expect } from './fixtures';

/**
 * E2E Spec: Interfaz AUI (Agentic UI) y Gating de Cuenta Socio
 * Cobertura:
 * - Sin cuenta Socio: muestra tarjeta de upsell y recalca que el CRUD básico no está bloqueado.
 * - Con cuenta Socio (o demo activo): permite generar interfaces mediante prompt y renderiza AuiSpec.
 */

test.describe('Interfaz AUI y Gating Socio', () => {
  test('gates AI inference for non-socio users without blocking basic CRUD', async ({ page }) => {
    // Resetear demo socio para comenzar en estado no-socio
    await page.goto('/fleet/aui');
    await page.evaluate(() => localStorage.setItem('gara_demo_socio', 'false'));
    await page.reload();

    // 1. Debe verse la tarjeta de upsell
    const upsellCard = page.getByTestId('aui-upsell-card');
    await expect(upsellCard).toBeVisible();
    await expect(upsellCard).toContainText('CRUD Básico 100% Libre');
    await expect(page.getByTestId('cta-upgrade-socio')).toBeVisible();

    // 2. Activar modo Socio mediante el botón demo
    const toggleBtn = page.getByTestId('toggle-demo-socio');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // 3. Ahora debe ser visible el espacio de trabajo AUI
    const workspace = page.getByTestId('aui-workspace');
    await expect(workspace).toBeVisible();

    const promptInput = page.getByTestId('aui-prompt-input');
    await expect(promptInput).toBeVisible();

    const submitBtn = page.getByTestId('aui-submit-btn');
    await expect(submitBtn).toBeVisible();

    // 4. Probar generación de AUI
    await promptInput.fill('Generar tabla de alertas y telemetría');
    await submitBtn.click();

    // 5. El canvas renderizado debe contener componentes generados
    const canvas = page.getByTestId('aui-rendered-content');
    await expect(canvas).toBeVisible();
  });
});
