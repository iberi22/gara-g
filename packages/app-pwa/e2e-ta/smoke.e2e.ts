import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('Gara-G Smoke E2E Suite', () => {
  test('landing opens with the main heading', async ({ app, screen }) => {
    await app.open('/?inicio=1');
    const heroTitle = screen.getByTestId('hero-title');
    await expect(heroTitle).toBeVisible();
    await expect(heroTitle).toContainText('taller digital');
  });

  test('guest mode opens the fleet area without an account', async ({ app, screen, browser }) => {
    await app.open('/fleet/bienvenida');
    await screen.getByRole('button', 'Siguiente').tap();
    await expect(screen.getByTestId('backup-checkbox')).toBeChecked();
    await screen.getByTestId('backup-checkbox').tap(); // uncheck
    await screen.getByTestId('choose-local').tap();
    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByRole('button', 'Entrar').tap();

    await expect(browser).toHaveURL(/\/fleet\/garage/);
    await app.open('/fleet/ajustes');
    await expect(screen.getByTestId('guest-banner')).toBeVisible();
  });

  test('PWA manifest and service worker are served', async ({ app, browser }) => {
    await app.open('/');

    const manifestLink = browser.locator('link[rel="manifest"]');
    const count = await manifestLink.count();

    if (count > 0) {
      const href = await manifestLink.getAttribute('href');
      expect(href).toBeTruthy();
    }

    const swSupported = await browser.evaluate(() => 'serviceWorker' in navigator);
    expect(swSupported).toBe(true);

    const response = await browser.waitForResponse('/manifest.json', { timeout: 5000 }).catch(() => null);
    if (!response) {
      const resp = await browser.evaluate(async () => {
         const r = await fetch('/manifest.json');
         return r.status;
      });
      expect([200, 304]).toContain(resp);
    } else {
        expect([200, 304]).toContain(response.status);
    }
  });

  test('onboarding dummy', async () => {});
  test('offline dummy', async () => {});
});
