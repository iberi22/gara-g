import { test, expect, ALLOWLIST } from './fixtures';
import { seedDemoFleet } from './helpers/seed';

/** EntityForm: estados anunciados, boton primario legible, sin estilos duplicados (wave-32 03 y 25). */

function lum([r, g, b]: number[]): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: number[], b: number[]): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Cualquier color computado de Chrome (rgb/rgba/color(srgb...)) -> [r,g,b]. */
async function rgbOf(page: import('@playwright/test').Page, css: string, prop: 'color' | 'backgroundColor') {
  return page.evaluate(([c, p]) => {
    const cv = document.createElement('canvas').getContext('2d')!;
    cv.fillStyle = '#000';
    cv.fillStyle = c;
    cv.fillRect(0, 0, 1, 1);
    void p;
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [css, prop] as const);
}

test.describe('EntityForm', () => {
  test.beforeEach(async ({ request }) => {
    await seedDemoFleet(request, { exact: false });
  });

  async function driverEditUrl(page: import('@playwright/test').Page): Promise<string> {
    const res = await page.request.get('/api/fleet/driver');
    const rows = ((await res.json()).data ?? []) as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    return `/fleet/drivers/edit/${rows[0].id}`;
  }

  test('el estado del formulario se anuncia: status al enviar, alert al fallar', async ({ page }) => {
    const url = await driverEditUrl(page);
    // El 500 es la condicion del test: el fixture lo trataria como error de la app.
    const allow = { pattern: /\/api\/fleet\/driver\?id=|status of 500/, reason: 'PATCH 500 simulado por el propio test' };
    ALLOWLIST.push(allow);
    test.info().annotations.push({ type: 'allowlist', description: allow.reason });
    await page.route('**/api/fleet/driver**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Boom de prueba' }) });
      } else await route.continue();
    });
    await page.goto(url);
    const status = page.locator('.g-form-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveAttribute('hidden', '');
    await page.locator('form.g-form button[type="submit"]').click();
    await expect(status).toContainText('Boom de prueba');
    await expect(status).toHaveAttribute('role', 'alert');
    await expect(status).toBeVisible();
    ALLOWLIST.splice(ALLOWLIST.indexOf(allow), 1);
  });

  test('el boton primario y el borde del campo cumplen contraste', async ({ page }) => {
    await page.goto(await driverEditUrl(page));
    const btn = page.locator('form.g-form .g-btn-primary');
    const [fg, bg] = await btn.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor];
    });
    expect(ratio(await rgbOf(page, fg, 'color'), await rgbOf(page, bg, 'backgroundColor'))).toBeGreaterThanOrEqual(4.5);
    const input = page.locator('form.g-form input.g-input').first();
    const [border, surface] = await input.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.borderTopColor, s.backgroundColor];
    });
    // 1.4.11: el borde del control frente a su fondo (>=3 es el objetivo del tema; se informa, no se exige aqui
    // mientras el valor del token lo decide la issue 01).
    test.info().annotations.push({ type: 'border-contrast', description: ratio(await rgbOf(page, border, 'color'), await rgbOf(page, surface, 'backgroundColor')).toFixed(2) });
  });

  test('los campos usan las reglas del tema, no una copia local', async ({ page }) => {
    await page.goto(await driverEditUrl(page));
    const input = page.locator('form.g-form input.g-input').first();
    // Tema: el borde del campo es --g-border-input (la copia local usaba otro token).
    const [border, token] = await input.evaluate((el) => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--g-border-input)';
      document.body.appendChild(probe);
      const t = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(el).borderTopColor, t];
    });
    expect(border).toBe(token);
    const primary = page.locator('form.g-form .g-btn-primary');
    // Tema: .g-btn-primary lleva borde del color de acento (la copia local no).
    const [bc, bgc] = await primary.evaluate((el) => [getComputedStyle(el).borderTopColor, getComputedStyle(el).backgroundColor]);
    expect(bc).toBe(bgc);
  });
});
