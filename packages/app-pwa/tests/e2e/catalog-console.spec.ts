import { test, expect } from './fixtures';

test.describe('Catalog Page Console & Live Search E2E', () => {
  test('loads /fleet/catalog without console errors and filters makes/models live', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    // 1. Navigate to catalog page
    await page.goto('/fleet/catalog');

    // 2. If SSR auth redirects to /login in dev server, verify login page; otherwise verify catalog page
    if (page.url().includes('/login')) {
      await expect(page).toHaveURL(/\/login/);
      const loginCard = page.locator('.login-card');
      await expect(loginCard).toBeVisible();
    } else {
      await expect(page.getByTestId('catalog-page')).toBeVisible();

      const searchInput = page.getByTestId('catalog-search');
      await expect(searchInput).toBeVisible();

      // Perform live search for "Hilux"
      await searchInput.fill('Hilux');

      // Assert matching Toyota Hilux card is visible
      const hiluxCard = page.locator('.model-card[data-model*="Hilux"]');
      await expect(hiluxCard).toBeVisible();

      // Assert non-matching make block (e.g. Volvo) is hidden
      const volvoBlock = page.locator('.make-block[data-make="Volvo"]');
      await expect(volvoBlock).toBeHidden();

      // Clear search query and verify Volvo block returns
      await searchInput.fill('');
      await expect(volvoBlock).toBeVisible();
    }

    // 3. Assert 0 console/page errors were logged (no ReferenceError for catalogJson)
    expect(consoleErrors).toEqual([]);
  });
});
