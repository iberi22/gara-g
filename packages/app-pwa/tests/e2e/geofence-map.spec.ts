import { test, expect } from './fixtures';
import { seedDemoFleet } from './helpers/seed';

test.describe('GeofenceMap (Leaflet) & Point-in-Polygon E2E', () => {
  test.beforeEach(async ({ request }) => {
    // Las paginas leen el tenant de la sesion (no ?instanceId=): sin la flota demo ahi no hay geocercas.
    await seedDemoFleet(request, { exact: false });
  });

  test('renders geofence map component and vector polygons', async ({ page }) => {
    await page.goto('/fleet/geofences?instanceId=demo-flota');

    // Verify page container exists
    const pageContainer = page.locator('[data-testid="geofences-page"]');
    await expect(pageContainer).toBeVisible();

    // La UI real expone el mapa en #geofence-map (lazy: se inicializa al pulsar Ver mapa)
    await page.getByTestId('toggle-map-view').click();
    const polys = page.locator('#geofence-map svg path.leaflet-interactive');
    // La flota demo trae geocercas
    await expect(polys.first()).toBeAttached({ timeout: 15000 });
    expect(await polys.count()).toBeGreaterThanOrEqual(1);
  });

  test('crear geocerca vía EntityForm (datos verificados por API)', async ({ page }) => {
    await page.goto('/fleet/geofences?instanceId=demo-flota');

    // La UI real usa EntityForm (input-name/type/polygon).
    // El widget #geo-name del spec viejo no existe (evidencia: geofences/index.astro).
    const name = `Depot E2E ${Date.now() % 100000}`;
    await page.getByTestId('input-name').fill(name);
    await page.getByTestId('input-type').selectOption('depot');
    await page
      .getByTestId('input-polygon')
      .fill('4.700,-74.100 4.600,-74.100 4.600,-74.000 4.700,-74.000');
    await page.locator('form.g-form button[type="submit"]').click();

    // ✅ del EntityForm = POST OK (la redirección posterior resetea el toggle,
    // por eso el dato se verifica por API y no contando paths del mapa)
    await expect(page.locator('form.g-form .g-form-status')).toHaveText(/✅/, {
      timeout: 15000,
    });

    const res = await page.request.get('/api/fleet/geofence?instanceId=demo-flota');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const names = (body.data ?? []).map((g: any) => g.name);
    expect(names).toContain(name);
  });
});
