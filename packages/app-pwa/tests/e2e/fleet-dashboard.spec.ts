import { test, expect } from './fixtures';
import { useAdminSession } from './helpers/auth';
import { seedDemoFleet } from './helpers/seed';

/**
 * Fleet Dashboard E2E Tests.
 * Cobertura: Dashboard principal, KPIs, sidebar nav, acceso a todas las secciones,
 * gráficos SVG, campana de notificaciones y verificación anti-overlap.
 * Base: gara-g PWA Astro+Svelte5, server en localhost:4321.
 */

test.describe('Fleet Dashboard', () => {
  test.beforeEach(async ({ context, request }) => {
    // Inject session cookie for SSR middleware authentication
    await useAdminSession(context);
    // Las paginas leen el tenant de la sesion: la flota demo se crea ahi.
    await seedDemoFleet(request);
  });

  test('loads dashboard with seeded fleet KPIs, charts, and notification bell without overlap or seed error', async ({ page }) => {
    await page.goto('/fleet');

    // Sidebar presente con secciones principales
    await expect(page.getByTestId('fleet-sidebar')).toBeVisible();
    await expect(page.getByTestId('nav-dashboard')).toBeVisible();
    await expect(page.getByTestId('nav-fleets')).toBeVisible();
    await expect(page.getByTestId('nav-vehicles')).toBeVisible();
    await expect(page.getByTestId('nav-drivers')).toBeVisible();
    await expect(page.getByTestId('nav-maintenance')).toBeVisible();
    await expect(page.getByTestId('nav-fuel')).toBeVisible();
    await expect(page.getByTestId('nav-documents')).toBeVisible();
    await expect(page.getByTestId('nav-geofences')).toBeVisible();
    await expect(page.getByTestId('nav-alerts')).toBeVisible();
    await expect(page.getByTestId('nav-tracking')).toBeVisible();
    await expect(page.getByTestId('nav-analytics')).toBeVisible();

    // PRO pill activo
    await expect(page.getByTestId('pro-pill')).toContainText('PRO NODO ACTIVO');

    // Campana de notificaciones
    await expect(page.getByTestId('notif-bell')).toBeVisible();

    // Dashboard content
    await expect(page.getByTestId('fleet-dashboard')).toBeVisible();
    await expect(page.getByTestId('badge-pro-active')).toBeVisible();

    // Regression test: seed error banner MUST NOT be visible when /api/fleet/stats succeeds
    const seedError = page.locator('#seed-error');
    await expect(seedError).toBeHidden();

    // Stat cards (deben estar las principales + secundarias)
    await expect(page.getByTestId('stat-fleets')).toBeVisible();
    await expect(page.getByTestId('stat-vehicles')).toBeVisible();
    await expect(page.getByTestId('stat-drivers')).toBeVisible();
    await expect(page.getByTestId('stat-alerts')).toBeVisible();
    await expect(page.getByTestId('stats-primary')).toBeVisible();
    await expect(page.getByTestId('stats-secondary')).toBeVisible();

    // KPIs reales del seed
    const fleetsStat = await page.getByTestId('stat-fleets').textContent();
    expect(fleetsStat).toContain('3');
    const vehiclesStat = await page.getByTestId('stat-vehicles').textContent();
    expect(vehiclesStat).toContain('10');
    const driversStat = await page.getByTestId('stat-drivers').textContent();
    expect(driversStat).toContain('Conductores');
    const driversHtml = await page.getByTestId('stat-drivers').innerHTML();
    const driverNumMatch = driversHtml.match(/>(\d+)</);
    expect(driverNumMatch).toBeTruthy();
    const numDrivers = parseInt(driverNumMatch![1], 10);
    expect(numDrivers).toBeGreaterThanOrEqual(5);

    // Dashboard charts section & SVG chart
    await expect(page.getByTestId('dashboard-charts')).toBeVisible();
    await expect(page.getByTestId('km-month-chart')).toBeVisible();

    // Anti-overlap assertion: Assert bounding boxes for topbar bell, primary KPIs, and charts
    const bellBox = await page.getByTestId('notif-bell').boundingBox();
    const kpiBox = await page.getByTestId('stats-primary').boundingBox();
    const chartBox = await page.getByTestId('dashboard-charts').boundingBox();

    expect(bellBox).not.toBeNull();
    expect(kpiBox).not.toBeNull();
    expect(chartBox).not.toBeNull();

    if (bellBox && kpiBox && chartBox) {
      // Bell in topbar is positioned above main content KPIs
      expect(bellBox.y + bellBox.height).toBeLessThanOrEqual(kpiBox.y);
      // Primary KPIs are positioned above dashboard charts
      expect(kpiBox.y + kpiBox.height).toBeLessThanOrEqual(chartBox.y);
    }
  });

  test('all features are open with active session', async ({ page }) => {
    await page.goto('/fleet');

    // No debe haber pantalla de login ni paywall
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('Iniciar sesión');
    expect(bodyText).not.toContain('Login required');
    expect(bodyText).not.toContain('Paywall');

    // El badge "PRO NODO ACTIVO" debe estar presente
    await expect(page.getByTestId('pro-pill')).toBeVisible();
  });

  test('navigate to every section via sidebar', async ({ page }) => {
    const sections = [
      { testId: 'nav-fleets', url: '/fleet/fleets', pageId: 'fleets-page' },
      { testId: 'nav-vehicles', url: '/fleet/vehicles', pageId: 'vehicles-page' },
      { testId: 'nav-drivers', url: '/fleet/drivers', pageId: 'drivers-page' },
      { testId: 'nav-maintenance', url: '/fleet/maintenance', pageId: 'maintenance-page' },
      { testId: 'nav-fuel', url: '/fleet/fuel-logs', pageId: 'fuel-page' },
      { testId: 'nav-documents', url: '/fleet/documents', pageId: 'documents-page' },
      { testId: 'nav-geofences', url: '/fleet/geofences', pageId: 'geofences-page' },
      { testId: 'nav-alerts', url: '/fleet/alerts', pageId: 'alerts-page' },
      { testId: 'nav-tracking', url: '/fleet/tracking', pageId: 'tracking-page' },
      { testId: 'nav-analytics', url: '/fleet/analytics', pageId: 'analytics-page' },
    ];

    await page.goto('/fleet');
    for (const sec of sections) {
      await page.getByTestId(sec.testId).click();
      await page.waitForURL((url) => url.pathname === `${sec.url}/` || url.pathname === sec.url, { timeout: 15000 });
      await expect(page.getByTestId(sec.pageId)).toBeVisible({ timeout: 10000 });
      await page.getByTestId('nav-dashboard').click();
      await page.waitForURL((url) => url.pathname === '/fleet/' || url.pathname === '/fleet', { timeout: 15000 });
    }
  });
});
