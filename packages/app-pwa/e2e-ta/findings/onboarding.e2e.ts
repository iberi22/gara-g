import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('Gara-G Smoke E2E Suite Findings', () => {
  test('onboarding /fleet/bienvenida advances through its steps', async ({ app, screen }) => {
    await app.open('/fleet/bienvenida');
    await expect(screen.getByTestId('onboarding-wizard')).toBeVisible();
    await expect(screen.getByTestId('wizard-step')).toContainText('1 / 6');

    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByTestId('choose-local').tap();
    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByRole('button', 'Siguiente').tap();

    await screen.getByTestId('need-drivers').tap({ timeout: 15000 });
    await screen.getByTestId('need-live').tap();
    await screen.getByRole('button', 'Siguiente').tap();
    await screen.getByRole('button', 'Siguiente').tap();

    await expect(screen.getByTestId('wizard-step')).toContainText('6 / 6');
    await expect(screen.getByTestId('sum-reasons')).toContainText('Conductores');
  });
});
