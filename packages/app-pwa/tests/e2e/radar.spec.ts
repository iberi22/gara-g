import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { useAdminSession } from './helpers/auth';
import { isFleetOnly } from './helpers/features';

// FLEET_ONLY: el radar V2V queda fuera de la entrega (su ruta responde 404 desde el
// middleware). Las aserciones de que está oculto viven en fleet-only-scope.spec.ts.
test.skip(isFleetOnly(), 'Radar V2V oculto en entrega flota-only (FLEET_ONLY)');

/**
 * Radar V2V (/fleet/radar). Sin cuenta: es lo que ve quien usa el modo local.
 *
 * - Geolocalizacion simulada con el contexto de Playwright (sin GPS real).
 * - `?demo=1` mete trafico simulado sobre el hub en memoria: permite ver puntos, el banner de
 *   peligro y el contador sin depender de otros navegadores.
 * - Dos navegadores que se ven entre si SOLO si el puerto real (src/mesh/node.ts) esta en la
 *   rama: mientras no, el radar muestra el aviso de "red no conectada" y esa parte se salta.
 * - Mientras /fleet/radar no este en GUEST_ALLOWED_PATHS (lo añade el orquestador) el modo
 *   invitado rebota a /fleet/cuenta-requerida: se usa entonces la sesion de admin de dev, que
 *   no cambia lo que se prueba (la pagina no lee D1 ni la sesion).
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:4321';

// Sin mDNS ICE no encuentra candidatos en sandboxes sin red local real (las dos pestañas estan en la
// misma maquina). La opcion solo afecta a Chromium de pruebas.
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : undefined);
test.use({ launchOptions: { ...(executablePath ? { executablePath } : {}), args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] } });

const BOGOTA = { latitude: 4.711, longitude: -74.0721, accuracy: 5 };

async function openRadar(page: Page, context: BrowserContext, query = ''): Promise<'invitado' | 'sesion'> {
  await context.addCookies([{ name: 'gara_mode', value: 'guest', url: `${BASE}/` }]);
  await page.goto(`/fleet/radar${query}`);
  if (/cuenta-requerida|\/login/.test(page.url())) {
    await useAdminSession(context);
    await page.goto(`/fleet/radar${query}`);
    return 'sesion';
  }
  return 'invitado';
}

test.describe('Radar V2V', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(BOGOTA);
  });

  test('carga, explica la privacidad y arranca con la geolocalizacion simulada', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await openRadar(page, context);
    await expect(page.getByTestId('radar-app')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('radar-view')).toBeVisible();
    await expect(page.getByTestId('radar-privacy')).toContainText('cambia cada 10 minutos');
    await expect(page.getByTestId('radar-privacy')).toContainText('no se guarda');
    await expect(page.getByTestId('radar-nearby')).toHaveText('Sin vehículos cerca');

    const start = page.getByTestId('radar-start');
    await expect(start).toBeEnabled();
    await expect(start).toHaveText('Iniciar radar');
    await start.click();
    await expect(page.getByTestId('radar-app')).toHaveAttribute('data-status', 'active', { timeout: 15_000 });
    await expect(start).toHaveText('Detener radar');
    await expect(page.getByTestId('radar-class')).toBeDisabled();
    await expect(page.getByTestId('radar-status')).toContainText('Radar activo');

    await start.click();
    await expect(page.getByTestId('radar-app')).toHaveAttribute('data-status', 'idle');
    await expect(start).toHaveText('Iniciar radar');
    expect(errors).toEqual([]);
  });

  test('sin permiso de ubicacion muestra el error y no se queda colgado', async ({ page, context }) => {
    await context.clearPermissions();
    await openRadar(page, context);
    await context.clearPermissions();
    await page.getByTestId('radar-start').click();
    await expect(page.getByTestId('radar-app')).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
    await expect(page.getByTestId('radar-status')).toContainText(/ubicaci/i);
  });

  test('modo demostracion: aparecen vecinos, el contador y el banner de peligro (de frente)', async ({ page, context }) => {
    test.setTimeout(60_000);
    await openRadar(page, context, '?demo=1');
    await expect(page.getByTestId('radar-simulated')).toContainText('simulado');
    await page.getByTestId('radar-start').click();
    await expect(page.getByTestId('radar-neighbor').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('radar-nearby')).toContainText(/vehículos? cerca/);
    // El coche que viene de frente por el mismo carril acaba disparando el peligro.
    await expect(page.getByTestId('radar-app')).toHaveAttribute('data-level', 'peligro', { timeout: 30_000 });
    await expect(page.getByTestId('radar-banner')).toContainText(/Peligro/);
    await expect(page.getByTestId('radar-neighbor').and(page.locator('[data-level="peligro"]')).first()).toBeVisible();
  });

  test('dos navegadores se ven entre si (solo con la red real)', async ({ browser, page, context }) => {
    test.setTimeout(90_000);
    await openRadar(page, context);
    // El aviso de "simulado" aparece cuando la isla ya eligio puerto: se espera a que el boton este listo.
    await expect(page.getByTestId('radar-start')).toBeEnabled({ timeout: 30_000 });
    const simulated = await page.getByTestId('radar-simulated').count();
    test.skip(simulated > 0, 'el puerto real (src/mesh/node.ts, getMeshPort) aun no esta en esta rama: el radar usa el hub en memoria y no ve a otros navegadores');

    const ctx2 = await browser.newContext();
    try {
      await ctx2.grantPermissions(['geolocation']);
      await ctx2.setGeolocation({ ...BOGOTA, latitude: BOGOTA.latitude + 0.0004 });
      const page2 = await ctx2.newPage();
      await openRadar(page2, ctx2);
      await page.getByTestId('radar-start').click();
      await page2.getByTestId('radar-start').click();
      await expect(page.getByTestId('radar-nearby')).toHaveText('1 vehículo cerca', { timeout: 45_000 });
      await expect(page2.getByTestId('radar-nearby')).toHaveText('1 vehículo cerca', { timeout: 45_000 });
    } finally {
      await ctx2.close();
    }
  });
});
