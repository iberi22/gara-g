// notifications.spec.ts — E2E del centro de notificaciones (P1.2, issue #917).
import { test, expect } from './fixtures';

test.describe('Notifications center', () => {
  test('campana visible y página lista notificaciones', async ({ page }) => {
    await page.goto('/fleet/maintenance');
    await expect(page.getByTestId('notif-bell')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('notif-bell').click();
    await expect(page).toHaveURL(/\/fleet\/notifications/);
    await expect(page.getByTestId('notifications-page')).toBeVisible();
  });

  test('filtro sin leer funciona', async ({ page }) => {
    await page.goto('/fleet/notifications?filter=unread');
    await expect(page.getByTestId('notifications-page')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('filter-unread')).toBeVisible();
  });
});
