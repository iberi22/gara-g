/**
 * topics.ts — Nombres de topic y salas de la red de datos.
 *
 * Una sala = una region (geohash de precision 4, ~una ciudad). Es la celda mas gruesa de las
 * dos redes: las ofertas de un taller sirven a toda la ciudad y una sala grande revela poco
 * de donde esta cada dueno (ver geocell.ts). Aqui nunca entra una coordenada exacta: quien
 * calcula la region descarta lat/lon en el mismo paso.
 */
import { DATOS_PRECISION, encodeGeohash } from '../geocell';

export const TOPIC_OFFER = 'offer';
export const TOPIC_DEMAND = 'demand';
export const TOPIC_NAV = 'nav';

const BASE32 = /^[0-9bcdefghjkmnpqrstuvwxyz]+$/;

/** Region (celda p4) de una coordenada. La coordenada no se guarda en ningun sitio. */
export function regionOf(lat: number, lon: number): string {
  return encodeGeohash(lat, lon, DATOS_PRECISION);
}

export function isRegionCell(v: unknown): v is string {
  return typeof v === 'string' && v.length === DATOS_PRECISION && BASE32.test(v);
}

/** Celda de navegacion v2v (p4 a p8) valida. */
export function isGeoCell(v: unknown): v is string {
  return typeof v === 'string' && v.length >= DATOS_PRECISION && v.length <= 8 && BASE32.test(v);
}

/** La sala de datos de una celda cualquiera: siempre su region p4. */
export function regionRoom(cell: string): string {
  return cell.slice(0, DATOS_PRECISION);
}
