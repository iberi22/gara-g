import { test, expect } from './fixtures';
import { gotoStable } from './helpers/navigation';

/**
 * E2E Responsive Tests — verifica que la UI funciona en mobile y tablet.
 *
 * Breakpoints:
 * - Mobile: 375x667 (iPhone SE)
 * - Tablet: 768x1024 (iPad)
 * - Desktop: 1280x720 (default Playwright)
 */

// Todas las rutas /fleet* exigen sesión (middleware auth-gate, #937)

test.describe('Mobile (375x667)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('landing pública renderiza en mobile sin redirect', async ({ page, context }) => {
    // El fixture pone sesion de admin, y con sesion / lleva a la app: aqui se prueba SIN cookies.
    await context.clearCookies();
    await page.goto('/');
    // '/' es landing pública (index.astro), NO redirect a /fleet (diseño convergido)
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('hero-section')).toBeVisible();
  });

  test('usuario recurrente: / lleva a la app, y /?inicio=1 muestra la landing', async ({ page, context }) => {
    const url = (process.env.BASE_URL || 'http://localhost:4321') + '/';
    await context.clearCookies();
    await context.addCookies([{ name: 'gara_mode', value: 'guest', url }]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/fleet\/garage/);
    await page.goto('/?inicio=1');
    await expect(page).toHaveURL(/\/\?inicio=1/);
    await expect(page.getByTestId('hero-section')).toBeVisible();
  });

  test('sidebar está oculto por default en mobile', async ({ page }) => {
    await page.goto('/fleet');
    const sidebar = page.getByTestId('fleet-sidebar');
    await expect(sidebar).toBeVisible();
    // El sidebar está fuera del viewport (transformed off-screen)
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    // O está offscreen (x < 0) o el ancho efectivo es 0
    if (box) {
      expect(box.x + box.width <= 16).toBe(true);
    }
  });

  test('hamburger abre el sidebar drawer', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    // Después de click, el shell debe tener data-sidebar-open="true"
    const shell = page.locator('.fleet-shell');
    await expect(shell).toHaveAttribute('data-sidebar-open', 'true');
    // El backdrop debe ser visible
    await expect(page.getByTestId('sidebar-backdrop')).toBeVisible();
  });

  test('navegar cierra el drawer en mobile', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    await page.getByTestId('nav-vehicles').click();
    // Después de navegar, el shell debe estar cerrado
    await expect(page).toHaveURL(/\/fleet\/vehicles/);
    const shell = page.locator('.fleet-shell');
    await expect(shell).toHaveAttribute('data-sidebar-open', 'false');
  });

  test('tabla de vehículos tiene scroll horizontal', async ({ page }) => {
    await page.goto('/fleet/vehicles');
    const table = page.getByTestId('vehicles-table');
    await expect(table).toBeVisible();
    // La tabla debe tener scroll horizontal en mobile: el wrapper
    // .g-table-scroll tiene overflow-x: auto y la tabla min-width: 500px
    const scrollInfo = await page.locator('[data-testid="vehicles-table"] .g-table-scroll').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      hasHorizontalScroll: el.scrollWidth > el.clientWidth,
    }));
    // En mobile (375px), la tabla de 500+px debe hacer overflow horizontal
    expect(scrollInfo.scrollWidth).toBeGreaterThan(scrollInfo.clientWidth);
  });

  test('dashboard stats en 1 columna en mobile', async ({ page }) => {
    await page.goto('/fleet');
    const grid = page.getByTestId('stats-primary');
    await expect(grid).toBeVisible();
    // En mobile, grid-template-columns debe ser 1fr
    const cols = await grid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    // 1fr significa que no hay espacios entre tracks
    expect(cols.split(' ').length).toBe(1);
  });

  test('topbar muestra hamburger y oculta subtitle', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.getByTestId('hamburger')).toBeVisible();
    // Subtitle oculto en mobile (CSS display:none)
    const subtitle = page.locator('.topbar-subtitle');
    const display = await subtitle.evaluate((el) => window.getComputedStyle(el).display);
    expect(display).toBe('none');
  });

  test('página /fleet/catalog funcional en mobile', async ({ page }) => {
    await page.goto('/fleet/catalog');
    await expect(page.getByTestId('catalog-page')).toBeVisible();
    // El buscador debe estar visible
    await expect(page.getByTestId('catalog-search')).toBeVisible();
    // Al menos 1 marca visible
    const makes = page.locator('[data-make]');
    expect(await makes.count()).toBeGreaterThan(0);
  });
});

test.describe('Tablet (768x1024)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('sidebar visible fijo en tablet (no drawer)', async ({ page }) => {
    await page.goto('/fleet');
    const sidebar = page.getByTestId('fleet-sidebar');
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // En tablet el sidebar debe estar visible (x >= 0)
      expect(box.x).toBeGreaterThanOrEqual(0);
      // Y el ancho debe ser menor que desktop (200px en tablet)
      expect(box.width).toBeLessThanOrEqual(240);
    }
  });

  test('hamburger oculto en tablet', async ({ page }) => {
    await page.goto('/fleet');
    const hamburger = page.getByTestId('hamburger');
    const display = await hamburger.evaluate((el) => window.getComputedStyle(el).display);
    expect(display).toBe('none');
  });

  test('dashboard stats en 2 columnas en tablet', async ({ page }) => {
    await page.goto('/fleet');
    const grid = page.getByTestId('stats-primary');
    const cols = await grid.evaluate((el) => window.getComputedStyle(el).gridTemplateColumns);
    // g-grid-4 con 768px viewport cae a 2 cols por media query 1023px
    expect(cols.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(cols.split(' ').length).toBeLessThanOrEqual(4);
  });

  test('tabla de vehículos con sticky first column', async ({ page }) => {
    await page.goto('/fleet/vehicles');
    const firstCell = page.locator('[data-testid="vehicles-table"] table tbody tr:first-child td.g-sticky');
    const pos = await firstCell.evaluate((el) => window.getComputedStyle(el).position);
    expect(pos).toBe('sticky');
  });

  test('navegación sidebar funciona por click', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('nav-alerts').click();
    await expect(page).toHaveURL(/\/fleet\/alerts/);
    await expect(page.getByTestId('alerts-page')).toBeVisible();
  });
});

test.describe('Mobile interactions', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('ESC cierra el drawer', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    const shell = page.locator('.fleet-shell');
    await expect(shell).toHaveAttribute('data-sidebar-open', 'true');
    await page.keyboard.press('Escape');
    await expect(shell).toHaveAttribute('data-sidebar-open', 'false');
  });

  test('click en backdrop cierra el drawer', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    await page.getByTestId('sidebar-backdrop').click();
    const shell = page.locator('.fleet-shell');
    await expect(shell).toHaveAttribute('data-sidebar-open', 'false');
  });

  test('botón close (X) en sidebar funciona', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByTestId('hamburger').click();
    await page.getByTestId('sidebar-close').click();
    const shell = page.locator('.fleet-shell');
    await expect(shell).toHaveAttribute('data-sidebar-open', 'false');
  });
});

/**
 * Matriz de viewports W13.7 (#938): 7 rutas × 3 viewports sin scroll horizontal.
 * scrollWidth del documento debe caber en el viewport (tablas usan scroll-x
 * interno en su wrapper, no en la página).
 */
const NO_H_SCROLL_ROUTES = [
  '/',
  '/fleet',
  '/fleet/vehicles',
  '/fleet/maintenance',
  '/fleet/tracking',
  '/fleet/game',
  '/fleet/aui',
];

const NO_H_SCROLL_VIEWPORTS = [
  { width: 360, height: 740, name: 'mobile-360' },
  { width: 768, height: 1024, name: 'tablet-768' },
  { width: 1440, height: 900, name: 'desktop-1440' },
];

for (const vp of NO_H_SCROLL_VIEWPORTS) {
  test.describe(`Sin scroll horizontal @${vp.name} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const route of NO_H_SCROLL_ROUTES) {
      test(`ruta ${route} cabe en ${vp.width}px`, async ({ page }) => {
        // gotoStable: blinda contra 500s esporádicos del module-runner workerd (#938)
        await gotoStable(page, route);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${route} @${vp.width}px: scrollWidth ${overflow.scrollWidth} > viewport ${overflow.innerWidth}`
        ).toBeLessThanOrEqual(overflow.innerWidth + 1);
      });
    }
  });
}