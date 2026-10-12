/**
 * GET /api/garage/ads/serve?slot=&vehicleId=&partCategory= — Sirve anuncios de un slot.
 *
 * Es la ruta que la UI del garage consulta al abrir el taller o al mirar una pieza: le
 * dice que anuncios mostrar y le devuelve el token firmado de cada uno. Con
 * `partCategory` el contexto incluye la pieza que el usuario esta mirando, que es lo que
 * activa el bonus de relevancia x1.25 y permite que un taller de frenos se anuncie solo
 * en la pantalla de frenos.
 *
 * Contexto desde el tenant de la sesion (nunca del cliente salvo `vehicleId`).
 */
import type { APIRoute } from 'astro';
import { getAuthUser, unauthorized } from '../../fleetApi/auth';
import { buildAdContext, contextForVehicle, hashForUser, serveAds } from '../../../../garage/shop/serve';
import { hasUsableSecret } from '../../../../garage/shop/tokens';
import { json, jsonError, parseSlot, tenantOf } from '../shop/_shared';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!hasUsableSecret()) return jsonError('Anuncios no disponibles: falta ADS_TOKEN_SECRET', 503);

  const url = new URL(request.url);
  const slot = parseSlot(url.searchParams.get('slot'));
  if (!slot) return jsonError('Slot desconocido', 400);

  const vehicleId = url.searchParams.get('vehicleId');
  if (!vehicleId) return jsonError('Falta vehicleId', 400);

  const vehicle = await contextForVehicle(vehicleId, tenantOf(locals));
  if (!vehicle) return jsonError('Vehículo no encontrado en tu flota', 404);

  const partCategory = url.searchParams.get('partCategory') ?? undefined;
  const now = Date.now();
  const hash = await hashForUser(user.userId);
  const ctx = buildAdContext(slot, vehicle, hash, partCategory);

  const { ads, excluded } = await serveAds({ slot, ctx, now });
  if (excluded.length) {
    console.log(`[ads] serve slot=${slot} vehicle=${vehicleId} servidas=${ads.length} excluidas=${excluded.length}`);
  }
  return json({ ads });
};