#!/usr/bin/env node
/**
 * page-shot.mjs — Captura de cualquier pagina de la app en un dev server, con cookie de
 * sesion de desarrollo, y lista de errores de consola. Para revisar pantallas a ojo.
 *
 *   node scripts/page-shot.mjs --base http://127.0.0.1:4471 --path /fleet/garage/expediente/ID \
 *        --out /tmp/x.png [--size 1366x900] [--mobile] [--click "text=Asistente IA"] [--wait 1500] [--full]
 *
 * --click se puede repetir; cada clic espera --wait ms antes del siguiente y de la captura.
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const get = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 ? args[i + 1] : d;
};
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const base = get('base', 'http://127.0.0.1:4471');
const mobile = args.includes('--mobile');
const [w, h] = String(get('size', mobile ? '390x844' : '1366x900')).split('x').map(Number);
const wait = Number(get('wait', '1500'));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
await ctx.addCookies([{ name: 'session', value: get('cookie', 'page-shot-dev'), domain: new URL(base).hostname, path: '/' }]);
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const res = await page.goto(new URL(get('path', '/'), base).toString(), { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(wait);
for (const sel of all('click')) {
  await page.locator(sel).first().click({ timeout: 15000 });
  await page.waitForTimeout(wait);
}
await page.screenshot({ path: get('out', '/tmp/page.png'), fullPage: args.includes('--full') });
console.log(JSON.stringify({ status: res?.status(), url: page.url(), errors }, null, 2));
await browser.close();
