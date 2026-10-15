import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('gara e2e mutating flows', () => {
  test('3. onboarding /fleet/bienvenida advances through its steps', async ({ app, screen }) => {
    await app.open('/fleet/bienvenida');
    await expect(screen.getByTestId('onboarding-wizard')).toBeVisible();
    await expect(screen.getByTestId('wizard-step')).toContainText('1 /');

    // Step 1 -> Step 2
    await screen.getByRole('button', { name: 'Siguiente' }).tap();
    await expect(screen.getByTestId('wizard-step')).toContainText('2 /');

    // Step 2: Choose local storage to enable progress
    await screen.getByTestId('choose-local').tap();

    // Step 3 -> Step 4 -> Step 5 -> Step 6
    for (let i = 0; i < 3; i++) {
      await screen.getByRole('button', { name: 'Siguiente' }).tap();
    }
    await expect(screen.getByTestId('wizard-step')).toContainText('6 / 6');
  });

  test('4. a guest can create a vehicle and see it listed', async ({ app, screen, browser }) => {
    await browser.setCookies([
      { name: 'gara_mode', value: 'guest', url: app.baseUrl },
      { name: 'gara_app', value: '1', url: app.baseUrl },
    ]);
    await app.open('/fleet/garage?gl=1');

    const dialog = screen.getByRole('dialog');
    const addButton = screen.getByTestId('guest-add');

    await expect(addButton).toBeVisible({ timeout: 30_000 });
    await addButton.tap();

    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByLabel('Modelo').selectOption({ label: 'Toyota Hilux' });
    await dialog.getByLabel('Patente').fill('TAE2E1');
    await dialog.getByLabel('Año').fill('2022');
    await dialog.getByLabel(/Kilometraje/).fill('12000');
    await dialog.getByRole('button', { name: 'Agregar al garage' }).tap();

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(screen.getByRole('region', { name: 'Identificación del vehículo' })).toContainText('TAE2E1');
  });
});
