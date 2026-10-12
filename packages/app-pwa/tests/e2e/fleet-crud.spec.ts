import { test, expect } from './fixtures';

test.describe('PWA Fleet CRUD Real UI Operations', () => {
  test('create fleet via real UI', async ({ page }) => {
    // 1. Navigate to /fleets page
    await page.goto('/fleets');

    // 2. Click "+ Nueva flota" button to open modal
    await page.click('button:has-text("+ Nueva flota")');

    // 3. Fill in fleet details
    await page.fill('input[name="name"]', 'North Fleet');
    await page.fill('input[name="organizationId"]', 'org-1');
    await page.fill('input[name="region"]', 'US-North');
    await page.fill('input[name="tags"]', 'ev, delivery');

    // 4. Submit fleet creation form
    await page.click('button[type="submit"]');

    // 5. Verify row appears in tbody with filled values
    const tbody = page.locator('tbody');
    await expect(tbody).toBeVisible();
    await expect(tbody).toContainText('North Fleet');
    await expect(tbody).toContainText('org-1');
    await expect(tbody).toContainText('US-North');
    await expect(tbody).toContainText('ev');
    await expect(tbody).toContainText('delivery');
  });

  test('edit fleet via real UI', async ({ page }) => {
    // 1. Navigate to /fleets page and create initial fleet
    await page.goto('/fleets');
    await page.click('button:has-text("+ Nueva flota")');
    await page.fill('input[name="name"]', 'North Fleet');
    await page.fill('input[name="organizationId"]', 'org-1');
    await page.fill('input[name="region"]', 'US-North');
    await page.fill('input[name="tags"]', 'ev, delivery');
    await page.click('button[type="submit"]');

    // 2. Click Edit button on created fleet row
    const row = page.locator('tr:has-text("North Fleet")');
    await expect(row).toBeVisible();
    await row.locator('button:has-text("Editar")').click();

    // 3. Update fleet name to North Fleet v2
    await page.fill('input[name="name"]', 'North Fleet v2');
    await page.click('button[type="submit"]');

    // 4. Verify updated name in table body cell
    const tbody = page.locator('tbody');
    await expect(tbody).toBeVisible();
    await expect(tbody).toContainText('North Fleet v2');
  });

  test('delete fleet via real UI', async ({ page }) => {
    // 1. Navigate to /fleets page and create fleet to delete
    await page.goto('/fleets');
    await page.click('button:has-text("+ Nueva flota")');
    await page.fill('input[name="name"]', 'Fleet To Delete');
    await page.fill('input[name="organizationId"]', 'org-del');
    await page.fill('input[name="region"]', 'EU-South');
    await page.fill('input[name="tags"]', 'temp');
    await page.click('button[type="submit"]');

    // 2. Confirm row exists in tbody
    const tbody = page.locator('tbody');
    await expect(tbody).toBeVisible();
    await expect(tbody).toContainText('Fleet To Delete');

    // 3. Click Eliminar button on fleet row
    const row = page.locator('tr:has-text("Fleet To Delete")');
    page.once('dialog', (d) => d.accept()); // borrar pide confirmacion (issue 11)
    await row.locator('button:has-text("Eliminar")').click();

    // 4. Verify row disappears from tbody
    await expect(tbody).not.toContainText('Fleet To Delete');
  });
});
