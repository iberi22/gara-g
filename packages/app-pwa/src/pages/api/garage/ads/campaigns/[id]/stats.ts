/**
 * GET /api/garage/ads/campaigns/[id]/stats — Estadisticas de una campana.
 *
 * Devuelve el gasto por dia, impresiones, clics, el CTR y el cPC realmente pagado. El
 * anunciante necesita ver esto para saber si su puja esta sirviendo: es lo que le
 * permite subirla o bajarla, y es la unica forma de que entienda por que su anuncio no
 * aparece. El precio que se le muestra es el de la subasta (segundo precio), no la puja:
 * por eso el "cPC real" suele salir mejor que lo ofertado, y eso hay que verlo claro.
 *
 * Acceso: el dueño de la campana o un admin. Cualquier otro usuario, 403.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, forbidden, unauthorized } from '../../../../fleetApi/auth';
import { getAdvertiser, getCampaign, listStatsOf, type AdStatRecord } from '../../../../../../garage/shop/store';
import { json, jsonError, isAdmin, ownsAdvertiser } from '../../../../garage/shop/_shared';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const id = params.id;
  if (!id) return jsonError('Falta id de campaña', 400);

  const campaign = await getCampaign(id);
  if (!campaign) return jsonError('Campaña no encontrada', 404);

  if (!isAdmin(user.role)) {
    const advertiser = await getAdvertiser(campaign.advertiserId);
    if (!ownsAdvertiser(advertiser, user.userId)) return forbidden('Esa campaña no es tuya');
  }

  const days: AdStatRecord[] = await listStatsOf(id);
  const impressions = days.reduce((a: number, d: AdStatRecord) => a + d.impressions, 0);
  const clicks = days.reduce((a: number, d: AdStatRecord) => a + d.clicks, 0);
  const spendCOP = days.reduce((a: number, d: AdStatRecord) => a + d.spendCOP, 0);

  return json({
    campaignId: id,
    status: campaign.status,
    pricing: campaign.pricing,
    dailyBudgetCOP: campaign.dailyBudgetCOP,
    totalBudgetCOP: campaign.totalBudgetCOP,
    totals: {
      impressions,
      clicks,
      spendCOP,
      /** Proporcion de clics sobre impresiones, en porcentaje. */
      ctrPct: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      /** Costo real por clic. Sin clics, null en vez de 0: "todavia no hay clics" != "gratis". */
      cpcRealCOP: clicks > 0 ? Math.round(spendCOP / clicks) : null,
      /** Costo por mil impresiones, que es como se compara una campana CPM. */
      cpmRealCOP: impressions > 0 ? Math.round((spendCOP / impressions) * 1000) : null,
    },
    days: days.map((d) => ({ day: d.day, impressions: d.impressions, clicks: d.clicks, spendCOP: d.spendCOP })),
  });
};