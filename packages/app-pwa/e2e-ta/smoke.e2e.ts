import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('gara e2e smoke suite', () => {
  test('1. landing opens with the main heading', async ({ app, screen }) => {
    await app.open('/?inicio=1');
    await expect(screen.getByTestId('hero-section')).toBeVisible();
    await expect(screen.getByTestId('hero-title')).toContainText('taller digital');
  });

  test('2. guest mode opens the fleet area without an account', async ({ app, screen, browser }) => {
    await browser.setCookies([
      { name: 'gara_mode', value: 'guest', url: app.baseUrl },
      { name: 'gara_app', value: '1', url: app.baseUrl },
    ]);
    await app.open('/fleet/ajustes');
    await expect(screen.getByTestId('guest-banner')).toBeVisible();
    await expect(screen.getByTestId('guest-banner')).toContainText('Modo local');
  });

  /**
   * Alcance real de este test: `browser.route` NO ve las peticiones que atiende
   * el service worker, y `public/sw.js` sirve las navegaciones red-primero, así
   * que abortar rutas con `route.abort()` no simula offline (la segunda apertura
   * seguiría siendo online y el test pasaría con el fallback roto). El
   * comportamiento offline de verdad —corte de red con `context.setOffline`—
   * está cubierto por las specs de Playwright
   * `tests/e2e/offline-local-first.spec.ts` y `tests/e2e/offline-queue.spec.ts`.
   * Aquí solo se verifica la PREPARACIÓN: el SW controla la página y el shell
   * está en caché.
   */
  test('5. offline readiness: the service worker controls the page and the shell is cached', async ({ app, screen, browser }) => {
    await app.open('/?inicio=1');
    await expect(screen.getByTestId('hero-section')).toBeVisible();

    // El registro ocurre en el evento `load` (BaseLayout/Layout) y `activate`
    // hace `clients.claim()`. `ready` espera a que haya un worker activo.
    const swReady = await browser.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      await navigator.serviceWorker.ready;
      return true;
    });
    expect(swReady).toBe(true);

    // Con el SW activo, esta recarga ya está controlada por él.
    await browser.reload();

    const controlled = await browser.evaluate(() => navigator.serviceWorker.controller !== null);
    expect(controlled).toBe(true);

    // Qué cachea public/sw.js en este target (http://127.0.0.1 en `astro dev`):
    //  - 127.0.0.1 cuenta como contexto seguro (LOCAL_HOSTS), así que el SW se
    //    registra, pero en http el fetch handler solo atiende navegaciones:
    //    los assets de Vite se dejan pasar a la red.
    //  - En `install` abre la caché `gara-g-static-${BUILD_ID}` (en dev el
    //    placeholder no está sellado: scripts/sw-build-id.js solo lo sustituye
    //    en dist/client/sw.js durante el build) y guarda STATIC_ASSETS.
    //  - El shell de respaldo OFFLINE_FALLBACK ('/') va a la MISMA caché
    //    `gara-g-static-*` vía warmOfflineFallback(), y las navegaciones
    //    controladas guardan su HTML en `gara-g-pages-*` con la query
    //    eliminada. `caches.match('/')` busca en todas y encuentra el shell.
    // Solo se devuelven valores JSON-safe.
    const cacheState = await browser.evaluate(async () => {
      const keys = await caches.keys();
      const shell = await caches.match('/');
      return {
        hasStaticCache: keys.some((k) => k.startsWith('gara-g-static-')),
        hasOfflineFallbackShell: shell !== undefined,
      };
    });

    expect(cacheState.hasStaticCache).toBe(true);
    expect(cacheState.hasOfflineFallbackShell).toBe(true);
  });

  test('6. PWA manifest and service worker are served', async ({ app, screen, browser }) => {
    await app.open('/?inicio=1');

    const swSupported = await browser.evaluate(() => 'serviceWorker' in navigator);
    expect(swSupported).toBe(true);

    const manifestStatus = await browser.evaluate(async () => {
      const res = await fetch('/manifest.json');
      return res.status;
    });
    expect([200, 304]).toContain(manifestStatus);

    const swStatus = await browser.evaluate(async () => {
      const res = await fetch('/sw.js');
      return res.status;
    });
    expect([200, 304]).toContain(swStatus);
  });
});
