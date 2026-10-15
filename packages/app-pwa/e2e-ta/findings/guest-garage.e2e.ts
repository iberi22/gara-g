import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('Gara-G Smoke E2E Suite Findings', () => {
  test('a guest can create a vehicle and see it listed', async ({ app, screen, browser }) => {
    await app.open('/fleet/bienvenida');
    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByTestId('backup-checkbox').tap();
    await screen.getByTestId('choose-local').tap();
    for (let i = 0; i < 3; i++) {
        await screen.getByRole('button', 'Siguiente').tap();
    }
    await screen.getByRole('button', 'Entrar').tap();
    await expect(browser).toHaveURL(/\/fleet\/garage/);

    await expect(screen.getByText('ZZBC-11', { exact: false })).toBeVisible({ timeout: 15000 });

    await screen.getByTestId('guest-add').tap();
    const dialog = screen.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    await dialog.getByLabel('Modelo').selectOption({ label: 'Toyota Hilux' });
    await dialog.getByLabel('Patente').fill('ABC123');
    await dialog.getByLabel('Año').fill('2021');
    await dialog.getByLabel(/Kilometraje/).fill('30000');
    await dialog.getByRole('button', 'Agregar al garage').tap();
    await expect(dialog).toBeHidden();

    const identity = screen.getByRole('region', { name: 'Identificación del vehículo' });
    await expect(identity.getByText('ABC123', { exact: false })).toBeVisible({ timeout: 15000 });
  });
});
