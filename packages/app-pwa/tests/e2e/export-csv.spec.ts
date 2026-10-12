import { test, expect } from './fixtures';

test.describe('CSV Export E2E', () => {
  test('redirects unauthenticated access or renders page with export button when authenticated', async ({ page }) => {
    // Navigate to vehicles list page
    await page.goto('/fleet/vehicles');

    // If session is absent in middleware, verify redirect to login
    if (page.url().includes('/login')) {
      await expect(page).toHaveURL(/\/login/);
      const loginBtn = page.locator('button[type="submit"]');
      await expect(loginBtn).toBeVisible();
    } else {
      // If dev session active, verify table export button
      const exportBtn = page.locator('#vehicles-table-export-btn');
      await expect(exportBtn).toBeVisible();
    }
  });
});
