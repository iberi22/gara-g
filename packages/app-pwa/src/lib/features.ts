/**
 * src/lib/features.ts — Interruptores de producto. Un solo sitio que los lee.
 *
 * FLEET_ONLY: primera entrega al cliente de flotas (volquetas, Chile). Solo el SaaS de flota:
 * vehiculos, conductores, mantenimiento, combustible, documentos, geocercas y alertas. El
 * Mercado, la billetera (saldo de anunciantes), DePIN y el radar V2V aun no se pueden mostrar
 * bien, asi que con el interruptor encendido:
 *   - no salen en el menu ni en la portada (FleetLayout, index.astro);
 *   - sus paginas y APIs responden 404 desde el middleware (no 401/403: no se anuncia que existen).
 *
 * Se lee de la variable del Worker `FLEET_ONLY` (wrangler.toml [vars]). Sin la variable el
 * interruptor queda ENCENDIDO: un deploy que olvide la var no puede volver a enseñar al
 * cliente secciones a medio hacer. Solo `"false"`/`"0"`/`false` lo apagan, y apagado el
 * comportamiento es el de siempre.
 */
import { env } from 'cloudflare:workers';

export function isFleetOnly(): boolean {
  let raw: unknown;
  try {
    raw = (env as unknown as { FLEET_ONLY?: string | boolean }).FLEET_ONLY;
  } catch {
    /* sin env: seguimos con process.env */
  }
  if (raw === undefined && typeof process !== 'undefined') raw = process.env.FLEET_ONLY;
  if (raw === undefined || raw === null) return true;
  if (raw === false) return false;
  const v = String(raw).trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
}

/**
 * Prefijos (de segmento) que FLEET_ONLY oculta. Pagina y API de cada modulo.
 *
 * - Mercado: bandeja y venta (/fleet/mercado*), portal de anunciantes y su API de pujas,
 *   saldo y recargas (/fleet/garage/anunciantes, /api/garage/ads/*), feed patrocinado
 *   (/api/garage/shop*).
 * - V2V: radar (/fleet/radar).
 * - Wallet / DePIN: hoy no hay rutas en la PWA; los prefijos quedan reservados para que una
 *   pagina nueva no aparezca en la entrega por accidente.
 */
export const FLEET_ONLY_HIDDEN_PREFIXES = [
  '/fleet/mercado',
  '/fleet/garage/anunciantes',
  '/api/garage/ads',
  '/api/garage/shop',
  '/fleet/radar',
  '/fleet/v2v',
  '/api/v2v',
  '/fleet/wallet',
  '/api/wallet',
  '/fleet/depin',
  '/api/depin',
] as const;

/** ¿La ruta pertenece a un modulo oculto? Prefijo de segmento: '/fleet/radar' no cubre '/fleet/radarx'. */
export function isHiddenByFleetOnly(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return FLEET_ONLY_HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** La ruta debe responder 404 ahora mismo (interruptor encendido y ruta oculta). */
export function isRouteHidden(pathname: string): boolean {
  return isHiddenByFleetOnly(pathname) && isFleetOnly();
}

/** Ids de la portada (src/pages/index.astro) que FLEET_ONLY quita. */
export const FLEET_ONLY_HIDDEN_LANDING_FEATURES = ['mercado'] as const;
