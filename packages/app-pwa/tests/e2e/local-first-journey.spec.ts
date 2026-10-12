import { type Page, expect, test } from '@playwright/test';

/**
 * Recorrido completo del modo local con respaldo cifrado, en dos navegadores:
 *
 *   A: portada → "Empezar gratis, sin cuenta" → onboarding (modo local + respaldo) →
 *      activar respaldo (código, confirmación, primera subida) → garage local: agregar
 *      vehículo → sincronizar.
 *   B: navegador limpio → modo local → restaurar con el código → el vehículo aparece.
 *
 * Es la única prueba que ejercita juntos el almacén IndexedDB (dump.ts) y el respaldo
 * (syncClient + /api/sync): cada frente los probó por separado con dobles. Necesita un
 * R2 en el servidor; sin él la API responde 503 y la prueba se salta explicando por qué. En
 * `astro dev` no hay bindings: para correrla, crea (sin commit) `packages/app-pwa/wrangler.jsonc`
 * con `"r2_buckets": [{ "binding": "SWAL_R2", "bucket_name": "gara-dev-local" }]` y
 * `"vars": { "ENVIRONMENT": "development" }`, y reinicia el dev (miniflare lo simula en local).
 */
const slow = expect.configure({ timeout: 30_000 });
const GARAGE = '/fleet/garage?gl=1';

async function addVehicle(page: Page, plate: string) {
  const dialog = page.getByRole('dialog');
  await slow(dialog).toBeVisible();
  await dialog.getByLabel('Modelo').selectOption({ label: 'Toyota Hilux' });
  await dialog.getByLabel('Placa').fill(plate);
  await dialog.getByLabel('Año').fill('2021');
  await dialog.getByLabel(/Kilometraje/).fill('30000');
  await dialog.getByRole('button', { name: 'Agregar al garage' }).click();
  await slow(dialog).toBeHidden();
}

test.describe('Modo local con respaldo cifrado', () => {
  test.setTimeout(240_000);

  test('un vehículo creado sin cuenta se respalda cifrado y se restaura en otro navegador', async ({ browser, baseURL }) => {
    const probe = await (await browser.newContext()).request.get(`${baseURL}/api/sync/${'0'.repeat(32)}`);
    test.skip(probe.status() === 503, 'el servidor no tiene R2 (SWAL_R2): no hay dónde guardar el respaldo');

    // --- Navegador A ---
    const a = await browser.newContext();
    const pa = await a.newPage();
    const bodies: string[] = [];
    pa.on('request', (r) => {
      if (r.url().includes('/api/sync/')) bodies.push(`${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ''}`);
    });

    await pa.goto('/');
    await expect(pa.getByTestId('hero-section')).toBeVisible();
    await pa.getByTestId('cta-start').click();
    await slow(pa.getByTestId('onboarding-wizard')).toBeVisible();
    await pa.getByRole('button', { name: 'Siguiente' }).click();
    await expect(pa.getByTestId('backup-checkbox')).toBeChecked();
    await pa.getByTestId('choose-local').click();
    for (let i = 0; i < 3; i++) await pa.getByRole('button', { name: 'Siguiente' }).click();
    await pa.getByRole('button', { name: 'Entrar' }).click();
    // Con la casilla marcada, el onboarding termina en la página del respaldo.
    await slow(pa).toHaveURL(/\/fleet\/respaldo/);

    // Primero un vehículo, para que el respaldo lleve algo.
    await pa.goto(GARAGE);
    await slow(pa.getByTestId('guest-add-first')).toBeVisible();
    await pa.getByTestId('guest-add-first').click();
    await addVehicle(pa, 'RST456');
    await slow(pa.getByText('RST456').first()).toBeVisible();

    await pa.goto('/fleet/respaldo');
    await slow(pa.getByTestId('backup-enable')).toBeVisible();
    await pa.getByTestId('backup-enable').click();
    await slow(pa.getByTestId('backup-code')).toBeVisible();
    // La pantalla muestra los grupos en líneas separadas: se normaliza a la forma canónica.
    const code = (await pa.getByTestId('backup-code').innerText()).replace(/\s+/g, '');
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/);
    await pa.getByTestId('backup-confirm').fill(code.split('-').pop()!);
    await pa.getByTestId('backup-finish').click();
    await slow(pa.getByTestId('backup-last')).toBeVisible();

    // Lo central: nada de lo que viaja al servidor contiene el código, la placa ni el modelo.
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b).not.toContain(code);
      expect(b).not.toContain(code.replace(/-/g, ''));
      expect(b).not.toContain('RST456');
      expect(b).not.toContain('Hilux');
    }

    // --- Navegador B: limpio, entra en modo local y restaura con el código ---
    const b = await browser.newContext();
    const pb = await b.newPage();
    await pb.goto('/fleet/bienvenida');
    await pb.getByRole('button', { name: 'Siguiente' }).click();
    await pb.getByTestId('backup-checkbox').uncheck();
    await pb.getByTestId('choose-local').click();
    for (let i = 0; i < 3; i++) await pb.getByRole('button', { name: 'Siguiente' }).click();
    await pb.getByRole('button', { name: 'Entrar' }).click();
    await slow(pb).toHaveURL(/\/fleet\/garage/);
    await slow(pb.getByTestId('guest-add-first')).toBeVisible();

    await pb.goto('/fleet/respaldo');
    await slow(pb.getByTestId('backup-restore-open')).toBeVisible();
    await pb.getByTestId('backup-restore-open').click();
    await pb.getByTestId('backup-restore-input').fill(code.toLowerCase());
    await pb.getByTestId('backup-preview').click();
    await slow(pb.getByTestId('backup-preview-result')).toContainText('1');
    await pb.getByTestId('backup-restore').click();
    await slow(pb.getByTestId('backup-last')).toBeVisible();

    await pb.goto(GARAGE);
    await slow(pb.getByText('RST456').first()).toBeVisible();

    // Limpieza: borra el respaldo de la nube desde A.
    await pa.goto('/fleet/respaldo');
    await pa.getByTestId('backup-disable').click();
    await pa.getByTestId('backup-disable-yes').click();
    await a.close();
    await b.close();
  });
});
