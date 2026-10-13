/**
 * offline-local-first.spec.ts — Prueba de que la app publica funciona SIN internet y SIN el
 * modulo cloud: toda peticion o WebSocket fuera de este host se corta, y el recorrido del
 * invitado tiene que salir igual.
 *
 *   /fleet/bienvenida → "este dispositivo" → garage invitado con el camion de ejemplo
 *   (ZZBC-11, IndexedDB) → vista de la flota demo de Chile (solo lectura).
 *
 * Y el modulo cloud no esta: el webhook de pagos responde 404 "cloud disabled". Si alguien
 * corre esta suite con GARA_CLOUD=1, el spec se salta (ahi el modulo SI esta).
 */
import { type BrowserContext, type Request, expect, test } from '@playwright/test';
import { ADMIN_SESSION_TOKEN, useAdminSession } from './helpers/auth';

const slow = expect.configure({ timeout: 45_000 });

/** Solo el servidor de la app (dev o preview local). Todo lo demas es "internet". */
function isAppHost(url: string, base: string): boolean {
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
}

/** Corta toda la red externa del contexto y devuelve lo que se intento. */
async function blockExternalNetwork(context: BrowserContext, base: string): Promise<string[]> {
  const blocked: string[] = [];
  await context.route(
    (url) => !isAppHost(url.toString(), base) && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'),
    (route) => {
      blocked.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort('internetdisconnected');
    },
  );
  await context.routeWebSocket(
    (url) => !isAppHost(url.toString().replace(/^ws/, 'http'), base),
    (ws) => {
      blocked.push(`WS ${ws.url()}`);
      ws.close();
    },
  );
  return blocked;
}

test.describe('local-first sin red externa y sin modulo cloud', () => {
  test.skip(process.env.GARA_CLOUD === '1', 'con GARA_CLOUD=1 el modulo cloud esta activo');
  // Dev compila bajo demanda (three.js, islas): margen amplio.
  test.setTimeout(240_000);

  test('bienvenida → garage invitado con el vehiculo de ejemplo → flota demo', async ({ page, context, baseURL, playwright }) => {
    const base = baseURL ?? 'http://localhost:4321';
    const blocked = await blockExternalNetwork(context, base);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const loginRedirects: string[] = [];
    page.on('response', (res) => {
      const loc = res.headers()['location'] ?? '';
      if (res.status() >= 300 && res.status() < 400 && loc.includes('/login')) loginRedirects.push(`${res.status()} ${res.url()} → ${loc}`);
    });

    // 0. Sin modulo cloud: la ruta de pagos existe pero responde "cloud disabled". El middleware
    //    exige sesion en /api/*, asi que se llama con la sesion de admin de desarrollo, en un
    //    contexto de peticiones aparte (el navegador del invitado sigue sin sesion).
    const api = await playwright.request.newContext({
      baseURL: base,
      extraHTTPHeaders: { cookie: `session=${ADMIN_SESSION_TOKEN}` },
    });
    const webhook = await api.post('/api/webhooks/stripe', { data: {} });
    expect(webhook.status()).toBe(404);
    expect(await webhook.json()).toEqual({ error: 'cloud disabled' });
    await api.dispose();

    // 1. Asistente de primer uso: guardar en este dispositivo y entrar.
    await page.goto('/fleet/bienvenida');
    await slow(page.getByTestId('onboarding-wizard')).toBeVisible();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByTestId('backup-checkbox').uncheck();
    await page.getByTestId('choose-local').click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByTestId('wizard-step')).toContainText('6 / 6');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/fleet\/garage/);
    expect((await context.cookies()).find((c) => c.name === 'gara_mode')?.value).toBe('guest');

    // 2. Garage invitado: el vehiculo de ejemplo, guardado en el navegador.
    await slow(page.getByText('ZZBC-11').first()).toBeVisible();
    await expect(page.getByText('TU PARQUE ESTÁ VACÍO')).toBeHidden();

    // 3. Vista de la flota demo (solo lectura), sin salir del host.
    await page.getByTestId('guest-demo-fleet').click();
    await expect(page).toHaveURL(/\/fleet\/garage\/flota-demo-chile$/);
    await slow(page.getByTestId('demo-fleet-chile')).toBeVisible();
    await expect(page.getByTestId('demo-kpi-vehicles')).toHaveText('10');
    await expect(page.getByTestId('demo-vehicles')).toContainText('ZZBC-11');

    expect(loginRedirects, 'el recorrido invitado no pasa por /login').toEqual([]);
    expect(pageErrors, 'sin errores de JavaScript con la red externa cortada').toEqual([]);
    // Informativo: lo que la app intento pedir fuera (y se corto) sin romper el recorrido.
    test.info().annotations.push({ type: 'blocked-external', description: blocked.join('\n') || '(ninguna)' });
  });
});

test.describe('app shell offline de las rutas de flota', () => {
  test.skip(process.env.GARA_CLOUD === '1', 'con GARA_CLOUD=1 el modulo cloud esta activo');
  // Dev compila bajo demanda y el SW necesita activarse: margen amplio.
  test.setTimeout(300_000);

  test('tras una visita online, cada ruta recarga sin red con la UI y los datos locales', async ({
    page,
    context,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:4321';
    await useAdminSession(context);

    // Rutas de flota que el operador usa a diario. El HTML sale de la cache del
    // SW; los datos vienen de IndexedDB / del SSR ya cacheado.
    const routes = [
      '/fleet',
      '/fleet/vehicles',
      '/fleet/garage',
      '/fleet/maintenance',
      '/fleet/fuel-logs',
    ];

    // 1. Primera pasada: la pagina registra el SW en `window.load`. Se visita
    //    cada ruta para forzar el registro y esperar a que tome el control.
    for (const route of routes) {
      const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `online ${route}`).toBeLessThan(400);
    }
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
      timeout: 90_000,
    });

    // 2. Segunda pasada YA con el SW controlando: cachea el HTML de cada ruta
    //    (la primera navegacion no la intercepta nadie).
    for (const route of routes) {
      const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `warm ${route}`).toBeLessThan(400);
      await expect(page.getByTestId('fleet-sidebar'), `warm ${route}`).toBeVisible();
    }

    // 2b. Evidencia: el HTML de cada ruta quedo en la cache de paginas del SW.
    const cachedRoutes = await page.evaluate(async () => {
      const names = await caches.keys();
      const pages = names.find((name) => name.startsWith('gara-g-pages-'));
      if (!pages) return [];
      const cache = await caches.open(pages);
      return (await cache.keys()).map((req) => new URL(req.url).pathname);
    });
    for (const route of routes) {
      expect(cachedRoutes, `el SW debe tener cacheado ${route}`).toContain(route);
    }

    // 3. Sin red: el SW debe servir el shell cacheado de cada ruta (200, nunca
    //    503) y el documento no puede fallar con ERR_INTERNET_DISCONNECTED.
    await context.setOffline(true);
    for (const route of routes) {
      const documentUrl = new URL(route, base).toString();
      const failed: string[] = [];
      const onFailed = (req: Request) => {
        if (req.resourceType() === 'document' && req.url().startsWith(documentUrl)) {
          failed.push(req.url());
        }
      };
      page.on('requestfailed', onFailed);
      const res = await page.reload({ waitUntil: 'domcontentloaded' });
      expect(res?.status(), `offline ${route}: el SW debe servir el shell, no 503`).toBe(200);
      await expect(page.getByTestId('fleet-sidebar'), `offline ${route}`).toBeVisible();
      expect(failed, `offline ${route}: el documento no debe fallar la red`).toEqual([]);
      page.off('requestfailed', onFailed);
    }

    // 4. Aviso de sin conexion visible y datos locales a la vista.
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await page.goto('/fleet/vehicles', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('vehicles-page')).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toBeVisible();

    // 5. Al volver la red, el aviso desaparece.
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toBeHidden();
  });
});
