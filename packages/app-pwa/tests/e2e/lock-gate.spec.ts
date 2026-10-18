import { test, expect } from './fixtures';

test.describe('Lock Gate', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('no gate is shown by default without protection', async ({ page }) => {
    // Navigate to a layout page
    await page.goto('/fleet/ajustes');

    // Wait for the page to load
    await expect(page.getByTestId('settings-app')).toBeVisible();

    // Verify the lock gate is not present
    await expect(page.getByTestId('lock-gate')).not.toBeVisible();

    // Verify fleet content is visible
    const isVisible = await page.locator('.fleet-content').isVisible();
    expect(isVisible).toBeTruthy();
  });

  test('gate appears and traps focus when locked, unlocks correctly', async ({ page }) => {
    // Navigate to a layout page
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('settings-app')).toBeVisible();

    // Enable protection programmatically in a fresh context
    await page.evaluate(async () => {
      // @ts-ignore
      const { enableProtection } = await import('/src/lib/local/deviceLock.ts');
      await enableProtection('pin', '123456');
    });

    // Reload the page to trigger the gate
    await page.reload();

    // Verify the gate is visible and fleet-shell is inert
    const gate = page.getByTestId('lock-gate');
    await expect(gate).toBeVisible();
    await expect(page.locator('.fleet-shell')).toHaveAttribute('inert', '');

    // Focus check (the input should be automatically focused)
    const pinInput = page.locator('#lock-gate-pin');
    await expect(pinInput).toBeFocused();

    // Verify wrong PIN fails
    await pinInput.fill('654321');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    // Verify correct PIN unlocks
    await pinInput.fill('123456');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(gate).not.toBeVisible();

    // Verify fleet-shell is no longer inert
    await expect(page.locator('.fleet-shell')).not.toHaveAttribute('inert');
  });
});
