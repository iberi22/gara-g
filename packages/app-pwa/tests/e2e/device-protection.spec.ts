import { test, expect, type Locator, type Page } from './fixtures';

const PIN = '123456';
const CODE_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){6}$/;
// PBKDF2 de 600k iteraciones + compilación bajo demanda en dev: margen amplio.
const SLOW = { timeout: 30 * 1000 };

/**
 * Vuelca todo lo persistido en el navegador (localStorage, sessionStorage e IndexedDB:
 * claves y valores, ArrayBuffer como bytes latin1) para buscar el código en claro.
 * Devuelve también el número de registros para demostrar que el volcado no está vacío.
 */
async function dumpBrowserStorage(page: Page): Promise<{ text: string; records: number }> {
  return page.evaluate(async () => {
    const bytesToText = (bytes: Uint8Array): string => {
      let out = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        out += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      return out;
    };
    const replacer = (_key: string, value: unknown) => {
      if (value instanceof ArrayBuffer) return bytesToText(new Uint8Array(value));
      if (ArrayBuffer.isView(value)) return bytesToText(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return value;
    };

    const parts: string[] = [];
    let records = 0;
    for (const [k, v] of Object.entries(localStorage)) {
      parts.push(k, v);
      records++;
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) ?? '';
      parts.push(k, sessionStorage.getItem(k) ?? '');
      records++;
    }

    const databases = await indexedDB.databases();
    for (const info of databases) {
      if (!info.name) continue;
      const name = info.name;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        for (const storeName of Array.from(db.objectStoreNames)) {
          const store = db.transaction(storeName, 'readonly').objectStore(storeName);
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
            const req = store.getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          parts.push(JSON.stringify(keys, replacer) ?? '', JSON.stringify(values, replacer) ?? '');
          records += values.length;
        }
      } finally {
        db.close();
      }
    }
    return { text: parts.join('\n'), records };
  });
}

async function expectCodeNotPersisted(page: Page, code: string): Promise<void> {
  const dump = await dumpBrowserStorage(page);
  expect(dump.records, 'el volcado de almacenamiento debe contener datos').toBeGreaterThan(0);
  // Sin expect(dump.text) para no volcar el almacenamiento en el log de CI.
  expect(dump.text.includes(code), 'el código no debe aparecer en claro en el almacenamiento').toBe(false);
  expect(dump.text.includes(code.replace(/-/g, '')), 'el código sin guiones no debe aparecer').toBe(false);
}

async function openSettings(page: Page): Promise<Locator> {
  await page.goto('/fleet/ajustes');
  const card = page.locator('[data-testid="protection-card"]');
  await expect(card).toBeVisible();
  return card;
}

/** Activa la protección con PIN y devuelve el código mostrado. */
async function activate(page: Page, card: Locator): Promise<string> {
  await card.locator('input#pin-enable').fill(PIN);
  await card.getByRole('button', { name: 'Activar protección' }).click();
  const codeBlock = card.locator('code.code-block');
  await expect(codeBlock).toBeVisible(SLOW);
  const code = (await codeBlock.textContent())?.trim() ?? '';
  expect(code).toMatch(CODE_RE);
  return code;
}

test.describe('Device Protection Settings UI', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Muestra la tarjeta de protección y maneja error de PIN corto sin cambiar estado', async ({ page }) => {
    await page.goto('/fleet/ajustes');

    const card = page.locator('[data-testid="protection-card"]');
    await expect(card).toBeVisible();

    await expect(card.getByText('Tus datos están guardados en texto plano en este navegador')).toBeVisible();

    const btnActivar = card.getByRole('button', { name: 'Activar protección', exact: true });
    await expect(btnActivar).toBeVisible();

    const pinInput = card.locator('input#pin-enable');
    await pinInput.fill('123'); // only 3 digits

    await btnActivar.click();

    const errorMsg = card.locator('.error-msg');
    await expect(errorMsg).toHaveText('PIN debe tener exactamente 6 dígitos');

    await expect(btnActivar).toBeVisible();
  });

  test('estado off: no hay código de recuperación', async ({ page }) => {
    const card = await openSettings(page);
    await expect(card.locator('.recovery-box')).toHaveCount(0);
    await expect(card.locator('code.code-block')).toHaveCount(0);
  });

  test('activar muestra un código con formato válido, enfocado, y no lo persiste en el navegador', async ({ page }) => {
    const card = await openSettings(page);
    const code = await activate(page, card);

    expect(code.replace(/-/g, '')).not.toMatch(/^0+$/);
    await expect(card.locator('.recovery-box')).toBeFocused();
    await expectCodeNotPersisted(page, code);

    // El formulario de activar desaparece mientras la protección está activa.
    await expect(card.getByRole('button', { name: 'Activar protección', exact: true })).toHaveCount(0);
    await expect(card.locator('input#pin-enable')).toHaveCount(0);
  });

  test('"Ya lo guardé" limpia el código y no reaparece tras recargar', async ({ page }) => {
    const card = await openSettings(page);
    await activate(page, card);

    await card.getByRole('button', { name: 'Ya lo guardé' }).click();
    await expect(card.locator('code.code-block')).toHaveCount(0);
    await expect(card.locator('.recovery-box')).toHaveCount(0);

    await page.reload();
    await expect(card.getByRole('button', { name: 'Desbloquear' })).toBeVisible(SLOW);
    await expect(card.locator('code.code-block')).toHaveCount(0);
    await expect(card.locator('.recovery-box')).toHaveCount(0);
  });

  test('"Bloquear ahora" borra el código y no vuelve a mostrarlo al desbloquear', async ({ page }) => {
    const card = await openSettings(page);
    await activate(page, card);

    await card.getByRole('button', { name: 'Bloquear ahora' }).click();
    await expect(card.locator('code.code-block')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Desbloquear' })).toBeVisible(SLOW);

    await card.locator('input#pin-unlock').fill(PIN);
    await card.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(card.getByRole('button', { name: 'Bloquear ahora' })).toBeVisible(SLOW);
    await expect(card.locator('code.code-block')).toHaveCount(0);
    await expect(card.locator('.recovery-box')).toHaveCount(0);
  });

  test('"Desactivar protección" borra el código y vuelve a "Activar protección"', async ({ page }) => {
    const card = await openSettings(page);
    await activate(page, card);

    await card.getByRole('button', { name: 'Desactivar protección', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Activar protección', exact: true })).toBeVisible(SLOW);
    await expect(card.locator('code.code-block')).toHaveCount(0);
    await expect(card.locator('.recovery-box')).toHaveCount(0);

    await page.reload();
    await expect(card.getByRole('button', { name: 'Activar protección', exact: true })).toBeVisible(SLOW);
    await expect(card.locator('code.code-block')).toHaveCount(0);
  });

  test('tras recargar con la protección activa no hay código', async ({ page }) => {
    const card = await openSettings(page);
    await activate(page, card);

    await page.reload();
    await expect(card.getByRole('button', { name: 'Desbloquear' })).toBeVisible(SLOW);
    await expect(card.locator('code.code-block')).toHaveCount(0);
    await expect(card.locator('.recovery-box')).toHaveCount(0);
  });

  test('mientras procesa, los botones están deshabilitados y no se duplica la activación', async ({ page }) => {
    // Ralentiza las operaciones SubtleCrypto para que el estado "procesando" sea observable.
    await page.addInitScript(() => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const proto = SubtleCrypto.prototype as any;
      for (const name of ['deriveBits', 'deriveKey'] as const) {
        const original = proto[name];
        proto[name] = async function (this: SubtleCrypto, ...args: unknown[]) {
          await delay(1500);
          return original.apply(this, args);
        };
      }
    });

    const card = await openSettings(page);
    await card.locator('input#pin-enable').fill(PIN);
    const btnActivar = card.getByRole('button', { name: 'Activar protección', exact: true });
    const btnPasskey = card.getByRole('button', { name: 'Usar passkey' });

    await btnActivar.dblclick();
    await expect(card.getByText('Procesando…')).toBeVisible();
    await expect(btnActivar).toBeDisabled();
    await expect(btnPasskey).toBeDisabled();

    const codeBlock = card.locator('code.code-block');
    await expect(codeBlock).toBeVisible(SLOW);
    await expect(card.locator('.error-msg')).toHaveCount(0);
    await expect(card.getByText('Procesando…')).toHaveCount(0);
  });
});
