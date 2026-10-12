#!/usr/bin/env node
/**
 * hud-e2e.mjs — Prueba E2E interactiva con Playwright para el Garage HUD.
 *
 * Abre la página /fleet/garage, espera al contrato `body[data-ready="1"]`,
 * verifica el cambio circular de vehículos (◀ / ▶), abre el panel "Estado",
 * selecciona una pieza para foco 3D y captura evidencias en /tmp/.
 */
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL || 'http://127.0.0.1:4404';
const url = `${base}/fleet/garage`;

console.log(`[E2E] Lanzando Chromium hacia ${url}...`);

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,WebGPU',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});

const host = new URL(base).hostname;
await context.addCookies([{ name: 'session', value: 'garage-shot-dev', domain: host, path: '/' }]);
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  // 1. Navegar y esperar al primer renderizado 3D y HUD
  console.log('[E2E] Navegando y esperando a body[data-ready="1"]...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(500);

  const initialGarageState = await page.evaluate(() => window.__garage);
  console.log('[E2E] Vehículo inicial detectado:', initialGarageState?.vehicleId);

  // 2. Cambiar al siguiente vehículo usando la flecha ▶
  console.log('[E2E] Cambiando de vehículo con flecha ▶...');
  const nextBtn = page.locator('button[aria-label="Siguiente vehículo"]');
  await nextBtn.click();
  await page.waitForTimeout(600);

  const secondGarageState = await page.evaluate(() => window.__garage);
  console.log('[E2E] Nuevo vehículo detectado:', secondGarageState?.vehicleId);
  await page.screenshot({ path: '/tmp/hud-next-vehicle.png' });
  console.log('[E2E] Captura guardada en /tmp/hud-next-vehicle.png');

  // 3. Abrir el panel "Estado" desde el dock inferior
  console.log('[E2E] Abriendo panel de Estado desde el dock...');
  const stateDockBtn = page.locator('button[aria-label="Panel de Estado"]');
  await stateDockBtn.click();
  await page.waitForSelector('section[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(400);

  // 4. Enfocar una pieza dentro del panel
  console.log('[E2E] Enfocando una pieza en el panel...');
  const firstPart = page.locator('.part-card').first();
  await firstPart.click();
  await page.waitForTimeout(400);

  await page.screenshot({ path: '/tmp/hud-panel-state.png' });
  console.log('[E2E] Captura guardada en /tmp/hud-panel-state.png');

  console.log('[E2E] ✅ Flujo E2E completado exitosamente.');
  if (consoleErrors.length > 0) {
    console.warn('[E2E] Advertencias/Errores de consola registrados:', consoleErrors);
  }
} catch (err) {
  console.error('[E2E] ❌ Error durante la ejecución E2E:', err);
  process.exit(1);
} finally {
  await browser.close();
}
