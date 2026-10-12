/**
 * /api/garage/forum/[versionKey].ts — Hilos de una version: listar y crear.
 *
 * GET  /api/garage/forum/:versionKey?cursor=&limit= → { threads, nextCursor }
 * POST /api/garage/forum/:versionKey  { title, body, tags? } → { thread }
 *
 * Todo exige sesion (401) y una `versionKey` con formato de slug (400). El tenant
 * no se mira: el foro es de la version, no de la flota, asi que dos duenos del
 * mismo modelo y generacion ven lo mismo aunque pertenezcan a instancias
 * distintas. El autor se guarda pseudonimizado (ver community/identity.ts).
 *
 * El 401, el 400 de la llave y los errores de negocio salen todos por el mismo
 * `catch`: `requireUser` lanza `CommunityError(401)` y `errorResponse` decide el
 * codigo, de modo que la lista de estados posibles esta en un solo sitio.
 */
import type { APIRoute } from 'astro';
import { authorFor, ok, requireUser } from '../../../../garage/community/auth';
import {
  CommunityError,
  errorResponse,
  tooManyMessages,
} from '../../../../garage/community/errors';
import { createThread, listThreads } from '../../../../garage/community/forum';
import { checkRateLimit, consumeRateLimit } from '../../../../garage/community/rateLimit';
import { cleanTags } from '../../../../garage/community/text';
import { isValidVersionKey } from '../../../../garage/domain/versionKey';
import { getAuthUser } from '../../fleetApi/auth';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  try {
    requireUser(await getAuthUser(request));
    const versionKey = params.versionKey ?? '';
    if (!isValidVersionKey(versionKey))
      throw new CommunityError(`versionKey invalida: ${versionKey}`, 400);

    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

    const page = await listThreads(versionKey, { cursor, limit });
    return ok({ threads: page.threads, nextCursor: page.nextCursor });
  } catch (err) {
    return errorResponse(err);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const user = requireUser(await getAuthUser(request));
    const versionKey = params.versionKey ?? '';
    if (!isValidVersionKey(versionKey))
      throw new CommunityError(`versionKey invalida: ${versionKey}`, 400);

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object')
      throw new CommunityError('Cuerpo JSON invalido', 400);
    const { title, body, tags } = payload as { title?: unknown; body?: unknown; tags?: unknown };

    // El ritmo se comprueba ANTES de escribir para poder devolver 429 sin haber
    // creado nada; la cuota se consume solo si el hilo se creo de verdad.
    const { authorId } = await authorFor(user);
    const verdict = checkRateLimit(authorId);
    if (!verdict.ok) return tooManyMessages(verdict.retryAfterSec, verdict.scope ?? 'short');

    const thread = await createThread({
      versionKey,
      title: typeof title === 'string' ? title : '',
      body: typeof body === 'string' ? body : '',
      tags: cleanTags(tags),
      authorId,
    });
    consumeRateLimit(authorId);
    return ok({ thread }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};
