import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('Gara-G Smoke E2E Suite Findings', () => {
  test('offline: after the first load the app shell still renders with the network blocked', async ({ app, screen, browser }) => {
    await app.open('/fleet/bienvenida');
    await expect(screen.getByTestId('onboarding-wizard')).toBeVisible();
    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByTestId('backup-checkbox').tap();
    await screen.getByTestId('choose-local').tap();
    for (let i = 0; i < 3; i++) {
        await screen.getByRole('button', 'Siguiente').tap();
    }
    await screen.getByRole('button', 'Entrar').tap();
    await expect(browser).toHaveURL(/\/fleet\/garage/);

    await app.open('/fleet/garage');
    await expect(screen.getByTestId('garage-game-hud')).toBeVisible({ timeout: 15000 });

    await browser.evaluate(async () => {
        if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
    });

    await browser.route('**/*', (route) => {
       route.abort();
    });

    await app.open('/fleet/garage');
    await expect(screen.getByTestId('garage-game-hud')).toBeVisible({ timeout: 15000 });
  });
});
