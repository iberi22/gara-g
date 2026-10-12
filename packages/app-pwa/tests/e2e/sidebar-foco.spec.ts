import { test, expect } from './fixtures';

/**
 * Drawer movil (issue 06): foco al abrir, trampa de foco, Escape y cierre devuelven el foco al
 * hamburguesa, y cerrado no se puede llegar a sus enlaces con Tab (inert).
 */
const active = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      testid: el?.getAttribute('data-testid') ?? null,
      inSidebar: !!el?.closest('.fleet-sidebar'),
    };
  });

test.describe('Drawer movil y teclado (375x700)', () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test('cerrado: Tab nunca entra en los enlaces del drawer', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.locator('.fleet-sidebar')).toHaveJSProperty('inert', true);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      expect((await active(page)).inSidebar).toBe(false);
    }
  });

  test('el hamburguesa declara aria-controls y aria-expanded desde el SSR', async ({ page }) => {
    await page.goto('/fleet');
    const h = page.getByTestId('hamburger');
    await expect(h).toHaveAttribute('aria-controls', 'fleet-sidebar');
    await expect(h).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#fleet-sidebar')).toHaveCount(1);
  });

  test('abrir con teclado lleva el foco al boton de cerrar; Escape lo devuelve', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.fleet-shell')).toHaveAttribute('data-sidebar-open', 'true');
    await expect(page.getByTestId('hamburger')).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await active(page)).testid).toBe('sidebar-close');
    await expect(page.locator('.fleet-sidebar')).toHaveJSProperty('inert', false);

    await page.keyboard.press('Escape');
    await expect(page.locator('.fleet-shell')).toHaveAttribute('data-sidebar-open', 'false');
    await expect.poll(async () => (await active(page)).testid).toBe('hamburger');
    await expect(page.locator('.fleet-sidebar')).toHaveJSProperty('inert', true);
  });

  test('abierto: el foco queda atrapado en el drawer (Tab y Shift+Tab)', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    await expect.poll(async () => (await active(page)).testid).toBe('sidebar-close');
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect((await active(page)).inSidebar).toBe(true);
    }
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Shift+Tab');
      expect((await active(page)).inSidebar).toBe(true);
    }
  });

  test('el boton de cerrar devuelve el foco y el drawer vuelve a salir de pantalla', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    await page.getByTestId('sidebar-close').click();
    await expect.poll(async () => (await active(page)).testid).toBe('hamburger');
    await expect
      .poll(() => page.locator('.fleet-sidebar').evaluate((el) => getComputedStyle(el).transform))
      .toMatch(/matrix\(1, 0, 0, 1, -\d+/);
  });

  test('navegar desde el drawer lo cierra sin robar el foco al hamburguesa', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    await page.getByTestId('nav-vehicles').click();
    await expect(page).toHaveURL(/\/fleet\/vehicles/);
    await expect(page.locator('.fleet-shell')).toHaveAttribute('data-sidebar-open', 'false');
    expect((await active(page)).testid).not.toBe('hamburger');
  });
});

test.describe('Escritorio (1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('la barra lateral fija no es inert', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.locator('.fleet-sidebar')).toHaveJSProperty('inert', false);
  });
});

test.describe('Tactil: areas de 44px', () => {
  test.use({ viewport: { width: 375, height: 700 }, hasTouch: true });
  test('hamburguesa, cerrar y nav-item miden >= 44px', async ({ page }) => {
    await page.goto('/fleet');
    const h = await page.getByTestId('hamburger').boundingBox();
    expect(h?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(h?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByTestId('hamburger').click();
    const c = await page.getByTestId('sidebar-close').boundingBox();
    expect(c?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(c?.height ?? 0).toBeGreaterThanOrEqual(44);
    const n = await page.getByTestId('nav-vehicles').boundingBox();
    expect(n?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
