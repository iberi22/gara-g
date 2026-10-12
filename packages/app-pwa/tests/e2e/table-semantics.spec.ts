import { test, expect } from './fixtures';
import { seedDemoFleet } from './helpers/seed';

/**
 * Semantica y estilo de la tabla generica (GenericTableAstro): wave-32 07, 25 y 16.
 * Corre contra los datos demo (maintenance tiene 20 filas -> dos paginas).
 */
test.describe('GenericTableAstro: semantica y tokens', () => {
  test.beforeEach(async ({ request }) => {
    await seedDemoFleet(request, { exact: false });
  });

  test('cada <th> declara scope="col" y la tabla tiene un <caption> con nombre', async ({ page }) => {
    await page.goto('/fleet/vehicles');
    const ths = page.locator('table.g-table th');
    const n = await ths.count();
    expect(n).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
      await expect(ths.nth(i)).toHaveAttribute('scope', 'col');
    }
    const caption = page.locator('table.g-table > caption');
    await expect(caption).toHaveCount(1);
    expect((await caption.textContent())?.trim().length ?? 0).toBeGreaterThan(3);
    // El caption no se pinta (sr-only): no empuja la tabla.
    const box = await caption.boundingBox();
    expect(box === null || (box.width <= 1 && box.height <= 1)).toBe(true);
  });

  test('la pagina actual lleva aria-current="page" y es la que dice la URL', async ({ page }) => {
    await page.goto('/fleet/maintenance?page=2');
    const current = page.locator('nav[aria-label="Paginación"] [aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('2');
  });

  test('en la pagina 1 los controles "primera" y "anterior" no entran en el orden de Tab', async ({ page }) => {
    await page.goto('/fleet/maintenance');
    const prev = page.getByLabel('Página anterior');
    const first = page.getByLabel('Primera página');
    // Deshabilitados de verdad: sin href (no son enlaces) y marcados.
    for (const el of [prev, first]) {
      await expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(await el.evaluate((n) => n.hasAttribute('href'))).toBe(false);
    }
    // Y de comportamiento: recorrer el teclado desde el buscador no aterriza en ellos.
    await page.getByRole('searchbox').focus();
    const visited: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      visited.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
    }
    expect(visited).not.toContain('Página anterior');
    expect(visited).not.toContain('Primera página');
    // Los habilitados si reciben foco.
    expect(visited).toContain('Página siguiente');
  });

  test('la celda de acciones no es display:flex (el contenedor interior si)', async ({ page }) => {
    await page.goto('/fleet/vehicles');
    const cell = page.locator('table.g-table td.g-actions-cell').first();
    await expect(cell).toBeVisible();
    expect(await cell.evaluate((el) => getComputedStyle(el).display)).toBe('table-cell');
    const inner = cell.locator('.g-actions');
    expect(await inner.evaluate((el) => getComputedStyle(el).display)).toBe('flex');
  });

  test('la tabla usa el tema: border-collapse separate y columna fija con fondo opaco', async ({ page }) => {
    await page.goto('/fleet/vehicles');
    const table = page.locator('table.g-table');
    expect(await table.evaluate((el) => getComputedStyle(el).borderCollapse)).toBe('separate');
    const sticky = page.locator('table.g-table td.g-sticky').first();
    const bg = await sticky.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });

  test('a 360 px la barra de controles envuelve y la pagina no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/fleet/vehicles');
    await expect(page.locator('table.g-table')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
    const controls = page.locator('.g-table-controls');
    expect(await controls.evaluate((el) => getComputedStyle(el).flexWrap)).toBe('wrap');
    const search = await page.getByRole('searchbox').boundingBox();
    const wrap = await page.locator('.g-table-wrap').boundingBox();
    expect(search!.x + search!.width).toBeLessThanOrEqual(wrap!.x + wrap!.width + 1);
  });
});
