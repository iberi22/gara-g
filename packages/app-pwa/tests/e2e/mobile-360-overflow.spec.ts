import { test, expect } from './fixtures';

// A 360 px (movil chico) ninguna de estas vistas debe desbordar horizontalmente: las rejillas
// usan minmax(min(Npx, 100%), 1fr) en lugar de un minimo fijo mayor que la pantalla.
test.use({ viewport: { width: 360, height: 740 } });

for (const path of ['/fleet/game', '/fleet/catalog', '/fleet/aui']) {
  test(`${path} no desborda a 360 px`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(m.scroll).toBeLessThanOrEqual(m.client);
  });
}
