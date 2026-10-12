/**
 * GET /api/garage/ads/click?t= — Cobra el clic (modelo CPC) y redirige al anunciante.
 *
 * Es un 302 a la URL del anuncio. Por que GET y no POST: es un enlace de <a href>, y un
 * <a> no puede hacer POST. Por que el token y no parametros sueltos: el clic es la
 * fuente de ingreso del modelo CPC y no puede ser falseado desde el navegador.
 *
 * Red de seguridad del 302 (esta es la parte critica de esta ruta):
 *   - El token debe verificar firma y caducidad. Si no, NUNCA se redirige al destino del
 *     cliente: se va a `/fleet/garage`.
 *   - El destino sale de la campana guardada en D1, no del request. Aun asi pasa por
 *     `safeRedirectTarget`, que solo deja https o rutas internas. Un anuncio creado antes
 *     de que existiera la validacion, o una fila adulterada, no convierten esta ruta en
 *     un redirector abierto a `javascript:` ni a un host http.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, unauthorized } from '../../fleetApi/auth';
import { getCampaign, chargeClick } from '../../../../garage/shop/store';
import { verifyAdToken } from '../../../../garage/shop/tokens';
import { safeRedirectTarget } from '../../../../garage/shop/url';

/** A donde va todo clic que no puede resolverse. */
const FALLBACK = '/fleet/garage';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  const verified = await verifyAdToken(token);
  if (!verified.ok) {
    return new Response(null, { status: 302, headers: { Location: FALLBACK } });
  }

  const { campaignId, priceCOP, pricingModel, userHash } = verified.payload;
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return new Response(null, { status: 302, headers: { Location: FALLBACK } });
  }

  // El token es de CPC: el clic cobra su precio. Uno de CPM ya se cobro por impresion.
  if (pricingModel === 'cpc') {
    const result = await chargeClick({ campaignId, token: token as string, priceCOP, userHash, now: Date.now() });
    if (!result.ok && result.reason !== 'duplicate') {
      console.log(`[ads] click no cobrado campaign=${campaignId} motivo=${result.reason}`);
    }
  }

  const target = safeRedirectTarget(campaign.creative.url, FALLBACK);
  return new Response(null, { status: 302, headers: { Location: target } });
};