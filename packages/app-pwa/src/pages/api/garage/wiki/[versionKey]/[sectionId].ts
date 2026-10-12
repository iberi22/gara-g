/**
 * /api/garage/wiki/[versionKey]/[sectionId].ts — Editar una seccion de la wiki.
 *
 * PUT /api/garage/wiki/:versionKey/:sectionId  { body, baseRevision } → { page }
 *
 * Solo se editan las secciones de COMUNIDAD (fallas-comunes, torques-y-fluidos,
 * repuestos-compatibles, consejos). Las de catalogo responden 403: su texto se
 * deriva de `vehicleCatalog.ts` y `specs/modelSpecs.ts`, y en cuanto alguien lo
 * edite a mano dejaria de coincidir con la ficha tecnica que lo origina. Un
 * `sectionId` que no existe en la pagina responde 404, para que un cliente con un
 * enlace viejo sepa que hay que actualizar y no que esta prohibido.
 *
 * El control es optimista: `baseRevision` es la revision que el cliente tiene en
 * pantalla. Si alguien escribo entre medias, se responde 409 con la pagina
 * ACTUAL en el cuerpo (`page`), de modo que la UI pueda ensenar los dos textos en
 * vez de pisar el trabajo ajeno.
 *
 * Exige sesion (401) y `versionKey` con formato de slug (400).
 */
import type { APIRoute } from 'astro';
import { authorFor, ok, requireUser } from '../../../../../garage/community/auth';
import {
  CommunityError,
  errorResponse,
  tooManyMessages,
} from '../../../../../garage/community/errors';
import { checkRateLimit, consumeRateLimit } from '../../../../../garage/community/rateLimit';
import { isCatalogSection, isKnownSection } from '../../../../../garage/community/sections';
import { editCommunitySection } from '../../../../../garage/community/wiki';
import { isValidVersionKey } from '../../../../../garage/domain/versionKey';
import { getAuthUser } from '../../../fleetApi/auth';

export const prerender = false;

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const user = requireUser(await getAuthUser(request));
    const versionKey = params.versionKey ?? '';
    if (!isValidVersionKey(versionKey))
      throw new CommunityError(`versionKey invalida: ${versionKey}`, 400);

    const sectionId = params.sectionId ?? '';
    // 403 antes que 404 a proposito: "no editable" es la respuesta util para un
    // cliente que intenta escribir en la seccion de catalogo que ve en pantalla.
    if (isCatalogSection(sectionId)) {
      throw new CommunityError(
        `La seccion "${sectionId}" viene del catalogo y es de solo lectura`,
        403,
      );
    }
    if (!isKnownSection(sectionId)) {
      throw new CommunityError(`La seccion "${sectionId}" no existe en la wiki`, 404);
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object')
      throw new CommunityError('Cuerpo JSON invalido', 400);
    const { body, baseRevision } = payload as { body?: unknown; baseRevision?: unknown };

    const { authorName } = await authorFor(user);
    // La cuota de la wiki va en su propia clave: editar el mismo texto cinco veces
    // no puede agotar el cupo de mensajes del foro (y al reves).
    const rateKey = `wiki:${authorName}`;
    const verdict = checkRateLimit(rateKey);
    if (!verdict.ok) return tooManyMessages(verdict.retryAfterSec, verdict.scope ?? 'short');

    const outcome = await editCommunitySection({
      versionKey,
      sectionId,
      body: typeof body === 'string' ? body : '',
      baseRevision: typeof baseRevision === 'number' ? baseRevision : Number.NaN,
      authorName,
    });

    // Conflicto de revision: se devuelve la pagina vigente para que el cliente
    // resuelva. NO se consume cuota de ritmo: nadie publico nada.
    if (!outcome.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'La seccion cambio mientras editabas: recarga y vuelve a aplicar tu texto',
          page: outcome.current,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }

    consumeRateLimit(rateKey);
    return ok({ page: outcome.page });
  } catch (err) {
    return errorResponse(err);
  }
};
