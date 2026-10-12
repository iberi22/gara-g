/**
 * POST /api/garage/ads/advertisers/[id]/topup — Recarga de saldo (solo admin).
 *
 *   { amountCOP: 50000 } → suma al saldo del anunciante y deja el movimiento registrado
 *   en la fila (con el momento y quien lo hizo) para poder auditar de donde sale el saldo.
 *
 * Por que admin y no autogestion: hasta integrar pasarela (Wompi / Mercado Pago, fuera de
 * alcance por ahora), el saldo es dinero real de GARA-G. Si cualquiera se recarga solo, el
 * "cobro" es ficticio. El limite duro es 10 millones por recarga: un `amountCOP` con un
 * typo (50000000 de mas) no se puede deshacer desde la UI.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, forbidden, unauthorized } from '../../../../fleetApi/auth';
import { getAdvertiser, topUpAdvertiser } from '../../../../../../garage/shop/store';
import { json, jsonError, isAdmin } from '../../../../garage/shop/_shared';

export const prerender = false;

/** Tope por recarga, en COP. Contra errores de dedo, no contra el presupuesto. */
export const MAX_TOPUP_COP = 10_000_000;

export const POST: APIRoute = async ({ params, request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!isAdmin(user.role)) return forbidden('Solo un administrador recarga saldo');

  const id = params.id;
  if (!id) return jsonError('Falta id de anunciante', 400);

  const advertiser = await getAdvertiser(id);
  if (!advertiser) return jsonError('Anunciante no encontrado', 404);

  const body = (await request.json().catch(() => null)) as { amountCOP?: unknown } | null;
  const amountCOP = Number(body?.amountCOP);
  if (!Number.isFinite(amountCOP) || amountCOP <= 0) return jsonError('El monto debe ser mayor que 0', 400);
  if (amountCOP > MAX_TOPUP_COP) {
    return jsonError(`Una recarga no puede pasar de ${MAX_TOPUP_COP.toLocaleString('es-CO')} COP`, 400);
  }

  const updated = await topUpAdvertiser(id, amountCOP);
  return json({ advertiser: updated });
};