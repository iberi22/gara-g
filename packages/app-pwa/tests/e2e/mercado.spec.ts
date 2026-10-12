/**
 * mercado.spec.ts — El mercado de la red de datos (/fleet/mercado) y la pagina del vendedor.
 *
 * Sin cuenta (cookie `gara_mode=guest`, sin sesion): la bandeja carga y el vendedor ve la
 * invitacion a crear una cuenta, no el formulario. No usa el fixture global (inyecta una
 * sesion de admin y taparia justo lo que se prueba).
 *
 * Requiere que /fleet/mercado este en GUEST_ALLOWED_PATHS (src/lib/appMode.ts, lo añade el
 * orquestador al integrar). Sin pares reales la bandeja esta vacia: se prueba el estado vacio,
 * el consentimiento y la explicacion de la demanda; el flujo con pares esta en vitest sobre
 * LocalMeshHub.
 */
import { existsSync } from 'node:fs';
import { type Page, chromium, expect, test } from '@playwright/test';
import { GUEST_COOKIE, GUEST_COOKIE_VALUE } from '../../src/lib/appMode';
import { authCookieUrl, useAdminSession } from './helpers/auth';

const slow = expect.configure({ timeout: 30_000 });

/** Agrega una Hilux al garage local; mismo flujo que tests/e2e/guest-garage.spec.ts. */
async function addHilux(page: Page) {
  const dialog = page.getByRole('dialog');
  await slow(dialog).toBeVisible();
  await dialog.getByLabel('Modelo').selectOption({ label: 'Toyota Hilux' });
  await dialog.getByLabel('Placa').fill('abc123');
  await dialog.getByLabel('Año').fill('2020');
  await dialog.getByLabel(/Kilometraje/).fill('45000');
  await dialog.getByRole('button', { name: 'Agregar al garage' }).click();
  await slow(dialog).toBeHidden();
}

test.describe('mercado sin cuenta', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: GUEST_COOKIE, value: GUEST_COOKIE_VALUE, url: authCookieUrl() }]);
  });

  test('invitado: /fleet/mercado carga, pide ciudad y explica la demanda', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto('/fleet/mercado');
    expect(res?.status()).toBe(200);
    await slow(page.getByTestId('mercado')).toBeVisible();
    await slow(page.getByTestId('inbox-empty')).toContainText('Elige tu ciudad');
    await expect(page.getByTestId('demand-panel')).toContainText('Placa, VIN');
    await expect(page.getByTestId('demand-toggle')).not.toBeChecked();
    await expect(page.getByTestId('demand-preview')).toContainText('la demanda está apagada');

    await slow(page.locator('[data-testid=city-select]:not([disabled])')).toBeVisible();
    await page.getByTestId('city-select').selectOption({ label: 'Bogotá' });
    await slow(page.getByTestId('mk-status')).toContainText('Sala');
    expect(errors).toEqual([]);
  });

  test('invitado: el aviso de que GARA-G no cobra ni procesa pagos se ve en el mercado y en vender', async ({ page }) => {
    const aviso = /GARA-G no cobra ni procesa pagos entre clientes y prestadores: los conecta\. El pago se acuerda directamente o con el token de la red SWAL\./;
    await page.goto('/fleet/mercado');
    await slow(page.getByTestId('payments-notice')).toHaveText(aviso);
    await page.goto('/fleet/mercado/vender');
    await expect(page.getByTestId('payments-notice')).toHaveText(aviso);
  });

  test('invitado con un vehiculo local: "Todo para tus vehiculos" lista lo que puede necesitar', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Un vehiculo en el garage local (IndexedDB), por la misma pantalla que usa el dueno.
    await page.goto('/fleet/garage?gl=1');
    await slow(page.getByTestId('guest-add-first')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('guest-add-first').click();
    await addHilux(page);

    await page.goto('/fleet/mercado');
    await slow(page.getByTestId('mercado')).toBeVisible();
    await slow(page.getByTestId('tab-todo')).toBeVisible();
    await page.getByTestId('tab-todo').click();
    await expect(page.getByTestId('tab-todo')).toHaveAttribute('aria-selected', 'true');

    const section = page.getByTestId('todo-vehiculos');
    await slow(section.getByTestId('tv-vehicle')).toHaveCount(1);
    await expect(section.getByRole('heading', { level: 3 }).first()).toContainText('Toyota');
    await expect(section.getByRole('heading', { name: 'Cambio de aceite' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Kit de carretera' })).toBeVisible();
    // sin ofertas de la red, cada rubro lo dice
    await expect(section.getByText('Sin ofertas por ahora').first()).toBeVisible();
    // 360 px sin desborde horizontal
    await page.setViewportSize({ width: 360, height: 800 });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(errors).toEqual([]);
  });

  test('invitado: el vendedor ve la invitacion a crear una cuenta, sin formulario', async ({ page }) => {
    await page.goto('/fleet/mercado/vender');
    await expect(page.getByTestId('vender-cuenta')).toBeVisible();
    await expect(page.getByTestId('vender-login')).toHaveAttribute('href', /\/login\?redirect=/);
    await expect(page.getByTestId('offer-form')).toHaveCount(0);
  });
});

test.describe('mercado sin sesion ni modo local', () => {
  test('el vendedor redirige al login', async ({ page }) => {
    await page.goto('/fleet/mercado/vender');
    await expect(page).toHaveURL(/\/login/);
  });
});

/**
 * Dos navegadores sobre la red real: un vendedor (con sesion) publica una oferta y un dueno en
 * modo local, en la misma ciudad, la ve. Usa el broker publico de PeerJS (o
 * PUBLIC_MESH_SIGNAL_URL); sin red hacia el, la prueba se salta. Chromium necesita
 * --disable-features=WebRtcHideLocalIpsWithMdns para que dos pares en la misma maquina se
 * vean por ICE local.
 */
test.describe('mercado entre dos navegadores', () => {
  test.setTimeout(240_000);

  test('el vendedor publica y el dueno de la misma ciudad la ve', async () => {
    const reach = await fetch(process.env.PUBLIC_MESH_SIGNAL_URL || 'https://0.peerjs.com/', { signal: AbortSignal.timeout(8000) }).catch(() => null);
    test.skip(!reach, 'sin acceso al servidor de senalizacion');

    const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
    const browser = await chromium.launch({ executablePath: exe, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
    const base = process.env.BASE_URL || 'http://localhost:4321';
    const url = `${new URL(base).protocol}//${new URL(base).host}/`;
    try {
      const ownerCtx = await browser.newContext({ baseURL: base });
      await ownerCtx.addCookies([{ name: GUEST_COOKIE, value: GUEST_COOKIE_VALUE, url }]);
      const vendorCtx = await browser.newContext({ baseURL: base });
      await useAdminSession(vendorCtx);

      const owner = await ownerCtx.newPage();
      await owner.goto('/fleet/mercado');
      await slow(owner.getByTestId('mercado')).toBeVisible();
      // El selector se habilita cuando el nodo de la malla ya esta listo.
      await slow(owner.locator('[data-testid=city-select]:not([disabled])')).toBeVisible();
      await owner.getByTestId('city-select').selectOption({ label: 'Bogotá' });

      const vendor = await vendorCtx.newPage();
      await vendor.goto('/fleet/mercado/vender');
      await slow(vendor.getByTestId('offer-form')).toBeVisible();
      const title = `Aceite e2e ${Date.now()}`;
      await vendor.getByLabel('Nombre de tu negocio').fill('Lubricentro E2E');
      await vendor.getByLabel('Título').fill(title);
      await vendor.getByLabel('Ciudad').selectOption({ label: 'Bogotá' });
      await vendor.getByTestId('publish').click();
      await slow(vendor.getByTestId('published')).toBeVisible();

      // La oferta llega por la malla (o en el re-anuncio de 2 min si los pares se conectaron tarde).
      await expect(owner.getByTestId('offer-card').filter({ hasText: title })).toBeVisible({ timeout: 90_000 });
    } finally {
      await browser.close();
    }
  });
});
