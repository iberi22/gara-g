import { test, expect, type Page } from './fixtures';

/**
 * wave-32/15 — Las geocercas se crean, editan y borran SIN raton, y los cambios llegan al servidor.
 *
 * Todo el recorrido usa teclado (Tab / Enter / teclas) sobre la lista de /geofences. Los datos de
 * partida y las comprobaciones de persistencia van por /api/fleet/geofence (el tenant lo resuelve
 * la sesion; la API no recibe el de la query en produccion).
 */

const POLY = '4.700,-74.100 4.600,-74.100 4.600,-74.000 4.700,-74.000';

async function createViaApi(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/fleet/geofence', {
    data: { name, fleetId: 'fleet-001', type: 'depot', polygon: POLY, alertOnEnter: true, alertOnExit: false },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.id;
}

async function listNames(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/fleet/geofence');
  expect(res.ok()).toBe(true);
  return ((await res.json()).data ?? []).map((g: any) => g.name);
}

/** Tab hasta que el foco cae en el control con ese aria-label (solo teclado). */
async function tabTo(page: Page, ariaLabel: string) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    if (label === ariaLabel) return;
  }
  throw new Error(`Tab no llego a "${ariaLabel}" en 80 pulsaciones`);
}

test.describe('Geocercas: editar y borrar con teclado, persistido', () => {
  test('Tab -> Editar -> Enter rellena el formulario; Enter en el formulario guarda y sobrevive al reload', async ({ page }) => {
    const name = `Kbd Edit ${Date.now() % 1e6}`;
    await createViaApi(page, name);
    await page.goto('/geofences');
    await page.waitForSelector('[data-testid="geofence-list"]');

    // Foco inicial en el cuerpo: se llega al boton solo con Tab.
    await tabTo(page, `Editar ${name}`);
    await page.keyboard.press('Enter');

    const nameInput = page.locator('#geo-name');
    await expect(nameInput).toHaveValue(name);
    await expect(nameInput).toBeFocused();
    await expect(page.getByTestId('geofence-status')).toContainText(name);

    // Escribe el nuevo nombre con el teclado y envia con Enter.
    const renamed = `${name} ok`;
    await page.keyboard.press('Control+A');
    await page.keyboard.type(renamed);
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('geofence-status')).toContainText('actualizada');
    await expect(page.locator(`button[aria-label="Editar ${renamed}"]`)).toBeVisible();

    await page.reload();
    await expect(page.locator(`button[aria-label="Editar ${renamed}"]`)).toBeVisible();
    expect(await listNames(page)).toContain(renamed);
    expect(await listNames(page)).not.toContain(name);
  });

  test('Eliminar con teclado pide confirmacion, cancelar conserva y aceptar borra tambien en el servidor', async ({ page }) => {
    const name = `Kbd Del ${Date.now() % 1e6}`;
    const id = await createViaApi(page, name);
    await page.goto('/geofences');
    await page.waitForSelector('[data-testid="geofence-list"]');
    const item = page.locator('[data-testid="geofence-item"]', { hasText: name });
    await expect(item).toHaveCount(1);

    // 1) Cancelar: sigue en la lista y en el servidor.
    await tabTo(page, `Eliminar ${name}`);
    page.once('dialog', async (d) => {
      expect(d.type()).toBe('confirm');
      expect(d.message()).toContain(name);
      await d.dismiss();
    });
    await page.keyboard.press('Enter');
    await expect(item).toHaveCount(1);
    expect(await listNames(page)).toContain(name);

    // 2) Aceptar: desaparece de la lista...
    page.once('dialog', (d) => d.accept());
    await page.keyboard.press('Enter');
    await expect(item).toHaveCount(0);
    await expect(page.getByTestId('geofence-status')).toContainText('eliminada');
    // ...el foco no se pierde en <body>: pasa al titulo de la lista...
    await expect(page.locator('#geo-list-title')).toBeFocused();

    // ...y sigue borrada tras recargar y por la API (un borrado solo en cliente falla aqui).
    await page.reload();
    await page.waitForSelector('[data-testid="geofence-map-component"]');
    await expect(page.locator('[data-testid="geofence-item"]', { hasText: name })).toHaveCount(0);
    const res = await page.request.get(`/api/fleet/geofence?id=${id}`);
    expect(res.status()).toBe(404);
    expect(await listNames(page)).not.toContain(name);
  });

  test('crear con teclado: rellenar el formulario y Enter persiste la geocerca', async ({ page }) => {
    const name = `Kbd New ${Date.now() % 1e6}`;
    await page.goto('/geofences');
    await page.waitForSelector('[data-testid="geofence-map-component"]');

    await page.locator('#geo-name').focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('geofence-status')).toContainText('creada');
    await expect(page.locator(`button[aria-label="Editar ${name}"]`)).toBeVisible();
    await page.reload();
    await expect(page.locator(`button[aria-label="Editar ${name}"]`)).toBeVisible();
    expect(await listNames(page)).toContain(name);
  });

  test('los controles tienen nombre accesible y el mapa avisa de que la lista es el camino textual', async ({ page }) => {
    const name = `Kbd A11y ${Date.now() % 1e6}`;
    await createViaApi(page, name);
    await page.goto('/geofences');
    await page.waitForSelector('[data-testid="geofence-list"]');
    await expect(page.getByRole('button', { name: `Editar ${name}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Eliminar ${name}` })).toBeVisible();
    await expect(page.getByRole('list', { name: /geocercas/i }).or(page.locator('ul[data-testid="geofence-list"]'))).toBeVisible();
    await expect(page.getByRole('region', { name: /Mapa de geocercas/ })).toBeVisible();
  });
});
