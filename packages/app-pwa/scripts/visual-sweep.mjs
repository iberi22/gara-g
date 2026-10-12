#!/usr/bin/env node
/**
 * visual-sweep.mjs — Barrido visual de todas las rutas de la app.
 *
 * Para cada ruta y cada combinacion {light,dark} x {escritorio,movil} captura una
 * pantalla (pantalla completa cuando Playwright la soporta) y registra los errores de
 * consola y de pagina. El tema se fija con localStorage `swal:theme-mode` antes de
 * cargar la pagina (ver src/components/theme/ThemeBootstrap.astro), asi que hay que
 * inyectarlo con addInitScript: si se fija despues, la primera pintura ya salio con el
 * tema por defecto (claro) y la captura miente.
 *
 * Uso:
 *   node scripts/visual-sweep.mjs --base http://127.0.0.1:4492 --out /tmp/shots \
 *     [--routes rutas.txt] [--only ruta1,ruta2] [--cookie dev] [--onboarding usr_001] \
 *     [--settle 1500] [--max-height 8000] [--fullpage/--no-fullpage]
 *
 * Las rutas dinamicas se resuelven leyendo /api/fleet/<entity> (--entity-id vehicle=...)
 * o con IDs reales en la lista de rutas; si no hay datos se avisa y se salta la ruta.
 *
 * Salida: <out>/<ruta-normalizada>__<modo>__<tamano>.png y <out>/_report.json.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const pexec = promisify(execFile);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const base = arg('base', 'http://127.0.0.1:4492').replace(/\/$/, '');
const outDir = path.resolve(arg('out', '/tmp/visual-sweep'));
const cookieValue = arg('cookie', 'dev');
const onboarding = arg('onboarding', 'usr_001');
const settle = Number(arg('settle', '1500'));
const maxHeight = Number(arg('max-height', '8000'));
const fullPage = flag('fullpage') || (!flag('no-fullpage') && true);

/**
 * En esta app las capturas `fullPage: true` salen en blanco (1 color): el worker de
 * swiftshader no llega a pintar la superficie cuando Playwright cambia la altura para
 * componer el stitching. Se mide el PNG y, si sale uniforme, se reintenta con un
 * viewport alto. Devuelve { colors, size } para decidir.
 */
async function measure(file) {
  try {
    const { stdout } = await pexec('magick', [file, '-format', '%k colors, %wx%h', 'info:']);
    const m = /(\d+) colors, (\d+)x(\d+)/.exec(stdout);
    return m ? { colors: Number(m[1]), width: Number(m[2]), height: Number(m[3]) } : null;
  } catch {
    return null;
  }
}

/** Vuelca a JSON y, si magick existe, añade el análisis de colores de cada PNG. */
async function analyseDir(dir) {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.png'));
  const rows = [];
  for (const f of files) {
    const m = await measure(path.join(dir, f));
    rows.push({ file: f, ...(m ?? {}), blank: m ? m.colors <= 1 : null });
  }
  return rows;
}

const THEME_KEY = 'swal:theme-mode';
const SIZES = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
const MODES = ['light', 'dark'];

/** Normaliza una ruta a un nombre de archivo estable: /fleet/vehicles/edit/abc -> fleet__vehicles__edit__abc. */
const slug = (route) =>
  (route.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || '/')
    .replace(/^\//, '')
    .replace(/\/+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase() || 'root';

/**
 * Rutas base. Las dinamicas ({...}) se completan con IDs reales leidos de la API.
 * El garage necesita ?gl=1 (WebGL) para pintar la escena 3D.
 */
const STATIC_ROUTES = [
  '/',
  '/login',
  '/fleet',
  '/fleet/bienvenida',
  '/fleet/ajustes',
  '/alerts',
  '/documents',
  '/drivers',
  '/fuel',
  '/geofences',
  '/telemetry',
  '/fleets',
  '/fleet/alerts',
  '/fleet/analytics',
  '/fleet/aui',
  '/fleet/catalog',
  '/fleet/documents',
  '/fleet/documents/edit/{document}',
  '/fleet/drivers',
  '/fleet/drivers/edit/{driver}',
  '/fleet/fleets',
  '/fleet/fuel-logs',
  '/fleet/game',
  '/fleet/garage?gl=1',
  '/fleet/garage/anunciantes',
  '/fleet/garage/engine-lab',
  '/fleet/garage/expediente/{vehicle}',
  '/fleet/garage/lab',
  '/fleet/geofences',
  '/fleet/geofences/edit/{geofence}',
  '/fleet/maintenance',
  '/fleet/maintenance/edit/{maintenance}',
  '/fleet/notifications',
  '/fleet/tracking',
  '/fleet/users',
  '/fleet/vehicles',
  '/fleet/vehicles/edit/{vehicle}',
];

const API_ENTITIES = { vehicle: 'vehicle', maintenance: 'maintenance', driver: 'driver', geofence: 'geofence', document: 'document', user: 'user' };

async function apiList(entity, cookie) {
  try {
    const res = await fetch(new URL(`/api/fleet/${entity}`, base), { headers: { cookie } });
    const json = await res.json().catch(() => ({}));
    return json?.data ?? [];
  } catch {
    return [];
  }
}

/** Resuelve {entity} -> id real. Devuelve null si no hay datos. */
async function resolveIds(cookie) {
  const out = {};
  for (const [token, entity] of Object.entries(API_ENTITIES)) {
    const rows = await apiList(entity, cookie);
    out[token] = rows[0]?.id ?? null;
    if (!rows.length) console.warn(`  ! sin datos en ${entity}: la ruta con {${token}} se omitira`);
  }
  return out;
}

async function loadRoutes(cookie) {
  const file = arg('routes');
  let routes = STATIC_ROUTES.slice();
  if (file) {
    const text = await readFile(path.resolve(file), 'utf8');
    routes = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  }
  const only = arg('only');
  if (only) {
    const wanted = new Set(only.split(',').map((s) => s.trim()));
    routes = routes.filter((r) => wanted.has(r) || wanted.has(r.split('?')[0]));
  }
  const ids = await resolveIds(cookie);
  const resolved = [];
  const skipped = [];
  for (const route of routes) {
    let r = route;
    let ok = true;
    for (const [token, id] of Object.entries(ids)) {
      if (!r.includes(`{${token}}`)) continue;
      if (!id) { ok = false; break; }
      r = r.replace(`{${token}}`, id);
    }
    (ok ? resolved : skipped).push(r);
  }
  return { routes: resolved, skipped, ids };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const cookie = `session=${cookieValue}`;
  const { routes, skipped, ids } = await loadRoutes(cookie);
  console.log(`Rutas: ${routes.length} (omitidas ${skipped.length})`);
  if (skipped.length) console.log(`  omitidas: ${skipped.join(', ')}`);

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];

  for (const route of routes) {
    // /login y el onboarding se ven sin sesion completada: el resto necesita sesion + onboarding.
    const anon = route === '/login' || route === '/fleet/bienvenida';
    for (const mode of MODES) {
      for (const size of SIZES) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1,
          isMobile: size.name === 'mobile',
          hasTouch: size.name === 'mobile',
          colorScheme: mode,
        });
        const errors = [];
        const page = await context.newPage();
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
        page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));

        await context.addCookies(
          [
            { name: 'session', value: cookieValue, url: base },
            ...(anon ? [] : [{ name: 'gara_onb', value: onboarding, url: base }]),
          ],
        );
        await context.addInitScript(
          ([key, value]) => { try { localStorage.setItem(key, value); } catch {} },
          [THEME_KEY, mode],
        );

        const url = new URL(route.startsWith('/') ? route : `/${route}`, base).toString();
        const entry = { route, mode, size: size.name, viewport: `${size.width}x${size.height}`, file: null, status: null, url, errors: [], note: null };
        try {
          const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
          entry.status = res?.status() ?? null;
          if (entry.status && entry.status >= 400) entry.note = `HTTP ${entry.status}`;
          await page.waitForTimeout(settle);

          // Some pages (three.js) grow without bound: cap the captured height.
          const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
          const cap = Math.min(docHeight || 0, maxHeight);
          const file = path.join(outDir, `${slug(route)}__${mode}__${size.name}.png`);

          // Intento 1: fullPage (barato). Intento 2: viewport alto. Intento 3: normal.
          const attempts = fullPage
            ? [
                { kind: 'fullpage', height: null },
                { kind: 'tall', height: cap },
                { kind: 'viewport', height: size.height },
              ]
            : [{ kind: 'viewport', height: size.height }];
          let capture = null;
          for (const attempt of attempts) {
            if (attempt.height !== null) {
              await page.setViewportSize({ width: size.width, height: Math.max(attempt.height, size.height) });
              await page.waitForTimeout(500);
              await page.screenshot({ path: file, fullPage: false });
            } else {
              await page.screenshot({ path: file, fullPage: true });
            }
            const m = await measure(file);
            if (m && m.colors > 1) { capture = { ...attempt, ...m }; break; }
            capture = { ...attempt, ...(m ?? {}) };
            if (attempt === attempts[attempts.length - 1]) break;
          }
          entry.file = file;
          entry.capture = { kind: capture?.kind, colors: capture?.colors ?? null, size: `${capture?.width ?? '?'}x${capture?.height ?? '?'}` };
          if (!capture || (capture.colors !== null && capture.colors <= 1)) {
            entry.note = `${entry.note ? `${entry.note}; ` : ''}CAPTURA EN BLANCO (${capture?.colors ?? '?'} color)`;
          } else if (capture.kind === 'tall') {
            entry.note = `${entry.note ? `${entry.note}; ` : ''}fullPage salió blanco: capturado con viewport de ${capture.height}px`;
          }
          if (docHeight > maxHeight) {
            entry.note = `${entry.note ? `${entry.note}; ` : ''}pagina de ${docHeight}px recortada a ${maxHeight}px`;
          }

          const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
          const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
          entry.theme = theme;
          entry.overflowPx = overflow;
          entry.docHeight = docHeight;
          if (overflow > 2) entry.note = `${entry.note ? `${entry.note}; ` : ''}desborde horizontal ${overflow}px`;
          if (theme !== (mode === 'dark' ? 'taller-dark' : 'taller')) entry.note = `${entry.note ? `${entry.note}; ` : ''}tema aplicado=${theme}`;
        } catch (err) {
          entry.note = `${entry.note ? `${entry.note}; ` : ''}${String(err).split('\n')[0].slice(0, 220)}`;
        }
        entry.errors = errors;
        results.push(entry);
        const flagTxt = entry.errors.length || entry.note ? ' !' : '';
        console.log(`  ${entry.mode.padEnd(5)} ${entry.size.padEnd(7)} ${route} [${entry.status}]${flagTxt}`);
        await context.close();
      }
    }
  }

  await browser.close();
  const analysis = await analyseDir(outDir);
  await writeFile(
    path.join(outDir, '_report.json'),
    JSON.stringify({ base, at: new Date().toISOString(), ids, skipped, analysis, results }, null, 2),
  );
  const noisy = results.filter((r) => r.errors.length || r.note);
  const blank = analysis.filter((a) => a.blank);
  console.log(`\n${results.length} capturas en ${outDir}`);
  console.log(`con problemas: ${noisy.length}; capturas en blanco: ${blank.length}`);
  for (const r of noisy) console.log(`  ${r.route} ${r.mode}/${r.size}: ${r.note ?? ''} ${r.errors.slice(0, 2).join(' | ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });