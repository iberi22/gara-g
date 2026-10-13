import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync('/run/current-system/sw/bin/chromium')
    ? '/run/current-system/sw/bin/chromium'
    : existsSync('/usr/bin/google-chrome')
    ? '/usr/bin/google-chrome'
    : undefined);

/**
 * Playwright config para GARA-G Pages (static deploy en gara-g.pages.dev).
 *
 * Dos modos:
 * - Local: arranca `pnpm dev` en :4321 (webServer)
 * - Producción: BASE_URL=https://gara-g.pages.dev pnpm exec playwright test
 *
 * El modo CI usa producción para verificar el deploy real.
 */

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || (isCI ? 'https://gara-g.pages.dev' : 'http://localhost:4321');

const SEEDED_SPECS = /fleet-(dashboard|tracking-analytics)\.spec\.ts$/;

// Alcance que CI verifica en cada PR: la entrega flota-only (FLEET_ONLY + PUBLIC_DEMO + menú y
// smoke de sesión). El resto de la suite sigue disponible con `pnpm test:full` (playwright test),
// pero no corre en CI: medido en local, la suite completa tarda ~10 min con 2 workers en dev, y
// CI usa 1 worker (más lento), por encima del presupuesto de 10 min del job (ver ci.yml).
const FLEET_SCOPE_SPECS = [
  /fleet-only-scope\.spec\.ts$/,
  /navigation\.spec\.ts$/,
  /auth-gate\.spec\.ts$/,
  /smoke\.spec\.ts$/,
];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : 2,
  // Dev-mode SSR + PBKDF2 + on-demand compile: margen amplio local
  timeout: 90 * 1000,
  // Primera visita a cada ruta compila bajo demanda en dev (y la maquina suele estar cargada): 5 s no alcanza.
  expect: { timeout: isCI ? 5000 : 15000 },
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // Solo arrancar dev server si NO estamos en CI (en CI usamos producción)
  // Los specs locales entran como admin con una cookie inventada (tests/e2e/helpers/auth.ts):
  // eso solo funciona con la sesion de admin de desarrollo, que exige DEV_ADMIN_SESSION=true y
  // ENVIRONMENT development/local (src/lib/session.ts). workerd no ve la shell salvo con
  // CLOUDFLARE_INCLUDE_PROCESS_ENV. Si reutilizas un `pnpm dev` ya arrancado, necesita
  // packages/app-pwa/.dev.vars (ver .dev.vars.example).
  webServer: isCI ? undefined : {
    command: 'pnpm dev --host 0.0.0.0 --port 4321',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 120 * 1000,
    env: {
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
      ENVIRONMENT: 'development',
      DEV_ADMIN_SESSION: 'true',
    },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [SEEDED_SPECS, ...FLEET_SCOPE_SPECS],
      dependencies: ['chromium-seeded'],
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} },
    },
    {
      // Specs que cuentan la flota demo exacta (3 flotas, 10 vehiculos...). El storage de dev es
      // una sola memoria por tenant: si corren a la vez que specs que crean o borran filas
      // (fleet-crud, offline-queue, forms-audit...) las cuentas se descuadran, y la semilla
      // (que borra y recrea) pisa a los demas. Van primero y solos: el proyecto principal depende de este.
      name: 'chromium-seeded',
      testMatch: SEEDED_SPECS,
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} },
    },
    {
      // Entrega flota-only: rutas ocultas 404 y sin puntos de entrada, menú lateral, política de
      // PUBLIC_DEMO y smoke de sesión. Es lo que corre CI en cada PR (`--project=fleet`).
      name: 'fleet',
      testMatch: FLEET_SCOPE_SPECS,
      dependencies: ['chromium-seeded'],
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
});
