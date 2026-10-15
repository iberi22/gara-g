import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('gara e2e smoke suite', () => {
  test('1. landing opens with the main heading', async ({ app, screen }) => {
    await app.open('/?inicio=1');
    await expect(screen.getByTestId('hero-section')).toBeVisible();
    await expect(screen.getByTestId('hero-title')).toContainText('taller digital');
  });

  test('2. guest mode opens the fleet area without an account', async ({ app, screen, browser }) => {
    await browser.setCookies([
      { name: 'gara_mode', value: 'guest', url: app.baseUrl },
      { name: 'gara_app', value: '1', url: app.baseUrl },
    ]);
    await app.open('/fleet/ajustes');
    await expect(screen.getByTestId('guest-banner')).toBeVisible();
    await expect(screen.getByTestId('guest-banner')).toContainText('Modo local');
  });

  test('5. offline: after the first load the app shell still renders with the network blocked', async ({ app, screen, browser }) => {
    await app.open('/?inicio=1');
    await expect(screen.getByTestId('hero-section')).toBeVisible();

    await browser.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });

    await browser.route('**/*', (route) => route.abort());

    await app.open('/?inicio=1');
    await expect(screen.getByTestId('hero-section')).toBeVisible();
  });

  test('6. PWA manifest and service worker are served', async ({ app, screen, browser }) => {
    await app.open('/?inicio=1');

    const swSupported = await browser.evaluate(() => 'serviceWorker' in navigator);
    expect(swSupported).toBe(true);

    const manifestStatus = await browser.evaluate(async () => {
      const res = await fetch('/manifest.json');
      return res.status;
    });
    expect([200, 304]).toContain(manifestStatus);

    const swStatus = await browser.evaluate(async () => {
      const res = await fetch('/sw.js');
      return res.status;
    });
    expect([200, 304]).toContain(swStatus);
  });
});
