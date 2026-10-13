import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './fixtures';
import { test as plain, expect as plainExpect } from '@playwright/test';
import { seedDemoFleet } from './helpers/seed';
import { ADMIN_SESSION_TOKEN, DEV_ADMIN_USER_ID, authCookieUrl } from './helpers/auth';
import { FLEET_ONLY } from './helpers/features';

/**
 * Barrido final v0.1.0: cada pagina, a 360 px, en tema claro y oscuro, con sesion de admin y como
 * invitado. Por ruta:
 *  - responde 200 (o, como invitado, lleva a /fleet/cuenta-requerida si necesita cuenta);
 *  - ni console.error, ni pageerror, ni 401/404/5xx (lo vigila el fixture);
 *  - sin desborde horizontal (scrollWidth <= clientWidth);
 *  - sin violaciones axe serious/critical.
 * Cada fix del barrido deja aqui su linea de regresion (ver comentarios por ruta).
 */

const THEMES = ['light', 'dark'] as const;

type Ids = { vehicle: string; driver: string; maintenance: string; document: string; geofence: string };

async function firstId(request: any, entity: string): Promise<string> {
  const res = await request.get(`/api/fleet/${entity}`, {
    headers: { cookie: `session=${ADMIN_SESSION_TOKEN}; gara_onb=${DEV_ADMIN_USER_ID}` },
  });
  const data = (await res.json()).data as Array<{ id: string }>;
  return data[0]?.id ?? 'sin-datos';
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('swal:theme-mode', t);
    } catch {
      /* sin storage */
    }
  }, theme);
}

async function noOverflow(page: Page) {
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(m.scroll, `desborde horizontal: scrollWidth ${m.scroll} > clientWidth ${m.client}`).toBeLessThanOrEqual(m.client);
}

async function seriousAxe(page: Page): Promise<string[]> {
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target?.join(' ')}`);
}

test.describe('Barrido v0.1.0 — admin', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test.describe.configure({ timeout: 120_000 });
  let ids: Ids;

  test.beforeAll(async ({ request }) => {
    await seedDemoFleet(request, { exact: false });
    ids = {
      vehicle: await firstId(request, 'vehicle'),
      driver: await firstId(request, 'driver'),
      maintenance: await firstId(request, 'maintenance'),
      document: await firstId(request, 'document'),
      geofence: await firstId(request, 'geofence'),
    };
  });

  const routes = (i: () => Ids): string[] => [
    '/alerts',
    '/documents',
    '/drivers',
    '/fleets',
    '/fuel',
    '/geofences',
    '/telemetry',
    '/fleet',
    '/fleet/ajustes',
    '/fleet/alerts',
    '/fleet/analytics',
    '/fleet/aui',
    '/fleet/bienvenida',
    '/fleet/catalog',
    '/fleet/cuenta-requerida',
    '/fleet/documents',
    '/fleet/drivers',
    '/fleet/fleets',
    '/fleet/fuel-logs',
    '/fleet/game',
    '/fleet/garage',
    // Módulos fuera de la entrega flota-only: el 404 se comprueba en fleet-only-scope.spec.ts.
    ...(FLEET_ONLY ? [] : ['/fleet/garage/anunciantes']),
    '/fleet/garage/engine-lab',
    '/fleet/garage/lab',
    '/fleet/geofences',
    '/fleet/maintenance',
    ...(FLEET_ONLY ? [] : ['/fleet/mercado', '/fleet/mercado/vender']),
    '/fleet/notifications',
    ...(FLEET_ONLY ? [] : ['/fleet/radar']),
    '/fleet/respaldo',
    '/fleet/tracking',
    '/fleet/users',
    '/fleet/vehicles',
    `/fleet/documents/edit/${i().document}`,
    `/fleet/drivers/edit/${i().driver}`,
    `/fleet/garage/expediente/${i().vehicle}`,
    `/fleet/geofences/edit/${i().geofence}`,
    `/fleet/maintenance/edit/${i().maintenance}`,
    `/fleet/vehicles/edit/${i().vehicle}`,
  ];

  // Los nombres de test no dependen de los ids (solo se conocen tras la semilla): la lista fija
  // es la misma con los ids como marcador y se resuelve dentro del test.
  const PLACEHOLDER: Ids = { vehicle: '{vehicle}', driver: '{driver}', maintenance: '{maintenance}', document: '{document}', geofence: '{geofence}' };
  for (const template of routes(() => PLACEHOLDER)) {
    test(`${template} — 200, sin errores, sin desborde ni axe serio (claro y oscuro)`, async ({ page }) => {
      const path = template.replace(/\{(\w+)\}/g, (_m, k: keyof Ids) => ids[k]);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        const res = await page.goto(path);
        expect(res?.status(), `${path} (${theme})`).toBe(200);
        await page.waitForLoadState('networkidle');
        // El laboratorio del motor fija su propio tema (claro/oscuro del HUD): ahi no se exige el de las prefs.
        if (!path.includes('/engine-lab')) {
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'taller-dark' : 'taller');
        }
        await noOverflow(page);
        expect(await seriousAxe(page), `axe ${path} (${theme})`).toEqual([]);
      }
    });
  }

  // fix: a 1280 px el selector de interfaz y la barra lateral se ven: la insignia "AI" (color cargado
  // despues por .swal-kicker), el candado del invitado y la campana de avisos dejaban axe en rojo.
  test('/fleet/aui y /fleet/garage a 1280 px — sin axe serio (barra lateral y cabecera visibles)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ['/fleet/aui', '/fleet/garage']) {
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await seriousAxe(page), `axe ${path} (${theme}, 1280)`).toEqual([]);
      }
    }
  });

  // fix: /fleet/users mostraba "Acceso denegado" (403, sin estilo) al admin porque leia el rol de KV.
  test('/fleet/users — el admin ve la lista, no la pagina 403', async ({ page }) => {
    await page.goto('/fleet/users');
    await expect(page.getByTestId('users-forbidden')).toHaveCount(0);
    await expect(page.getByText('Crear nuevo usuario')).toBeVisible();
  });

  // fix: la insignia de estado de "Próximos servicios" quedaba como un bloque liso a <= 480 px.
  test('/fleet/maintenance — la insignia de estado conserva su texto visible', async ({ page }) => {
    await page.goto('/fleet/maintenance');
    const badge = page.locator('[data-testid="upcoming-row"] .g-cal-badge').first();
    if ((await badge.count()) === 0) return;
    const { color, background } = await badge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, background: cs.backgroundColor };
    });
    expect(color).not.toBe(background);
  });

  // fix: editar un vehiculo con tipo "camioneta" dejaba el selector en "— Seleccionar —".
  test('/fleet/vehicles/edit — el tipo guardado queda seleccionado', async ({ page }) => {
    await page.goto(`/fleet/vehicles/edit/${ids.vehicle}`);
    const tipo = page.locator('select[name="type"]');
    await expect(tipo).not.toHaveValue('');
  });

  // fix: textos en ingles en la cabecera y el titulo del panel.
  test('/fleet — cabecera en español', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.locator('.brand-sub')).toHaveText('CONSOLA DE FLOTA');
    await expect(page.getByTestId('badge-pro-active')).not.toContainText('ALL FEATURES OPEN');
  });

  // fix: la campana de notificaciones tenia icono inexistente ("alert") y titulos en bruto.
  test('/fleet/notifications — icono presente y titulo en español', async ({ page }) => {
    await page.goto('/fleet/notifications');
    await expect(page.locator('[data-testid="page-header"] svg')).toHaveCount(1);
    const rows = page.getByTestId('notif-row');
    if ((await rows.count()) > 0) {
      await expect(rows.first().locator('strong')).not.toContainText('severidad low');
      await expect(rows.first().locator('strong')).not.toContainText(/\b(document|speed|engine|geofence)\b/);
    }
  });
});

plain.describe('Barrido v0.1.0 — invitado', () => {
  plain.use({ viewport: { width: 360, height: 740 } });
  plain.describe.configure({ timeout: 120_000 });

  const allowed = [
    '/fleet/bienvenida',
    '/fleet/garage',
    '/fleet/catalog',
    '/fleet/ajustes',
    // Módulos fuera de la entrega flota-only: con FLEET_ONLY responden 404 (ver fleet-only-scope.spec.ts).
    ...(FLEET_ONLY ? [] : ['/fleet/mercado', '/fleet/mercado/vender', '/fleet/radar']),
    '/fleet/respaldo',
    '/fleet/cuenta-requerida',
  ];
  // Rutas que necesitan cuenta: el invitado llega a /fleet/cuenta-requerida (200), nunca a un 401 en consola.
  // /fleet/garage/anunciantes queda fuera de la entrega (404) cuando FLEET_ONLY está encendido.
  const blocked = ['/fleet', '/fleet/vehicles', '/fleet/game', '/fleet/aui', ...(FLEET_ONLY ? [] : ['/fleet/garage/anunciantes'])];

  async function asGuest(page: Page, theme: 'light' | 'dark') {
    const url = authCookieUrl();
    await page.context().addCookies([
      { name: 'gara_mode', value: 'guest', url },
      { name: 'gara_app', value: '1', url },
    ]);
    await setTheme(page, theme);
  }

  for (const path of allowed) {
    plain(`invitado ${path} — 200, sin errores, sin desborde ni axe serio`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !/tile\.openstreetmap\.org/.test(m.text())) errors.push(m.text().slice(0, 200));
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
      for (const theme of THEMES) {
        await asGuest(page, theme);
        const res = await page.goto(path);
        expect(res?.status(), `${path} (${theme})`).toBe(200);
        await page.waitForLoadState('networkidle');
        await noOverflow(page);
        expect(await seriousAxe(page), `axe ${path} (${theme})`).toEqual([]);
      }
      plainExpect(errors).toEqual([]);
    });
  }

  // fix: la barra lateral del invitado atenuaba los enlaces bloqueados con opacity (3.8:1 a 1280 px).
  plain('invitado /fleet/garage a 1280 px — sin axe serio con la barra lateral visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const theme of THEMES) {
      await asGuest(page, theme);
      await page.goto('/fleet/garage');
      await page.waitForLoadState('networkidle');
      expect(await seriousAxe(page), `axe invitado 1280 (${theme})`).toEqual([]);
    }
  });

  for (const path of blocked) {
    plain(`invitado ${path} — explica que necesita cuenta, sin 401 en consola`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text().slice(0, 200));
      });
      await asGuest(page, 'light');
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL(/\/fleet\/cuenta-requerida/);
      await page.waitForLoadState('networkidle');
      plainExpect(errors).toEqual([]);
    });
  }
});

// Sin sesion ni cookies: la portada y el login, que ven las dos puertas de entrada.
plain.describe('Barrido v0.1.0 — anónimo', () => {
  plain.use({ viewport: { width: 360, height: 740 } });
  plain.describe.configure({ timeout: 120_000 });

  for (const path of ['/?inicio=1', '/login']) {
    plain(`anónimo ${path} — 200, sin errores, sin desborde ni axe serio`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text().slice(0, 200));
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
      for (const theme of THEMES) {
        await setTheme(page, theme);
        const res = await page.goto(path);
        expect(res?.status(), `${path} (${theme})`).toBe(200);
        await page.waitForLoadState('networkidle');
        await noOverflow(page);
        expect(await seriousAxe(page), `axe ${path} (${theme})`).toEqual([]);
      }
      plainExpect(errors).toEqual([]);
    });
  }
});
