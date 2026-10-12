import { test, expect } from './fixtures';

/**
 * Issue 17: la skeleton no se pinta en el SSR (antes empujaba el contenido 150 ms despues y,
 * sin JS, tapaba la pagina para siempre).
 */
test.describe('skeleton sin JS', () => {
  test.use({ javaScriptEnabled: false });
  test('no ocupa espacio ni tapa el contenido real', async ({ page }) => {
    await page.goto('/fleet/vehicles');
    const sk = page.getByTestId('loading-skeleton');
    await expect(sk).toBeAttached();
    await expect(sk).toBeHidden();
    await expect(page.locator('h1.topbar-title')).toBeVisible();
    // El primer bloque real de la pagina es lo que esta bajo su propio centro (no la skeleton)
    const covered = await page.evaluate(() => {
      const content = document.querySelector('.fleet-content');
      const real = Array.from(content?.children ?? []).find(
        (c) => !c.matches('[data-testid="loading-skeleton"]') && (c as HTMLElement).offsetHeight > 0,
      ) as HTMLElement | undefined;
      if (!real) return 'sin-contenido';
      const r = real.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
      return top?.closest('[data-testid="loading-skeleton"]') ? 'tapado' : 'ok';
    });
    expect(covered).toBe('ok');
  });
});

test('CLS de la carga < 0.1 y la skeleton no existe en flujo al pintar', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__cls = 0;
    (window as any).__skH = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    document.addEventListener('DOMContentLoaded', () => {
      const sk = document.querySelector('[data-testid="loading-skeleton"]') as HTMLElement | null;
      (window as any).__skH.push(sk ? sk.offsetHeight : -1);
    });
  });
  await page.goto('/fleet/vehicles');
  await page.waitForTimeout(1500);
  const { cls, sk } = await page.evaluate(() => ({ cls: (window as any).__cls as number, sk: (window as any).__skH as number[] }));
  expect(sk[0]).toBe(0);
  expect(cls).toBeLessThan(0.1);
});

test('durante una navegacion del router la skeleton aparece superpuesta y se retira', async ({ page }) => {
  await page.goto('/fleet');
  const sk = page.getByTestId('loading-skeleton');
  await expect(sk).toBeHidden();
  await page.evaluate(() => document.dispatchEvent(new Event('astro:before-preparation')));
  await expect(sk).toBeVisible();
  expect(await sk.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  await page.evaluate(() => document.dispatchEvent(new Event('astro:after-preparation')));
  await expect(sk).toBeHidden();
});
