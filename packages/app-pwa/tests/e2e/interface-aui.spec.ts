import { test, expect } from './fixtures';

/**
 * E2E Spec: Interfaz AUI (Agentic UI) con IA local
 *
 * G3: la AUI ya no tiene planes, cuentas ni cuotas; compone con la IA local del navegador
 * (Chrome Prompt API o WebGPU) y, si el navegador no la tiene, lo dice en español sin
 * bloquear el resto de la app. Ya no hay tarjeta de upsell ni conmutador de "demo socio".
 */
test.describe('Interfaz AUI local', () => {
  test('no hay planes ni gating: la AUI se sirve y ofrece el espacio de trabajo', async ({ page }) => {
    await page.goto('/fleet/aui');

    // 1. Ya no existe la tarjeta de upsell ni el botón de demo de tier.
    await expect(page.getByTestId('aui-upsell-card')).toHaveCount(0);
    await expect(page.getByTestId('cta-upgrade-socio')).toHaveCount(0);
    await expect(page.getByTestId('toggle-demo-socio')).toHaveCount(0);

    // 2. El espacio de trabajo está disponible sin cuenta de pago.
    await expect(page.getByTestId('aui-workspace')).toBeVisible();
    await expect(page.getByTestId('aui-prompt-input')).toBeVisible();
    await expect(page.getByTestId('aui-submit-btn')).toBeVisible();
  });

  test('sin IA local lo dice en español y no pinta el ejemplo como resultado', async ({ page }) => {
    await page.goto('/fleet/aui');

    const promptInput = page.getByTestId('aui-prompt-input');
    await promptInput.fill('Generar tabla de alertas y telemetría');
    await page.getByTestId('aui-submit-btn').click();

    // En un navegador sin Prompt API ni WebGPU el único nivel es el de reglas: la página
    // avisa y vacía el lienzo; nunca deja el ejemplo local como si fuera la respuesta.
    const alert = page.getByTestId('aui-error');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/IA local/i);
    await expect(page.getByTestId('aui-rendered-content')).not.toContainText('FL-01');
  });
});
