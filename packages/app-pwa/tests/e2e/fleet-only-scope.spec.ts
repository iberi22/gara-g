/**
 * fleet-only-scope.spec.ts — la entrega "solo flota" (FLEET_ONLY) a nivel HTTP y de UI.
 *
 * El unit test (tests/fleet-only-mode.test.ts) comprueba el middleware y que el
 * layout/portada filtran. Aquí se comprueba contra el servidor real lo que ve el
 * cliente de la entrega:
 *   1. las páginas y APIs fuera de alcance responden 404 (ni 401/303: no se
 *      anuncia que existen), con o sin sesión;
 *   2. las rutas de la entrega siguen respondiendo;
 *   3. no queda ningún punto de entrada visible (menú lateral y portada).
 *
 * Corre con `FLEET_ONLY=true` (el valor por defecto del Worker). Con el
 * interruptor apagado los bloques se saltan con motivo explícito: en ese
 * despliegue los módulos sí forman parte del producto y se cubren en sus specs
 * (mercado.spec.ts, radar.spec.ts).
 */
import { expect as plainExpect, test as plain } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  FLEET_DELIVERY_PAGES,
  FLEET_ONLY,
  FLEET_ONLY_HIDDEN_APIS,
  FLEET_ONLY_HIDDEN_PAGES,
} from './helpers/features';

const HIDDEN_PAGES: readonly string[] = FLEET_ONLY_HIDDEN_PAGES;
const HIDDEN_APIS: readonly string[] = FLEET_ONLY_HIDDEN_APIS;

// ── 1. Rutas ocultas → 404 (sin cookies: el 404 no depende de la sesión) ──────
plain.describe('Entrega flota-only: lo que queda fuera responde 404', () => {
  plain.skip(!FLEET_ONLY, 'FLEET_ONLY apagado: estos módulos sí forman parte del despliegue');

  for (const path of HIDDEN_PAGES) {
    plain(`página oculta ${path} -> 404`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      plainExpect(res.status(), `${path}`).toBe(404);
    });
  }

  for (const path of HIDDEN_APIS) {
    plain(`API oculta ${path} -> 404 JSON`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      plainExpect(res.status(), `${path}`).toBe(404);
      plainExpect(res.headers()['content-type'] ?? '').toContain('application/json');
      plainExpect(await res.json()).toEqual({ ok: false, error: 'Not found' });
    });
  }

  plain('un POST a una API oculta tampoco llega (404, no 401)', async ({ request }) => {
    const res = await request.post('/api/garage/ads/campaigns', {
      maxRedirects: 0,
      data: { title: 'no debería existir' },
    });
    plainExpect(res.status()).toBe(404);
  });

  plain('las rutas de la entrega siguen respondiendo (200 o login fuera de demo)', async ({ request }) => {
    for (const path of FLEET_DELIVERY_PAGES) {
      const res = await request.get(path, { maxRedirects: 0 });
      plainExpect([200, 303], `${path}`).toContain(res.status());
    }
  });
});

// ── 2. Sin puntos de entrada visibles (con sesión: el menú completo) ───────────
test.describe('Entrega flota-only: sin puntos de entrada visibles', () => {
  test.skip(!FLEET_ONLY, 'FLEET_ONLY apagado: el menú y la portada sí muestran estos módulos');

  test('el menú lateral no ofrece Mercado ni Radar V2V, y ningún enlace apunta a una ruta oculta', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.getByTestId('fleet-sidebar')).toBeVisible();
    await expect(page.getByTestId('nav-mercado')).toHaveCount(0);
    await expect(page.getByTestId('nav-radar')).toHaveCount(0);

    const hrefs = await page
      .locator('[data-testid="fleet-sidebar"] a[href]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const hidden of HIDDEN_PAGES) {
      const leaked = hrefs.filter((h) => h === hidden || h.startsWith(`${hidden}/`));
      expect(leaked, `enlaces del menú a ${hidden}`).toEqual([]);
    }
  });

  test('la portada no promete el Mercado ni su FAQ de pagos', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/?inicio=1');
    await expect(page.getByTestId('features-section')).toBeVisible();
    await expect(page.getByTestId('feature-mercado')).toHaveCount(0);
    const text = await page.locator('main').innerText();
    expect(text).not.toContain('Mercado');
  });
});
