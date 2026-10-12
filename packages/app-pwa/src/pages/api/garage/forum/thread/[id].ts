/**
 * /api/garage/forum/thread/[id].ts — Un hilo concreto: leer, responder, moderar.
 *
 * GET   /api/garage/forum/thread/:id → { thread, posts }
 * POST  /api/garage/forum/thread/:id  { body } → { post }   (409 si el hilo esta locked)
 * PATCH /api/garage/forum/thread/:id  { pinned?, locked?, deleted? } → { thread }  (solo admin)
 *
 * El `id` es el de la fila en D1 (`entity.id`), no el de la URL de la version: el
 * hilo se busca por id y su `versionKey` se lee del propio hilo. Por eso esta ruta
 * no valida `versionKey`; la validacion de la llave vive en `[versionKey].ts` y en
 * la wiki, donde si es un parametro de entrada.
 *
 * Moderar es solo para admin (403), y el borrado es LOGICO: el hilo deja de
 * listarse y de leerse, pero la fila se queda (ver community/forum.ts).
 */
import type { APIRoute } from 'astro';
import { authorFor, isModerator, ok, requireUser } from '../../../../../garage/community/auth';
import {
  CommunityError,
  errorResponse,
  tooManyMessages,
} from '../../../../../garage/community/errors';
import { getThread, moderateThread, replyToThread } from '../../../../../garage/community/forum';
import { checkRateLimit, consumeRateLimit } from '../../../../../garage/community/rateLimit';
import { getAuthUser } from '../../../fleetApi/auth';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  try {
    requireUser(await getAuthUser(request));
    const threadId = params.id ?? '';
    if (!threadId) throw new CommunityError('Falta el id del hilo', 400);

    const result = await getThread(threadId);
    return ok({ thread: result.thread, posts: result.posts });
  } catch (err) {
    return errorResponse(err);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const user = requireUser(await getAuthUser(request));
    const threadId = params.id ?? '';
    if (!threadId) throw new CommunityError('Falta el id del hilo', 400);

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object')
      throw new CommunityError('Cuerpo JSON invalido', 400);
    const { body } = payload as { body?: unknown };

    const { authorId } = await authorFor(user);
    const verdict = checkRateLimit(authorId);
    if (!verdict.ok) return tooManyMessages(verdict.retryAfterSec, verdict.scope ?? 'short');

    // `replyToThread` responde 409 si el hilo esta locked, y 400 si el cuerpo no
    // cumple el limite: se comprueba el ritmo antes porque es lo mas barato.
    const post = await replyToThread(threadId, {
      body: typeof body === 'string' ? body : '',
      authorId,
    });
    consumeRateLimit(authorId);
    return ok({ post }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const user = requireUser(await getAuthUser(request));
    // La moderacion es la UNICA accion de la comunidad restringida por rol:
    // cualquiera con sesion puede preguntar, pero solo un admin fija, cierra o borra.
    if (!isModerator(user)) {
      throw new CommunityError('Solo un administrador puede moderar el foro', 403);
    }

    const threadId = params.id ?? '';
    if (!threadId) throw new CommunityError('Falta el id del hilo', 400);

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object')
      throw new CommunityError('Cuerpo JSON invalido', 400);
    const { pinned, locked, deleted } = payload as {
      pinned?: unknown;
      locked?: unknown;
      deleted?: unknown;
    };

    const thread = await moderateThread(threadId, {
      pinned: typeof pinned === 'boolean' ? pinned : undefined,
      locked: typeof locked === 'boolean' ? locked : undefined,
      deleted: typeof deleted === 'boolean' ? deleted : undefined,
    });
    return ok({ thread });
  } catch (err) {
    return errorResponse(err);
  }
};
