/**
 * POST /api/garage/ads/impression — Cobra la impresion (modelo CPM). Responde 204.
 *
 * Recibe SOLO el token. Ni el precio, ni la campana, ni el usuario: todo eso viaja dentro
 * del token firmado, y si no cuadra la firma no se cobra nada. Aceptar un `priceCOP` del
 * cliente seria aceptar que el anunciante se cobre lo que el quiera.
 *
 * Idempotencia: la misma impresion reenviada por el navegador no vuelve a contar. Ahora es
 * EXACTA (ronda 2, C2): `chargeImpression` reserva el nonce del token antes de cobrar, con
 * id = nonce, y la PK de D1 hace que el reenvio choque y devuelva `duplicate`. Se responde
 * 204 igual (el cliente no necesita enterarse) pero sin cobrar. Antes no habia dedupe y cada
 * reenvio cobraba.
 *
 * Robustez (L1, ronda 2): ni el cuerpo ni la verificacion pueden lanzar. Un POST con cuerpo
 * invalido, o un token con formato que revienta al verificar,Produces una promesa rechazada
 * que en Astro/Workers llega al manejador global de errores en vez de una respuesta: el
 * cliente ve un 500 generico y se pierde el log de por que. Por eso todo va dentro del
 * `try`, y el fallo se registra con su motivo. La respuesta sigue siendo 204: esta ruta
 * nunca debe romper la UI del usuario por un problema de cobro.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, unauthorized } from '../../fleetApi/auth';
import { chargeImpression } from '../../../../garage/shop/store';
import { verifyAdToken } from '../../../../garage/shop/tokens';
import { jsonError } from '../shop/_shared';

/** Describe un error sin reventar si lo que se lanzo no es un Error (puede ser cualquier valor). */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  let token: string | undefined;
  try {
    const body = (await request.json().catch(() => null)) as { token?: string } | null;
    token = typeof body?.token === 'string' ? body.token : undefined;
  } catch (error) {
    console.log(`[ads] impression con cuerpo ilegible: ${describeError(error)}`);
    return jsonError('Cuerpo de la petición inválido', 400);
  }

  const verified = await verifyAdToken(token);
  if (!verified.ok) return jsonError('Token de anuncio inválido o vencido', 400);

  const { campaignId, userHash, priceCOP, pricingModel } = verified.payload;
  // El token es de CPM: un token de CPC no debe cobrarse aqui (el clic cobra su precio).
  if (pricingModel !== 'cpm') return jsonError('Este anuncio se cobra por clic', 400);

  // El token va entero: `chargeImpression` saca de el el nonce para el dedupe.
  // `token` ya se validó arriba: si `verifyAdToken` dijo que vale, es un string.
  const result = await chargeImpression({
    campaignId,
    token: token as string,
    priceCOP,
    userHash,
    now: Date.now(),
  });
  if (!result.ok) {
    // Sin campana o sin saldo no es un error del cliente: se registra y se responde 204
    // para no romper la UI, pero no se cobra nada.
    console.log(`[ads] impression no cobrada campaign=${campaignId} motivo=${result.reason}`);
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 204 });
};