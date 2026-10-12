/**
 * GET  /api/garage/ads/advertisers — mis anunciantes (y todos, si soy admin).
 * POST /api/garage/ads/advertisers — registrarme como anunciante.
 *
 * El anunciante nace con saldo 0 y sin verificar: sin saldo, la subasta no le sirve nada
 * (asi lo filtra `runAuction`), y sin verificar nadie lo aprueba. Que aparezca en el feed
 * exige las dos cosas mas un admin que recargue el saldo: es deliberado, nadie se
 * registra y empieza a salir ads sin que nadie mire.
 *
 * Un usuario puede tener varios anunciantes (tienda + taller, por ejemplo): el dueno es
 * `ownerUserId` y cada campana cuelga de su anunciante.
 */
import type { APIRoute } from 'astro';
import { getAuthUser, unauthorized } from '../../fleetApi/auth';
import { createAdvertiser, listAdvertisersOf } from '../../../../garage/shop/store';
import { listEntities } from '../../../../lib/domain';
import { ADS_INSTANCE_ID } from '../../../../lib/domain.config';
import { json, jsonError, isAdmin, parseAdvertiserKind } from '../shop/_shared';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  if (isAdmin(user.role)) {
    const all = await listEntities<Record<string, unknown>>('adAdvertiser', ADS_INSTANCE_ID);
    return json({ advertisers: all });
  }
  return json({ advertisers: await listAdvertisersOf(user.userId) });
};

export const POST: APIRoute = async ({ request }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return jsonError('Falta el nombre del anunciante', 400);
  if (name.length > 80) return jsonError('El nombre no puede pasar de 80 caracteres', 400);

  const kind = parseAdvertiserKind(body?.kind);
  if (!kind) return jsonError('Tipo de anunciante no reconocido', 400);

  // El portal promete "si lo dejas vacío usamos el correo de tu sesión", asi que un string
  // vacio tiene que caer al correo de la sesion y no reprobarse: `||` y no `typeof`, que
  // solo miraria el tipo y dejaria pasar el '' como si fuera un correo.
  const contactEmail = (typeof body?.contactEmail === 'string' ? body.contactEmail.trim() : '') || user.email;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return jsonError('Correo de contacto inválido', 400);
  }
  const city = typeof body?.city === 'string' && body.city.trim() ? body.city.trim() : undefined;

  const advertiser = await createAdvertiser({
    name,
    kind,
    contactEmail,
    ...(city ? { city } : {}),
    ownerUserId: user.userId,
  });
  return json({ advertiser }, 201);
};