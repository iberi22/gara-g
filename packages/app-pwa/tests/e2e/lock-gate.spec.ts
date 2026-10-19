import { test, expect } from './fixtures';

test.describe('Lock Gate', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('no gate is shown by default without protection', async ({ page }) => {
    // Navigate to a layout page
    await page.goto('/fleet/ajustes');

    // Wait for the page to load
    await expect(page.getByTestId('settings-app')).toBeVisible();

    // Verify the lock gate is not present
    await expect(page.getByTestId('lock-gate')).not.toBeVisible();

    // Verify fleet content is visible
    const isVisible = await page.locator('.fleet-content').isVisible();
    expect(isVisible).toBeTruthy();
  });

  test('gate appears and traps focus when locked, unlocks correctly with scoped selectors', async ({ page }) => {
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('settings-app')).toBeVisible();

    // Enable protection programmatically in a fresh context
    await page.evaluate(async () => {
      // @ts-ignore
      const { enableProtection } = await import('/src/lib/local/deviceLock.ts');
      await enableProtection('pin', '123456');
    });

    // Reload the page to trigger the gate
    await page.reload();

    // Verify the gate is visible and fleet-shell is inert
    const gate = page.getByTestId('lock-gate');
    await expect(gate).toBeVisible();
    await expect(page.locator('.fleet-shell')).toHaveAttribute('inert', '');

    // Focus check (the input should be automatically focused, scoped to gate)
    const pinInput = gate.locator('#lock-gate-pin');
    await expect(pinInput).toBeFocused();

    // Verify wrong PIN fails using gate-scoped selectors
    await pinInput.fill('654321');
    await gate.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(gate.getByRole('alert')).toBeVisible();

    // Verify correct PIN unlocks using gate-scoped selectors
    await pinInput.fill('123456');
    await gate.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(gate).not.toBeVisible();

    // Verify fleet-shell is no longer inert
    await expect(page.locator('.fleet-shell')).not.toHaveAttribute('inert');
  });

  test('camino bloqueado: multiples intentos fallidos activan lockout y espera por condicion', async ({ page }) => {
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('settings-app')).toBeVisible();

    await page.evaluate(async () => {
      // @ts-ignore
      const { enableProtection } = await import('/src/lib/local/deviceLock.ts');
      await enableProtection('pin', '123456');
    });

    await page.reload();

    const gate = page.getByTestId('lock-gate');
    await expect(gate).toBeVisible();

    const pinInput = gate.locator('#lock-gate-pin');
    const unlockBtn = gate.getByRole('button', { name: 'Desbloquear' });

    // Intento 1 fallido: PIN incorrecto arma retardo progresivo (lockout)
    await pinInput.fill('000000');
    await unlockBtn.click();
    await expect(gate.getByRole('alert')).toBeVisible();

    // Intento 2 inmediato mientras rige el lockout: rechaza por demasiados intentos
    await pinInput.fill('000000');
    await unlockBtn.click();
    await expect(gate.getByRole('alert')).toHaveText(/demasiados intentos/i);

    // En vez de sleep fijo (1 s flaky), esperar por condición real de expiración del lockout en IndexedDB
    await page.waitForFunction(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('gara-lock', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('gara-lock', 'readonly');
          const get = tx.objectStore('gara-lock').get('envelope');
          get.onsuccess = () => {
            const env = get.result;
            db.close();
            resolve(!env?.lockedUntil || Date.now() >= env.lockedUntil);
          };
          get.onerror = () => { db.close(); resolve(true); };
        };
        req.onerror = () => resolve(true);
      });
    });

    // Una vez expirado el lockout, el PIN correcto desbloquea con éxito
    await pinInput.fill('123456');
    await unlockBtn.click();
    await expect(gate).not.toBeVisible();
    await expect(page.locator('.fleet-shell')).not.toHaveAttribute('inert');
  });
});
