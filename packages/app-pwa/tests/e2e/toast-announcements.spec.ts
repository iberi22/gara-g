import { test, expect } from './fixtures';

/** Issue wave-32.04: los toasts se anuncian, duran lo suficiente, se pausan y se pueden cerrar con el dedo. */
const fire = (page: any, detail: Record<string, unknown>) =>
  page.evaluate((d: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('gara-toast', { detail: d })), detail);

test.describe('Toasts accesibles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.getByTestId('toast-container')).toBeAttached();
  });

  test('la region viva existe vacia y visible desde el principio', async ({ page }) => {
    const c = page.getByTestId('toast-container');
    expect(await c.evaluate((e) => e.hasAttribute('hidden'))).toBe(false);
    await expect(c).toHaveAttribute('aria-live', 'polite');
    await expect(c.locator('.toast-item')).toHaveCount(0);
  });

  test('error -> role=alert; exito -> role=status', async ({ page }) => {
    await fire(page, { message: 'No se pudo guardar', type: 'error' });
    await fire(page, { message: 'Guardado', type: 'success' });
    const container = page.getByTestId('toast-container');
    await expect(container.getByRole('alert')).toHaveText(/No se pudo guardar/);
    await expect(container.getByRole('status')).toHaveText(/Guardado/);
    await expect(container.getByRole('alert')).not.toContainText('Guardado');
  });

  test('el boton de cerrar mide >= 44x44 y cierra con teclado', async ({ page }) => {
    await fire(page, { message: 'Cerrame', type: 'info' });
    const close = page.locator('.toast-close').first();
    // offsetWidth/Height: tamano de layout (el boundingBox incluye el scale de la animacion de entrada)
    const size = await close.evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
    expect(size.w).toBeGreaterThanOrEqual(44);
    expect(size.h).toBeGreaterThanOrEqual(44);
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.toast-item')).toHaveCount(0);
  });

  test('un toast de 4 s dura 6 s y al apuntarlo con el raton no se auto-elimina', async ({ page }) => {
    await fire(page, { message: 'Lento', type: 'info', duration: 4000 });
    const item = page.locator('.toast-item');
    await expect(item).toHaveCount(1);
    await page.waitForTimeout(4800); // pasado el 4000 original, el toast sigue
    await expect(item).toHaveCount(1);
    await item.hover();
    await page.waitForTimeout(6500); // pausado: sigue montado mas alla de otros 6 s
    await expect(item).toHaveCount(1);
    await page.mouse.move(5, 5); // sale: se rearma con el tiempo restante y desaparece
    await expect(item).toHaveCount(0, { timeout: 9000 });
  });
});
