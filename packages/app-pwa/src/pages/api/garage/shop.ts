/**
 * GET /api/garage/shop?vehicleId= — El feed del shop del vehiculo del usuario.
 *
 * Devuelve `ShopFeed`: hasta 3 patrocinados (subasta del slot `shop_feed`) y las
 * publicaciones organicas de su marca o version, mas recientes primero.
 *
 * El vehiculo sale de la entidad `vehicle` del TENANT DE LA SESION. De la query solo se
 * acepta `vehicleId`: si el cliente mandara familia o marca, podria pedir la subasta para
 * un vehiculo que no tiene y segmentar por algo falso.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, unauthorized } from '../fleetApi/auth';
import { buildShopFeed, loadOrganicPosts } from '../../../garage/shop/feed';
import { buildAdContext, contextForVehicle, hashForUser, serveAds } from '../../../garage/shop/serve';
import { hasUsableSecret } from '../../../garage/shop/tokens';
import { json, jsonError, tenantOf } from './shop/_shared';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  // Sin secreto de firma no se pueden emitir tokens: 503 antes de servir nada.
  if (!hasUsableSecret()) return jsonError('Anuncios no disponibles: falta ADS_TOKEN_SECRET', 503);

  const url = new URL(request.url);
  const vehicleId = url.searchParams.get('vehicleId');
  if (!vehicleId) return jsonError('Falta vehicleId', 400);

  const vehicle = await contextForVehicle(vehicleId, tenantOf(locals));
  if (!vehicle) return jsonError('Vehículo no encontrado en tu flota', 404);

  const now = Date.now();
  const hash = await hashForUser(user.userId);
  const ctx = buildAdContext('shop_feed', vehicle, hash);

  const feed = await buildShopFeed(ctx, {
    serve: async (c) => serveAds({ slot: 'shop_feed', ctx: c, now }),
    organicPosts: () => loadOrganicPosts(vehicle.make, vehicle.versionKey),
  });

  if (feed.excluded.length) {
    console.log(
      `[ads] shop_feed vehicle=${vehicleId} servidas=${feed.sponsored.length} excluidas=${feed.excluded.length}`,
    );
  }
  return json({ sponsored: feed.sponsored, posts: feed.posts });
};