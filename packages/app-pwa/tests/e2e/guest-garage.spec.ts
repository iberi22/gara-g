/**
 * guest-garage.spec.ts — El garage 3D en modo invitado (sin cuenta): los datos viven en
 * IndexedDB de este navegador, se crea y se edita sin salir del garage y NO hay ninguna
 * petición a /api/garage/* ni a /api/fleet/*.
 *
 * Desde 2ff44ea9 / #1053 el garage nuevo NO abre vacío: `ensureDemoVehicle` siembra una vez
 * el camión de ejemplo (Kenworth ZZBC-11, el primero de la flota demo chilena). El estado
 * vacío solo aparece si el visitante borra todo, y el ejemplo no resucita al recargar.
 *
 * Corre con `PUBLIC_DEMO=true` (abre /fleet* sin sesión fuera de producción) y la cookie
 * `gara_mode=guest`. No usa el fixture global (que inyecta una sesión de admin): aquí no hay
 * sesión a propósito. El garage 3D en headless necesita `?gl=1` (WebGL2).
 */
import { type Page, expect, test } from '@playwright/test';
import { GUEST_COOKIE, GUEST_COOKIE_VALUE } from '../../src/lib/appMode';
import { CHILE_DEMO_SAMPLE_VEHICLE } from '../../src/lib/demoChile';
import { authCookieUrl } from './helpers/auth';

// Dev compila bajo demanda y el equipo suele estar cargado: expects con margen.
const slow = expect.configure({ timeout: 30_000 });
const GARAGE = '/fleet/garage?gl=1';
const SHOTS = process.env.GARAGE_SHOTS_DIR;
/** Vehiculo de ejemplo sembrado en el primer arranque (Kenworth T800, ZZBC-11). */
const SAMPLE = {
  plate: CHILE_DEMO_SAMPLE_VEHICLE.plate,
  model: CHILE_DEMO_SAMPLE_VEHICLE.model,
  km: `${CHILE_DEMO_SAMPLE_VEHICLE.usage.toLocaleString('es-CL')} km`,
};

test.describe('garage en modo invitado', () => {
  // El primer arranque en dev compila three.js y las islas: margen amplio.
  test.setTimeout(180_000);
  test.use({ actionTimeout: 60_000 });
  let forbidden: string[];
  let errors: string[];

  test.beforeEach(async ({ page, context }) => {
    forbidden = [];
    errors = [];
    await context.addCookies([{ name: GUEST_COOKIE, value: GUEST_COOKIE_VALUE, url: authCookieUrl() }]);
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (path.startsWith('/api/garage/') || path.startsWith('/api/fleet/')) forbidden.push(`${req.method()} ${path}`);
    });
    page.on('response', (res) => {
      if (res.status() !== 401) return;
      const path = new URL(res.url()).pathname;
      // /api/prefs lo pide el store de preferencias (swal-prefs, de otro frente) y sin sesion
      // responde 401; no es del garage. Cualquier otro 401 si lo es: mandaria a /login.
      if (path !== '/api/prefs') errors.push(`401 ${path}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(`console.error: ${m.text().slice(0, 200)}`);
    });
  });

  test.afterEach(() => {
    expect(forbidden, 'peticiones de red prohibidas en modo invitado').toEqual([]);
    expect(errors, 'errores de consola').toEqual([]);
  });

  async function addHilux(page: Page) {
    const dialog = page.getByRole('dialog');
    await slow(dialog).toBeVisible();
    await dialog.getByLabel('Modelo').selectOption({ label: 'Toyota Hilux' });
    await dialog.getByLabel('Placa').fill('abc123');
    await dialog.getByLabel('Año').fill('2020');
    await dialog.getByLabel(/Kilometraje/).fill('45000');
    await dialog.getByRole('button', { name: 'Agregar al garage' }).click();
    await slow(dialog).toBeHidden();
  }

  /** Contador del carrusel ("1/2 // ..."). */
  const counter = (page: Page) => page.locator('.fleet-counter');

  /**
   * El garage nuevo abre con UN vehiculo de ejemplo (ensureDemoVehicle, desde 2ff44ea9/#1053):
   * el Kenworth ZZBC-11 de la flota demo chilena. Nunca vacio, nunca el mock.
   */
  async function expectSampleOnly(page: Page) {
    await slow(page.getByText(SAMPLE.plate, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await slow(counter(page)).toContainText('1/1');
    await expect(page.getByText(SAMPLE.model, { exact: false }).first()).toBeVisible();
    await expect(page.getByText('TU PARQUE ESTÁ VACÍO')).toBeHidden();
  }

  /** Recorre el carrusel hasta que el vehiculo con esa placa sea el actual. */
  async function selectPlate(page: Page, plate: string) {
    const identity = page.getByRole('region', { name: 'Identificación del vehículo' });
    for (let i = 0; i < 4; i++) {
      if (await identity.getByText(plate, { exact: false }).isVisible()) return;
      await page.getByRole('button', { name: 'Siguiente vehículo' }).click();
    }
    await slow(identity.getByText(plate, { exact: false })).toBeVisible();
  }

  async function deleteCurrent(page: Page) {
    await page.getByTestId('guest-delete').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar vehículo' }).click();
    await slow(page.getByRole('dialog')).toBeHidden();
  }

  test('abre con el camión de ejemplo, agregar, recargar, mantenimiento y borrar, sin red', async ({ page }) => {
    await page.goto(GARAGE);

    // Primera visita: el camión de ejemplo, no el estado vacío ni el mock.
    await expectSampleOnly(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-ejemplo.png` });
    await slow(page.getByTestId('guest-monitoring')).toContainText('Disponible con cuenta');

    // Agregar desde la barra del garage: queda seleccionado y el parque pasa a 2.
    await page.getByTestId('guest-add').click();
    await addHilux(page);
    const identity = page.getByRole('region', { name: 'Identificación del vehículo' });
    await slow(identity.getByText('ABC123', { exact: false })).toBeVisible();
    await slow(counter(page)).toContainText('/2');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-vehiculo.png` });

    // Recargar: los dos siguen ahí (IndexedDB) y el ejemplo no se vuelve a sembrar (sigue en 2).
    await page.reload();
    await slow(counter(page)).toContainText('/2');
    await selectPlate(page, 'ABC123');
    await selectPlate(page, SAMPLE.plate);
    await selectPlate(page, 'ABC123');

    // Mantenimiento: se refleja en el historial
    await page.getByTestId('guest-maintenance').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Qué se hizo').fill('Cambio de aceite y filtro');
    await dialog.getByLabel('Costo (COP)').fill('180000');
    await dialog.getByRole('button', { name: 'Registrar' }).click();
    await slow(dialog).toBeHidden();
    await page.getByRole('button', { name: /historial/i }).first().click();
    await slow(page.getByText('Cambio de aceite y filtro').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Lo que necesita cuenta explica, no falla
    await page.getByRole('button', { name: /wiki/i }).first().click();
    await slow(page.getByTestId('guest-blocked-panel')).toBeVisible();
    await page.keyboard.press('Escape');

    // Borrar el agregado → vuelve a quedar solo el ejemplo
    await deleteCurrent(page);
    await expectSampleOnly(page);
    await expect(page.getByText('ABC123', { exact: false })).toHaveCount(0);

    // Borrar también el ejemplo → estado vacío, y no resucita al recargar
    await deleteCurrent(page);
    await slow(page.getByText('TU PARQUE ESTÁ VACÍO')).toBeVisible();
    await expect(page.getByTestId('guest-add-first')).toBeVisible();
    await page.reload();
    await slow(page.getByText('TU PARQUE ESTÁ VACÍO')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(SAMPLE.plate, { exact: false })).toHaveCount(0);
  });

  test('diálogo accesible: foco atrapado, Esc cierra, errores por campo', async ({ page }) => {
    await page.goto(GARAGE);
    await expectSampleOnly(page);
    const opener = page.getByTestId('guest-add');
    await opener.click();
    const dialog = page.getByRole('dialog');
    await slow(dialog).toBeVisible();
    // Enviar vacío: error en el primer campo, con el foco en él
    await dialog.getByRole('button', { name: 'Agregar al garage' }).click();
    await slow(dialog.getByRole('alert').first()).toBeVisible();
    await slow(dialog.getByLabel('Modelo')).toBeFocused();
    // El foco no se escapa del diálogo
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await slow(dialog).toBeHidden();
    await slow(opener).toBeFocused();
    // Cancelar no agrega nada
    await expect(counter(page)).toContainText('1/1');
  });

  test('editar y actualizar el kilometraje', async ({ page }) => {
    await page.goto(GARAGE);
    await expectSampleOnly(page);
    await page.getByTestId('guest-add').click();
    await addHilux(page);
    await selectPlate(page, 'ABC123');

    await page.getByTestId('guest-usage').click();
    await page.getByRole('dialog').getByLabel(/Kilometraje/).fill('52000');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar lectura' }).click();
    await slow(page.getByText('52.000').first()).toBeVisible();

    await page.getByTestId('guest-edit').click();
    await page.getByRole('dialog').getByLabel('Placa').fill('xyz789');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
    await slow(page.getByText('XYZ789').first()).toBeVisible();

    // Editar uno no toca al otro: el camión de ejemplo conserva placa y kilometraje.
    await selectPlate(page, SAMPLE.plate);
    const identity = page.getByRole('region', { name: 'Identificación del vehículo' });
    await expect(identity).toContainText(SAMPLE.km);

    // limpiar: borrar el editado deja solo el ejemplo
    await selectPlate(page, 'XYZ789');
    await deleteCurrent(page);
    await expectSampleOnly(page);
  });
});
