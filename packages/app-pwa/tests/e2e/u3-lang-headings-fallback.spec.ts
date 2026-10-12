import { test as plain } from '@playwright/test';
import { test, expect } from './fixtures';
import { useAdminSession } from './helpers/auth';

/** Issues wave-32 09 (encabezados), 20 (fallback de islas) y 21 (idioma). */
test.describe('lang es', () => {
  // Paginas sin layout propio: se comprueba el HTML del servidor (no dependen de hidratar nada).
  for (const path of ['/alerts', '/documents']) {
    test(`${path} declara lang="es" y titulo en espanol`, async ({ page }) => {
      const html = await (await page.request.get(path)).text();
      expect(html).toMatch(/<html[^>]*lang="es"/);
      expect(html).not.toMatch(/<html[^>]*lang="en"/);
      expect(html.match(/<title>([^<]*)<\/title>/)![1]).not.toMatch(/Alert Feed|Document Vault/);
    });
  }
  for (const path of ['/fleets', '/fleet/fleets']) {
    test(`${path} declara lang="es"`, async ({ page }) => {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('es');
    });
  }
  test('/fleets muestra su encabezado en espanol', async ({ page }) => {
    await page.goto('/fleets');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flotas');
    await expect(page.getByRole('columnheader', { name: 'Acciones' })).toBeVisible();
  });
  test('/alerts: h1 en espanol', async ({ page }) => {
    const html = await (await page.request.get('/alerts')).text();
    expect(html).toContain('Alertas del sistema');
    expect(html).not.toContain('System Alerts');
  });
});

test.describe('encabezados', () => {
  for (const path of ['/fuel', '/fleets']) {
    test(`${path}: un solo h1 y sin saltos de nivel`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      const levels = await page.$$eval('h1,h2,h3,h4,h5,h6', (hs) => hs.map((h) => Number(h.tagName[1])));
      expect(levels.filter((l) => l === 1).length).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `${path}: ${levels.join(',')}`).toBeLessThanOrEqual(1);
    });
  }
  test('/telemetry tiene exactamente un h1 (HTML del servidor)', async ({ page }) => {
    const html = await (await page.request.get('/telemetry')).text();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  });
});

// Sin JS solo queda el HTML del servidor: es exactamente lo que ve el usuario antes de hidratar.
// Va con el test base (no el fixture con guarda de consola): el dev server compila bajo demanda y un
// 404/500 transitorio de un reintento no es lo que se mide aqui.
plain.describe('fallback de islas', () => {
  plain.use({ javaScriptEnabled: false });
  plain('el hueco de la isla existe en el SSR, antes de hidratar', async ({ page, context }) => {
    await useAdminSession(context);
    // Sin JS: solo el HTML del servidor. Si el fallback faltara, el hueco medira 0.
    const cases: Array<[string, number]> = [
      ['/fleets', 352],
      ['/alerts', 448],
      ['/telemetry', 576],
      ['/fleet/tracking', 480],
      ['/geofences', 450],
    ];
    for (const [path, min] of cases) {
      // El dev server compila bajo demanda y la primera respuesta puede ser un error transitorio: se reintenta.
      await expect
        .poll(
          async () => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });
            return page.evaluate(() => {
              const el = document.querySelector('astro-island [style*="min-height"]') as HTMLElement | null;
              return el ? Math.round(el.getBoundingClientRect().height) : 0;
            });
          },
          { message: `${path} reserva ${min}px antes de hidratar`, timeout: 40000 },
        )
        .toBeGreaterThanOrEqual(min - 4);
    }
  });
});
