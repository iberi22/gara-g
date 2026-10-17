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
});
