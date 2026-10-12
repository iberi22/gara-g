import { test, expect } from './fixtures';
import { seedDemoFleet } from './helpers/seed';

/** Prop `actions` de GenericTableAstro y editBase hacia rutas que existen (wave-32 12). */
test.describe('GenericTableAstro: acciones por fila', () => {
  test.beforeEach(async ({ request }) => {
    await seedDemoFleet(request, { exact: false });
  });

  test('geocercas: cada fila tiene "Editar" y lleva a una pagina que responde 200', async ({ page }) => {
    await page.goto('/fleet/geofences');
    const table = page.locator('#geofences-table, [data-testid="geofences-table"]').first();
    const edits = table.getByRole('link', { name: /^Editar/ });
    expect(await edits.count()).toBeGreaterThan(0);
    expect(await edits.count()).toBe(await table.locator('tbody tr[data-row-id]').count());
    const href = await edits.first().getAttribute('href');
    expect(href).toMatch(/^\/fleet\/geofences\/edit\/[^/?]+/);
    const res = await page.goto(href!);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/fleet\/geofences\/edit\//);
  });

  test('documentos: "Ver archivo" apunta a /r2/ y "Editar" a su edicion', async ({ page }) => {
    await page.goto('/fleet/documents');
    const table = page.getByTestId('documents-table');
    const rows = await table.locator('tbody tr[data-row-id]').count();
    expect(rows).toBeGreaterThan(0);
    const view = table.getByRole('link', { name: /^Ver archivo/ });
    const edit = table.getByRole('link', { name: /^Editar/ });
    expect(await view.count()).toBe(rows);
    expect(await edit.count()).toBe(rows);
    expect(await view.first().getAttribute('href')).toMatch(/^\/r2\//);
    expect(await edit.first().getAttribute('href')).toMatch(/^\/fleet\/documents\/edit\//);
  });

  for (const [path, testId] of [['/fleet/alerts', 'alerts-table'], ['/fleet/fuel-logs', 'fuel-table']] as const) {
    test(`${path}: ningun boton de accion lleva a una ruta 404`, async ({ page, request }) => {
      await page.goto(path);
      const table = page.getByTestId(testId);
      await expect(table).toBeVisible();
      const hrefs = await table.locator('a.g-action-btn').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      for (const href of new Set(hrefs)) {
        const res = await request.get(href!, {
          headers: { cookie: 'session=test-admin-session-token; gara_onb=usr_001' },
          maxRedirects: 0,
        });
        expect(res.status(), `${href}`).not.toBe(404);
      }
      // Y la edicion sin pagina propia no se ofrece.
      await expect(table.getByRole('link', { name: /^Editar/ })).toHaveCount(0);
    });
  }
});
