import { test, expect, type Page } from './fixtures';
import { seedDemoFleet } from './helpers/seed';
import { loginAsE2EUser } from './helpers/login';
import { MARKET } from '../../src/lib/market';

// Tenant de la sesion: los enlaces de editar ya no llevan ?instanceId= (bf4e14a3), asi que
// una fila creada en otro tenant no se podia editar. La flota demo se crea en el de la sesion.

/** Sesion: usuario e2e real si hay E2E_USER_*, si no la de desarrollo del fixture. */
async function ensureLoggedIn(page: Page) {
  await loginAsE2EUser(page);
}

/** Helper para auditar la visibilidad, alineación y validación de un formulario */
async function auditFormOnPage(page: Page, url: string) {
  await ensureLoggedIn(page);
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  // Abrir <details> si el form está colapsado dentro de uno
  const details = page.locator('details.g-create-form');
  if (await details.count() > 0) {
    await details.evaluate((el: HTMLDetailsElement) => {
      el.open = true;
    });
  }

  const form = page.locator('form.g-form').first();
  await expect(form).toBeVisible({ timeout: 30000 });

  // 1. Verificar que todos los label[for] resuelvan a un input/select/textarea visible y alineado dentro del form
  const labels = form.locator('label[for]');
  const labelCount = await labels.count();
  expect(labelCount).toBeGreaterThan(0);

  for (let i = 0; i < labelCount; i++) {
    const label = labels.nth(i);
    const forAttr = await label.getAttribute('for');
    expect(forAttr).toBeTruthy();

    const input = form.locator(`[id="${forAttr}"]`);
    await expect(input).toBeVisible();

    // Requerir boundingBox válido sin superposiciones colapsadas
    const labelBox = await label.boundingBox();
    const inputBox = await input.boundingBox();

    expect(labelBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(labelBox!.width).toBeGreaterThan(0);
    expect(labelBox!.height).toBeGreaterThan(0);
    expect(inputBox!.width).toBeGreaterThan(0);
    expect(inputBox!.height).toBeGreaterThan(0);

    const labelText = await label.innerText();
    expect(labelText.trim().length).toBeGreaterThan(0);
  }

  // 2. Submit con campos requeridos vacíos debe bloquear la acción via validación HTML5
  const requiredInputs = form.locator('[required]');
  const reqCount = await requiredInputs.count();

  if (reqCount > 0) {
    // Vaciar el primer campo requerido
    const firstReq = requiredInputs.first();
    const tagName = await firstReq.evaluate((el) => el.tagName.toLowerCase());

    if (tagName === 'select') {
      await firstReq.selectOption('');
    } else if (tagName === 'input' || tagName === 'textarea') {
      await firstReq.fill('');
    }

    // Click submit en el formulario específico
    const submitBtn = form.locator('button[type="submit"]');
    await submitBtn.click();

    // Validar que la forma NO sea válida
    const isValid = await form.evaluate((f: HTMLFormElement) => f.checkValidity());
    expect(isValid).toBe(false);
  }
}

test.describe('Fleet Forms Audit & Validation Suite', () => {
  // Serial: los tests comparten la memoria del dev server (mismo tenant);
  // en paralelo se pisan filas/paginación entre sí.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    await seedDemoFleet(request, { exact: false });
  });

  test('Audit 1/9: Vehicles Create Form', async ({ page }) => {
    await auditFormOnPage(page, `/fleet/vehicles`);
  });

  test('Audit 2/9: Vehicles Edit Form', async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto(`/fleet/vehicles`);
    await page.waitForLoadState('domcontentloaded');
    const editBtn = page.locator('a.g-action-edit').first();
    await expect(editBtn).toBeVisible({ timeout: 30000 });
    const href = await editBtn.getAttribute('href');
    expect(href).toBeTruthy();
    await auditFormOnPage(page, href!);
  });

  test('Audit 3/9: Drivers Create Form', async ({ page }) => {
    await auditFormOnPage(page, `/fleet/drivers`);
  });

  test('Audit 4/9: Drivers Edit Form', async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto(`/fleet/drivers`);
    await page.waitForLoadState('domcontentloaded');
    const editBtn = page.locator('a.g-action-edit').first();
    await expect(editBtn).toBeVisible({ timeout: 30000 });
    const href = await editBtn.getAttribute('href');
    expect(href).toBeTruthy();
    await auditFormOnPage(page, href!);
  });

  test('Audit 5/9: Maintenance Create Form', async ({ page }) => {
    await auditFormOnPage(page, `/fleet/maintenance`);
  });

  test('Audit 6/9: Maintenance Edit Form', async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto(`/fleet/maintenance`);
    await page.waitForLoadState('domcontentloaded');
    const editBtn = page.locator('a.g-action-edit').first();
    await expect(editBtn).toBeVisible({ timeout: 30000 });
    const href = await editBtn.getAttribute('href');
    expect(href).toBeTruthy();
    await auditFormOnPage(page, href!);
  });

  test('Audit 7/9: Fuel Logs Create Form', async ({ page }) => {
    await auditFormOnPage(page, `/fleet/fuel-logs`);
  });

  test('Audit 8/9: Alerts Create Form', async ({ page }) => {
    await auditFormOnPage(page, `/fleet/alerts`);
  });

  test('Audit 9/9: Geofences & Documents Forms', async ({ page }) => {
    await auditFormOnPage(page, `/fleet/geofences`);
    await auditFormOnPage(page, `/fleet/documents`);
  });

  test('Vehicles: Crear y Editar registro E2E', async ({ page }) => {
    await ensureLoggedIn(page);
    // 1. Ir a la lista de vehículos
    await page.goto(`/fleet/vehicles`);
    await page.waitForLoadState('domcontentloaded');

    // 2. Abrir formulario de creación
    const details = page.locator('details.g-create-form');
    await details.evaluate((el: HTMLDetailsElement) => { el.open = true; });

    const form = details.locator('form.g-form');
    await expect(form).toBeVisible();

    const plate = `AUD-${Math.floor(100 + Math.random() * 900)}`;
    // VIN requerido (validators feat-vehicle-validators): 17 chars válidos, único por run
    const vin = `1HGCM82633A00${Math.floor(1000 + Math.random() * 9000)}`;

    // 3. Llenar formulario
    await form.locator('input[name="plate"]').fill(plate);
    await form.locator('input[name="vin"]').fill(vin);
    await form.locator('input[name="make"]').fill('Audi');
    await form.locator('input[name="model"]').fill('e-tron');
    await form.locator('input[name="year"]').fill('2024');
    await form.locator('select[name="status"]').selectOption('active');
    await form.locator('select[name="type"]').selectOption('sedan');
    await form.locator('select[name="fleetId"]').selectOption({ index: 1 });
    await form.locator('input[name="capacity"]').fill('5 Pax');
    await form.locator('input[name="mileage"]').fill('12000');

    // 4. Enviar formulario
    await form.locator('button[type="submit"]').click();

    // Confirmación de éxito en status box
    await expect(form.locator('.g-form-status')).toHaveText(/✅/, { timeout: 30000 });

    // 5. Esperar a que se complete la redirección de cancelUrl
    await page.waitForURL(/\/fleet\/vehicles\/?(\?.*)?$/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    // Navegar a la página 2 si existe el botón
    const page2Btn = page.locator('a.g-page-btn', { hasText: '2' });
    if (await page2Btn.count() > 0) {
      await page2Btn.click();
      await page.waitForLoadState('networkidle');
    }

    const row = page.locator('tr', { hasText: plate });
    await expect(row).toBeVisible({ timeout: 30000 });

    // 6. Click en editar
    const editBtn = row.locator('a.g-action-edit');
    await editBtn.click();
    await page.waitForLoadState('domcontentloaded');

    const editForm = page.locator('form.g-form');
    await expect(editForm).toBeVisible();

    // 7. Modificar datos
    await editForm.locator('input[name="model"]').fill('e-tron GT');
    await editForm.locator('input[name="mileage"]').fill('15000');
    await editForm.locator('button[type="submit"]').click();

    await expect(editForm.locator('.g-form-status')).toHaveText(/✅/, { timeout: 30000 });

    // 8. Esperar redirección y verificar que vuelva a la tabla (página 2 si aplica)
    await page.waitForURL(/\/fleet\/vehicles\/?(\?.*)?$/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    const page2Btn2 = page.locator('a.g-page-btn', { hasText: '2' });
    if (await page2Btn2.count() > 0) {
      await page2Btn2.click();
      await page.waitForLoadState('networkidle');
    }

    const updatedRow = page.locator('tr', { hasText: plate });
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow).toContainText('e-tron GT');
  });

  test('Drivers: Crear y Editar registro E2E', async ({ page }) => {
    await ensureLoggedIn(page);
    // 1. Ir a la lista de conductores
    await page.goto(`/fleet/drivers`);
    await page.waitForLoadState('domcontentloaded');

    // 2. Abrir formulario
    const details = page.locator('details.g-create-form');
    await details.evaluate((el: HTMLDetailsElement) => { el.open = true; });

    const form = details.locator('form.g-form');
    await expect(form).toBeVisible();

    const name = `Driver Audit ${Math.floor(1000 + Math.random() * 9000)}`;
    const cedula = `${Math.floor(10000000 + Math.random() * 90000000)}`;

    // 3. Llenar formulario
    await form.locator('input[name="name"]').fill(name);
    await form.locator('input[name="cedula"]').fill(cedula);
    await form.locator('select[name="licenseCategory"]').selectOption(MARKET.truckLicenseClass);
    await form.locator('input[name="licenseExpiry"]').fill('2029-12-31');
    await form.locator('input[name="phone"]').fill(`${MARKET.phonePrefix} 300 8887766`);
    await form.locator('select[name="status"]').selectOption('active');

    // 4. Enviar formulario
    await form.locator('button[type="submit"]').click();

    await expect(form.locator('.g-form-status')).toHaveText(/✅/, { timeout: 30000 });

    // 5. Verificar que aparezca en la tabla
    await page.waitForURL(/\/fleet\/drivers\/?(\?.*)?$/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    const row = page.locator('tr', { hasText: name });
    await expect(row).toBeVisible({ timeout: 30000 });

    // 6. Click en editar
    const editBtn = row.locator('a.g-action-edit');
    await editBtn.click();
    await page.waitForLoadState('domcontentloaded');

    const editForm = page.locator('form.g-form');
    await expect(editForm).toBeVisible();

    // 7. Modificar datos
    const updatedName = `${name} Modificado`;
    await editForm.locator('input[name="name"]').fill(updatedName);
    await editForm.locator('select[name="status"]').selectOption('on_leave');
    await editForm.locator('button[type="submit"]').click();

    await expect(editForm.locator('.g-form-status')).toHaveText(/✅/, { timeout: 30000 });

    // 8. Verificar que vuelva a la tabla con los datos actualizados
    await page.waitForURL(/\/fleet\/drivers\/?(\?.*)?$/, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    const updatedRow = page.locator('tr', { hasText: updatedName });
    await expect(updatedRow).toBeVisible();
  });

});
