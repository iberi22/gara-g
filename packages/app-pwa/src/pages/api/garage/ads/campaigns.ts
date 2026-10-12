/**
 * GET   /api/garage/ads/campaigns — mis campanas (o todas, si soy admin).
 * POST  /api/garage/ads/campaigns — crear campana → `pending_review`.
 * PATCH /api/garage/ads/campaigns?id= — editar SOLO mis campanas.
 *
 * Por que una campana nace `pending_review` y no `active`: elganador de la subasta se lo
 * ve un usuario sin contexto de por que; si alguien sube un anuncio con la URL de otro,
 * el unico filtro es que un admin lo mire. Publicar con un solo clic de "guardar"
 * convertiria el garage en un tablero de spam.
 *
 * Regla de dueno en las tres operaciones: `campaign.advertiserId` debe apuntar a un
 * anunciante cuyo `ownerUserId` sea el de la sesion. Editar la campana de otro devuelve
 * 403, no 404: el existe, pero no es tuyo (el 404 se reserva para lo que no existe).
 */
import type { APIRoute } from 'astro';
import { getAuthUser, forbidden, unauthorized } from '../../fleetApi/auth';
import { getAdvertiser, getCampaign, listCampaigns, patchCampaign, createCampaign } from '../../../../garage/shop/store';
import { listAdvertisersOf } from '../../../../garage/shop/store';
import { json, jsonError, isAdmin, ownsAdvertiser, validateCampaignBody, applyCampaignPatch } from '../shop/_shared';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const all = await listCampaigns();
  if (isAdmin(user.role)) return json({ campaigns: all });

  const mine = await listAdvertisersOf(user.userId);
  const ids = new Set(mine.map((a) => a.id));
  return json({ campaigns: all.filter((c) => ids.has(c.advertiserId)) });
};

export const POST: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateCampaignBody(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const advertiser = await getAdvertiser(parsed.campaign.advertiserId);
  if (!ownsAdvertiser(advertiser, user.userId)) {
    return forbidden('Ese anunciante no es tuyo');
  }

  const created = await createCampaign({ ...parsed.campaign, status: 'pending_review' });
  return json({ campaign: created }, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('Falta id de campaña', 400);

  const campaign = await getCampaign(id);
  if (!campaign) return jsonError('Campaña no encontrada', 404);

  // Solo el dueño (o un admin, que puede corregir un anuncio desde la cola de revision).
  if (!isAdmin(user.role)) {
    const advertiser = await getAdvertiser(campaign.advertiserId);
    if (!ownsAdvertiser(advertiser, user.userId)) return forbidden('Esa campaña no es tuya');
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError('Cuerpo vacío', 400);

  // Si edita el creativo o la segmentacion de una campana ya aprobada, vuelve a revision:
  // el texto que aprobo un admin no es el texto que va a ver el usuario.
  const touchesCreative = body.creative !== undefined || body.targeting !== undefined;
  const next = applyCampaignPatch(campaign, body);
  if (touchesCreative && campaign.status === 'active') next.status = 'pending_review';

  const updated = await patchCampaign(id, next);
  return json({ campaign: updated });
};