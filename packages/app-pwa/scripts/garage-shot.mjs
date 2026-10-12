#!/usr/bin/env node
/**
 * garage-shot.mjs — Captura del laboratorio de plantillas 3D para verificarlas a ojo.
 *
 * Requiere el dev server corriendo (pnpm astro dev --port <p>). En dev sin KV cualquier
 * cookie `session` no vacia vale como admin, asi que el script la pone.
 *
 *   node scripts/garage-shot.mjs --base http://127.0.0.1:4391 --template moto-naked \
 *        --view side --out /tmp/naked-side.png [--query "color=%23c8102e&finish=gloss"] \
 *        [--path /fleet/garage/lab] [--size 1280x720] [--mobile]
 *
 * Imprime en stdout el JSON de window.__garageLab (backend, triangulos, draw calls,
 * ranuras, medidas reales en mm) y sale con codigo 1 si la pagina reporto un error
 * o hubo errores de consola.
 */
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const base = arg('base', 'http://127.0.0.1:4391');
const path = arg('path', '/fleet/garage/lab');
const template = arg('template', 'debug-block');
const view = arg('view', 'three-quarter');
const out = arg('out', `/tmp/garage-${template}-${view}.png`);
const extra = arg('query', '');
const mobile = arg('mobile', false) === true;
const [w, h] = String(arg('size', mobile ? '390x844' : '1280x720')).split('x').map(Number);
const waitMs = Number(arg('wait', 120000));

const url = new URL(path, base);
if (path.includes('/lab')) {
  url.searchParams.set('template', template);
  url.searchParams.set('view', view);
}
for (const [k, v] of new URLSearchParams(String(extra || ''))) url.searchParams.set(k, v);

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
const host = new URL(base).hostname;
await context.addCookies([{ name: 'session', value: 'garage-shot-dev', domain: host, path: '/' }]);
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

let result = null;
try {
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: waitMs });
  await page.waitForSelector('body[data-ready="1"]', { timeout: waitMs });
  await page.waitForTimeout(400);
  result = await page.evaluate(() => window.__garageLab ?? window.__garage ?? null);
  await page.screenshot({ path: out });
} catch (e) {
  errors.push(`timeout/navegacion: ${e.message}`);
  await page.screenshot({ path: out }).catch(() => {});
}
await browser.close();

const report = { url: url.toString(), out, result, consoleErrors: errors };
console.log(JSON.stringify(report, null, 2));
process.exit(result?.error || errors.length ? 1 : 0);
