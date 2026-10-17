import { test, expect } from './fixtures';

test.describe('Device Protection Settings UI', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Muestra la tarjeta de protección y maneja error de PIN corto sin cambiar estado', async ({ page }) => {
    await page.goto('/fleet/ajustes');

    const card = page.locator('[data-testid="protection-card"]');
    await expect(card).toBeVisible();

    await expect(card.getByText('Tus datos están guardados en texto plano en este navegador')).toBeVisible();

    const btnActivar = card.getByRole('button', { name: 'Activar protección' });
    await expect(btnActivar).toBeVisible();

    const pinInput = card.locator('input#pin-enable');
    await pinInput.fill('123'); // only 3 digits

    await btnActivar.click();

    const errorMsg = card.locator('.error-msg');
    await expect(errorMsg).toHaveText('PIN debe tener exactamente 6 dígitos');

    await expect(btnActivar).toBeVisible();
  });
});
