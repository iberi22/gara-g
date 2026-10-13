/**
 * helpers/features.ts — los interruptores de producto vistos desde los specs e2e.
 *
 * `FLEET_ONLY` y `PUBLIC_DEMO` se leen de la MISMA variable de entorno que
 * `src/lib/features.ts` y `src/middleware.ts`. El servidor que Playwright prueba
 * tiene que arrancar con los mismos valores; el job e2e de CI los pasa al
 * `pnpm dev` y al proceso de Playwright (playwright.config.ts hace lo propio en
 * local). Así el spec refleja la configuración real, no una suposición.
 *
 * Semántica (idéntica a la del Worker):
 *  - FLEET_ONLY: sin la variable queda ENCENDIDO (un deploy que olvide la var no
 *    puede reabrir los módulos fuera de la entrega). Solo "false"/"0"/"off"/"no"
 *    lo apagan.
 *  - PUBLIC_DEMO: por defecto APAGADO. Solo "true"/"1" encienden el modo demo, y
 *    nunca en producción.
 */

/** ¿Se está ejecutando la suite contra un Worker `flota-only`? */
export function isFleetOnly(): boolean {
  const raw = process.env.FLEET_ONLY;
  if (raw === undefined || raw === null) return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
}

/** ¿El Worker tiene PUBLIC_DEMO encendido (abre /fleet* sin sesión fuera de producción)? */
export function isPublicDemo(): boolean {
  const v = String(process.env.PUBLIC_DEMO ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1';
}

/** Valor de FLEET_ONLY en tiempo de carga: los specs lo usan en `test.skip(...)`. */
export const FLEET_ONLY = isFleetOnly();

/** Valor de PUBLIC_DEMO en tiempo de carga. */
export const PUBLIC_DEMO = isPublicDemo();

/** Páginas de los módulos que FLEET_ONLY oculta (mismos prefijos que src/lib/features.ts). */
export const FLEET_ONLY_HIDDEN_PAGES = [
  '/fleet/mercado',
  '/fleet/mercado/vender',
  '/fleet/garage/anunciantes',
  '/fleet/radar',
  '/fleet/wallet',
  '/fleet/depin',
] as const;

/** APIs de los módulos que FLEET_ONLY oculta. */
export const FLEET_ONLY_HIDDEN_APIS = [
  '/api/garage/ads/serve',
  '/api/garage/ads/campaigns',
  '/api/garage/shop',
  '/api/v2v',
  '/api/wallet',
  '/api/depin',
] as const;

/** Rutas de la entrega flota-only que SÍ deben responder (contrapeso de las ocultas). */
export const FLEET_DELIVERY_PAGES = [
  '/fleet',
  '/fleet/vehicles',
  '/fleet/drivers',
  '/fleet/maintenance',
  '/fleet/fuel-logs',
  '/fleet/documents',
  '/fleet/geofences',
  '/fleet/alerts',
] as const;
