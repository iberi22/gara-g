import { test, expect } from './fixtures';
import { FLEET_ONLY } from './helpers/features';

/** Issue 24: el menu lateral no repite entradas, ofrece las secciones de la entrega y marca la activa. */
test.describe('Menu lateral', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('cada entrada aparece una sola vez (testid, destino) e incluye lo que la entrega ofrece', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.getByTestId('nav-game')).toHaveCount(1);
    const items = await page.locator('[data-testid="fleet-sidebar"] .nav-item').evaluateAll((els) =>
      els.map((e) => ({ id: e.getAttribute('data-testid'), href: e.getAttribute('href'), text: e.textContent?.trim() })),
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
    // FLEET_ONLY filtra Mercado y Radar V2V del menú (FleetLayout usa isRouteHidden).
    const hasMercado = items.some((i) => i.id === 'nav-mercado' && i.text === 'Mercado');
    const hasRadar = items.some((i) => i.id === 'nav-radar' && /Radar V2V/.test(i.text ?? ''));
    expect(hasMercado, 'entrada Mercado en el menú').toBe(!FLEET_ONLY);
    expect(hasRadar, 'entrada Radar V2V en el menú').toBe(!FLEET_ONLY);
    expect(items.length).toBe(FLEET_ONLY ? 16 : 18);
  });

  test('la entrada activa lleva aria-current="page" y solo ella', async ({ page }) => {
    // Con FLEET_ONLY, /fleet/mercado y /fleet/radar responden 404 (no hay entrada activa que marcar).
    const routes: Array<[string, string]> = FLEET_ONLY
      ? [
          ['/fleet/vehicles', 'nav-vehicles'],
          ['/fleet/maintenance', 'nav-maintenance'],
        ]
      : [
          ['/fleet/mercado', 'nav-mercado'],
          ['/fleet/radar', 'nav-radar'],
          ['/fleet/vehicles', 'nav-vehicles'],
        ];
    for (const [path, id] of routes) {
      await page.goto(path);
      await expect(page.getByTestId(id)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[data-testid="fleet-sidebar"] [aria-current="page"]')).toHaveCount(1);
    }
  });

  test('la campana es el contenedor posicionado del badge', async ({ page }) => {
    await page.goto('/fleet');
    const bell = page.getByTestId('notif-bell');
    expect(await bell.evaluate((el) => getComputedStyle(el).position)).toBe('relative');
    const badge = page.getByTestId('notif-badge');
    if (await badge.count()) {
      const b = (await bell.boundingBox())!;
      const k = (await badge.boundingBox())!;
      // El badge se ancla a la campana: su centro cae a menos de una campana de ella
      expect(Math.abs(k.x + k.width / 2 - (b.x + b.width / 2))).toBeLessThan(b.width + k.width);
      expect(Math.abs(k.y + k.height / 2 - (b.y + b.height / 2))).toBeLessThan(b.height + k.height);
    }
  });
});
