import { test, expect } from './fixtures';

/**
 * Fonts E2E Tests.
 * Cobertura: Verificación de font-family tokenizado offline-first en /fleet, /fleet/vehicles, y /fleet/catalog.
 */

test.describe('Font System E2E', () => {
  const pages = [
    { name: 'Fleet Dashboard', url: '/fleet' },
    { name: 'Vehicles Page', url: '/fleet/vehicles' },
    { name: 'Catalog Page', url: '/fleet/catalog' },
  ];

  for (const p of pages) {
    test(`h1 font-family on ${p.name} (${p.url}) contains tokenized sans stack and not fallback serif`, async ({ page }) => {
      await page.goto(p.url);
      const h1 = page.locator('h1').first();
      await expect(h1).toBeVisible();

      const fontFamily = await h1.evaluate((el) => window.getComputedStyle(el).fontFamily);

      // No debe resolver al browser fallback por defecto 'Times' / 'Times New Roman'
      expect(fontFamily.toLowerCase()).not.toContain('times new roman');

      // Debe contener alguno de los elementos del stack offline-first sans (--g-font-sans)
      const hasSansStack = ['system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'sans-serif'].some((f) =>
        fontFamily.toLowerCase().includes(f)
      );
      expect(hasSansStack).toBe(true);
    });
  }
});
