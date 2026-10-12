/**
 * PATCH /api/garage/ads/campaigns/[id]/review — Cola de revision (solo admin).
 *
 *   { decision: 'approve' } → la campana pasa a `active` y entra en la subasta.
 *   { decision: 'reject' }   → la campana queda `rejected`; el anunciante edita y
 *                              vuelve a enviar (PATCH la devuelve a `pending_review`).
 *
 * Aprobar NO es un acto cosmico: el anunciante entra a pujar contra otros y a pagar de su
 * saldo. Por eso es el unico punto donde un humano decide que el mundo ve ese anuncio.
 * Un `active` con saldo 0 no se sirve (lo filtra la subasta), asi que aprobar sin saldo no
 * es un peligro, es solo dinero quieto.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, forbidden, unauthorized } from '../../../../fleetApi/auth';
import type { AdCampaign } from '../../../../../../garage/contracts';
import { getCampaign, patchCampaign } from '../../../../../../garage/shop/store';
import { json, jsonError, isAdmin } from '../../../../garage/shop/_shared';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!isAdmin(user.role)) return forbidden('Solo un administrador revisa anuncios');

  const id = params.id;
  if (!id) return jsonError('Falta id de campaña', 400);

  const campaign = await getCampaign(id);
  if (!campaign) return jsonError('Campaña no encontrada', 404);

  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (body?.decision !== 'approve' && body?.decision !== 'reject') {
    return jsonError('La decisión debe ser approve o reject', 400);
  }
  if (campaign.status !== 'pending_review') {
    return jsonError(`La campaña está en ${campaign.status}, no en revisión`, 409);
  }

  // `reviewedAt`/`reviewedBy` no estan en `AdCampaign` (es el contrato entre islas, no
  // la bitacora): viven en la fila como campos extra. Se pasan por el patch generico.
  const updated = await patchCampaign(id, {
    status: body.decision === 'approve' ? 'active' : 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewedBy: user.userId,
  } as Partial<AdCampaign>);
  return json({ campaign: updated });
};