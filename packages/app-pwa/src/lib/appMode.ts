/**
 * src/lib/appMode.ts — Modo de uso de la app: local (sin cuenta) o nube (con sesion).
 *
 * Contrato compartido entre middleware, onboarding, garage local y respaldo cifrado
 * (plan de onboarding local-first, 2026-10-02). Aqui solo viven nombres y
 * reglas puras; ningun modulo de este fichero lee D1, KV ni IndexedDB.
 *
 * - `guest`: sin cuenta. Los datos viven en IndexedDB de este navegador. Solo las rutas
 *   de GUEST_ALLOWED_PATHS se sirven sin sesion; el resto lleva a GUEST_BLOCKED_PATH.
 * - `cloud`: con sesion. Todo como hasta ahora (D1 por tenant).
 *
 * La sesion manda: si hay sesion valida el modo es `cloud` aunque quede la cookie de invitado.
 */

export type AppMode = 'guest' | 'cloud';

/** Cookie (no HttpOnly: la lee el cliente) que marca el modo local en este navegador. */
export const GUEST_COOKIE = 'gara_mode';
export const GUEST_COOKIE_VALUE = 'guest';

/**
 * Cookie que marca que este navegador ya entro a la app. Con ella (o con sesion), `/`
 * redirige a la app en vez de mostrar la landing.
 */
export const APP_SEEN_COOKIE = 'gara_app';

/** Query que fuerza ver la landing aunque el navegador ya use la app (`/?inicio=1`). */
export const LANDING_QUERY = 'inicio';

/** Un año: las dos cookies son preferencias del navegador, no credenciales. */
export const MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Inicio de la app segun el modo. */
export const APP_HOME: Record<AppMode, string> = {
  guest: '/fleet/garage',
  cloud: '/fleet',
};

/** Pagina que explica que una seccion necesita cuenta (modo local). */
export const GUEST_BLOCKED_PATH = '/fleet/cuenta-requerida';

/** Pagina del respaldo cifrado de extremo a extremo. */
export const BACKUP_PATH = '/fleet/respaldo';

/**
 * Paginas que funcionan sin sesion en modo local. Prefijo de segmento: '/fleet/garage'
 * cubre '/fleet/garage/lab' pero no '/fleet/garagex'. Una pagina nueva NO entra aqui
 * por defecto: tiene que funcionar sin D1 antes de añadirla.
 */
export const GUEST_ALLOWED_PATHS = [
  '/fleet',
  '/fleet/ajustes',
  '/fleet/bienvenida',
  '/fleet/catalog',
  GUEST_BLOCKED_PATH,
  '/fleet/garage',
  '/fleet/garage/anunciantes',
  '/fleet/garage/engine-lab',
  '/fleet/garage/expediente/[id]',
  '/fleet/garage/flota-demo-chile',
  '/fleet/garage/lab',
  '/fleet/mercado',
  '/fleet/mercado/vender',
  '/fleet/radar',
  BACKUP_PATH,
] as const;

export function isGuestAllowedPath(pathname: string): boolean {
  // Un expediente exige un id no vacio: /fleet/garage/expediente/ sin id no es una ruta permitida.
  if (/^\/fleet\/garage\/expediente\/[^/]+$/.test(pathname)) return true;
  return GUEST_ALLOWED_PATHS.some((p) => pathname === p);
}

/** Valor de una cookie en una cabecera `cookie` (o en `document.cookie`). */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Modo visto desde el navegador. Sin `document` (SSR, tests) devuelve `cloud`, que es el
 * comportamiento de siempre. Solo es una pista para la UI: quien decide el acceso es el
 * middleware.
 */
export function getClientMode(): AppMode {
  if (typeof document === 'undefined') return 'cloud';
  return readCookie(document.cookie, GUEST_COOKIE) === GUEST_COOKIE_VALUE ? 'guest' : 'cloud';
}

/** Evento que el almacen local emite tras cada escritura (el respaldo cifrado lo escucha). */
export const LOCAL_CHANGED_EVENT = 'gara:local-changed';

/** Tenant de los datos locales. Nunca coincide con un tenant de D1. */
export const LOCAL_INSTANCE_ID = 'local-device';
