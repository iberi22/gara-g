import { test, expect } from './fixtures';

/**
 * P0-6 (triage UX): el modal de crear/editar flota gestiona el foco por teclado.
 * Entra al abrir, queda atrapado, Escape cierra y el foco vuelve al disparador.
 */
test.describe('Modal de flotas — foco por teclado', () => {
  test('abrir, tabular, Escape y devolver el foco al boton', async ({ page }) => {
    await page.goto('/fleets');
    const trigger = page.getByTestId('new-fleet-btn');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Nueva flota' });
    await expect(dialog).toBeVisible();
    // 1. el foco entra: primer campo
    await expect(page.locator('#fleet-name')).toBeFocused();

    // 2. trampa: 12 Tab seguidos nunca sacan el foco del dialogo
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    // ... y Shift+Tab desde el primer campo salta al ultimo control
    await page.locator('#fleet-name').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Guardar flota' })).toBeFocused();

    // 3. Escape cierra y el foco vuelve al disparador
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('editar: Escape devuelve el foco al boton Editar de la fila', async ({ page }) => {
    await page.goto('/fleets');
    await page.getByTestId('new-fleet-btn').click();
    await page.fill('#fleet-name', 'Flota Foco');
    await page.fill('#fleet-org', 'org-f');
    await page.fill('#fleet-region', 'Bogota');
    await page.keyboard.press('Enter');
    const row = page.locator('tr', { hasText: 'Flota Foco' });
    await expect(row).toBeVisible();
    const edit = row.getByRole('button', { name: 'Editar Flota Foco' });
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Editar flota' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();
    // limpieza
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Eliminar Flota Foco' }).click();
    await expect(row).toHaveCount(0);
  });
});
