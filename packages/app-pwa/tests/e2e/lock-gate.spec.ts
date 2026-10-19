import { test, expect, type Page } from './fixtures';

/** Lee el sobre persistido del candado (`gara-lock`/`envelope`) desde la página. */
function readLockEnvelopeInPage(): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gara-lock', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('gara-lock');
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('gara-lock', 'readonly').objectStore('gara-lock').get('envelope');
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

/** true si no hay lockout o ya expiró (`lockedUntil` ya no está en el futuro). */
function lockoutExpiredInPage(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gara-lock', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('gara-lock');
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('gara-lock', 'readonly').objectStore('gara-lock').get('envelope');
      get.onsuccess = () => {
        db.close();
        const lockedUntil = get.result?.lockedUntil as number | undefined;
        resolve(!lockedUntil || Date.now() >= lockedUntil);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

async function writeLockEnvelope(page: Page, env: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('gara-lock', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('gara-lock', 'readwrite');
          tx.objectStore('gara-lock').put(value, 'envelope');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    env
  );
}

async function enableLockWithPin(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-ignore
    const { enableProtection } = await import('/src/lib/local/deviceLock.ts');
    await enableProtection('pin', '123456');
  });
}

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
    await enableLockWithPin(page);

    // Reload the page to trigger the gate
    await page.reload();

    // Verify the gate is visible and fleet-shell is inert
    const gate = page.getByTestId('lock-gate');
    await expect(gate).toBeVisible();
    await expect(page.locator('.fleet-shell')).toHaveAttribute('inert', '');

    // Focus check (the input should be automatically focused, scoped to gate)
    const pinInput = gate.locator('#lock-gate-pin');
    await expect(pinInput).toBeFocused();

    // Un PIN de 3 dígitos no es válido: el botón queda deshabilitado y el input no pasa la validación
    await pinInput.fill('123');
    await expect(gate.getByRole('button', { name: 'Desbloquear' })).toBeDisabled();
    expect(await pinInput.evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(true);
    await pinInput.fill('');

    // Verify wrong PIN fails using gate-scoped selectors
    await pinInput.fill('654321');
    await gate.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(gate.getByRole('alert')).toBeVisible();
    await expect(pinInput).toHaveAttribute('aria-invalid', 'true');
    await expect(pinInput).toHaveAttribute('aria-describedby', 'lock-gate-error');

    // El primer fallo arma un retardo (1 s): esperar a que expire por condición real, no por sleep
    await expect.poll(() => page.evaluate(lockoutExpiredInPage), { timeout: 10000 }).toBe(true);

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

    await enableLockWithPin(page);

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

    // En vez de sleep fijo, esperar por la expiración real del lockout en IndexedDB
    await expect.poll(() => page.evaluate(lockoutExpiredInPage), { timeout: 10000 }).toBe(true);

    // Una vez expirado el lockout, el PIN correcto desbloquea con éxito
    await pinInput.fill('123456');
    await unlockBtn.click();
    await expect(gate).not.toBeVisible();
    await expect(page.locator('.fleet-shell')).not.toHaveAttribute('inert');
  });

  test('transición interrumpida: el gate se muestra con el aviso de transición', async ({ page }) => {
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('settings-app')).toBeVisible();
    await enableLockWithPin(page);

    // Sobre con una transición interrumpida (sobres presentes, estado 'transition').
    const env = await page.evaluate(readLockEnvelopeInPage);
    await writeLockEnvelope(page, { ...env, state: 'transition' });

    await page.reload();

    const gate = page.getByTestId('lock-gate');
    await expect(gate).toBeVisible();
    await expect(gate.locator('#lock-gate-desc')).toBeVisible();
    await expect(page.locator('.fleet-shell')).toHaveAttribute('inert', '');
  });

  test('tras recargar, el botón de passkey sale del sobre persistido y el PIN sigue obligatorio', async ({ page }) => {
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('settings-app')).toBeVisible();
    await enableLockWithPin(page);

    // Simula un sobre con passkey persistido (la UI sólo mira su presencia; el unlock real no se ejercita aquí).
    const env = await page.evaluate(readLockEnvelopeInPage);
    await writeLockEnvelope(page, { ...env, passkeyEnvelope: env?.pinEnvelope });

    await page.reload();

    const gate = page.getByTestId('lock-gate');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Usar passkey' })).toBeVisible();
    // El PIN de respaldo sigue siendo obligatorio
    await expect(gate.locator('#lock-gate-pin')).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Desbloquear' })).toBeDisabled();
  });

  test('sin passkey persistida no se ofrece el botón', async ({ page }) => {
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('settings-app')).toBeVisible();
    await enableLockWithPin(page);
    await page.reload();

    const gate = page.getByTestId('lock-gate');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Usar passkey' })).toHaveCount(0);
  });

  test('sobre ilegible: fail-closed, sin formulario y con la app inerte', async ({ page }) => {
    // Simula IndexedDB del candado inaccesible: el estado es 'error', no 'off'.
    await page.addInitScript(() => {
      const realOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name: string, version?: number) => {
        if (name === 'gara-lock') throw new Error('storage denegado');
        return realOpen(name, version);
      };
    });

    await page.goto('/fleet/ajustes');

    const gate = page.getByTestId('lock-gate');
    await expect(gate).toHaveAttribute('data-state', 'error');
    await expect(gate.getByRole('alert')).toBeVisible();
    await expect(gate.locator('#lock-gate-pin')).toHaveCount(0);
    await expect(gate.getByRole('button', { name: 'Recargar' })).toBeVisible();
    await expect(page.locator('.fleet-shell')).toHaveAttribute('inert', '');
  });

  test('mientras se resuelve el estado, la app ya está inerte', async ({ page }) => {
    // Retiene la apertura de `gara-lock` hasta que el test la libere: el estado sigue en 'loading'.
    await page.addInitScript(() => {
      const realOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name: string, version?: number) => {
        if (name !== 'gara-lock') return realOpen(name, version);
        const fake: Record<string, unknown> = { result: undefined, error: null };
        const start = () => {
          const real = realOpen(name, version);
          real.onupgradeneeded = (e) => {
            fake.result = real.result;
            (fake.onupgradeneeded as ((ev: unknown) => void) | undefined)?.(e);
          };
          real.onsuccess = (e) => {
            fake.result = real.result;
            (fake.onsuccess as ((ev: unknown) => void) | undefined)?.(e);
          };
          real.onerror = (e) => {
            fake.error = real.error;
            (fake.onerror as ((ev: unknown) => void) | undefined)?.(e);
          };
        };
        const wait = () => ((window as unknown as Record<string, unknown>).__releaseGate ? start() : setTimeout(wait, 50));
        wait();
        return fake as unknown as IDBOpenDBRequest;
      };
    });

    await page.goto('/fleet/ajustes');

    const gate = page.getByTestId('lock-gate');
    await expect(gate).toHaveAttribute('data-state', 'loading');
    await expect(page.locator('.fleet-shell')).toHaveAttribute('inert', '');

    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__releaseGate = true;
    });
    await expect(gate).toHaveCount(0);
    await expect(page.locator('.fleet-shell')).not.toHaveAttribute('inert');
  });

  test('la puerta cubre las rutas de aplicación (BaseLayout y laboratorio), no sólo FleetLayout', async ({ page }) => {
    await page.goto('/fleet/ajustes');
    await expect(page.getByTestId('settings-app')).toBeVisible();
    await enableLockWithPin(page);

    for (const route of ['/fleets', '/drivers', '/fleet/garage/lab']) {
      await page.goto(route);
      const gate = page.getByTestId('lock-gate');
      await expect(gate, route).toBeVisible();
      await expect(gate.locator('#lock-gate-pin'), route).toBeVisible();
      await expect(page.locator('.fleet-shell, [data-lock-gate-target]').first(), route).toHaveAttribute('inert', '');
    }
  });
});
