/**
 * /api/garage/wiki/[versionKey].ts — Wiki de una version (lectura).
 *
 * GET /api/garage/wiki/:versionKey → WikiPage
 *
 * Exige sesion (401) y `versionKey` con formato de slug (400). La pagina se arma al
 * vuelo: las secciones de catalogo salen de `vehicleCatalog.ts` y
 * `specs/modelSpecs.ts` (solo lectura) y las de comunidad de la tabla `wikiSection`
 * de la instancia compartida. Una version que no esta en el catalogo tambien
 * devuelve 200: tiene las cuatro secciones de comunidad vacias y una etiqueta de
 * version legible derivada de la llave. Un 404 aqui seria mentir: la wiki de esa
 * version existe, simplemente nadie ha escrito nada todavia.
 */
import type { APIRoute } from 'astro';
import { ok, requireUser } from '../../../../garage/community/auth';
import { CommunityError, errorResponse } from '../../../../garage/community/errors';
import { getWikiPage } from '../../../../garage/community/wiki';
import { isValidVersionKey } from '../../../../garage/domain/versionKey';
import { getAuthUser } from '../../fleetApi/auth';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  try {
    requireUser(await getAuthUser(request));
    const versionKey = params.versionKey ?? '';
    if (!isValidVersionKey(versionKey))
      throw new CommunityError(`versionKey invalida: ${versionKey}`, 400);

    const page = await getWikiPage(versionKey);
    return ok({ page });
  } catch (err) {
    return errorResponse(err);
  }
};
