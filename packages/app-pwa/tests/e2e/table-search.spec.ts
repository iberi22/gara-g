import { test, expect } from './fixtures';
import { seedDemoFleet } from './helpers/seed';

/** Buscador de GenericTableAstro: mira la fila entera y avisa si no hay coincidencias (wave-32 13). */
test.describe('GenericTableAstro: buscador', () => {
  test.beforeEach(async ({ request }) => {
    await seedDemoFleet(request, { exact: false });
  });

  test('busca en cualquier columna, no solo en la primera', async ({ page }) => {
    await page.goto('/fleet/geofences');
    const table = page.getByTestId('geofences-table');
    const total = await table.locator('tbody tr[data-row-id]').count();
    expect(total).toBeGreaterThan(0);
    // "Sí" solo aparece en las columnas Alerta entrada/salida, nunca en el nombre.
    await page.getByTestId('geofences-table-search').or(page.locator('#geofences-table-search')).fill('Sí');
    const count = page.getByTestId('geofences-table-count');
    await expect(count).toContainText('filtrado');
    await expect(count).not.toContainText(/^0 de/);
    const visible = await table.locator('tbody tr[data-row-id]:visible').count();
    expect(visible).toBeGreaterThan(0);
  });

  test('sin coincidencias muestra una fila que lo dice y el contador marca 0', async ({ page }) => {
    await page.goto('/fleet/geofences');
    await page.locator('#geofences-table-search').fill('zzz-no-existe-zzz');
    const table = page.getByTestId('geofences-table');
    await expect(table.getByText('Sin coincidencias')).toBeVisible();
    await expect(page.getByTestId('geofences-table-count')).toContainText(/^0 de/);
    // Al borrar la consulta, la fila desaparece.
    await page.locator('#geofences-table-search').fill('');
    await expect(table.getByText('Sin coincidencias')).toBeHidden();
  });

  test('el contador anuncia sus cambios (aria-live="polite")', async ({ page }) => {
    await page.goto('/fleet/geofences');
    await expect(page.getByTestId('geofences-table-count')).toHaveAttribute('aria-live', 'polite');
  });
});
