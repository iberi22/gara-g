import { createEntity, getEntity, listEntities, updateEntity } from '../../lib/domain';
import type { DomainRecord } from '../../lib/domain';
/**
 * forum.ts — Store del foro por version (hilos y respuestas).
 *
 * Cada `versionKey` es un espacio propio: las filas viven en la instancia
 * compartida `gara-g-community` (COMMUNITY_INSTANCE_ID) pero se filtran SIEMPRE por
 * `versionKey`, que es lo que mantiene aislados a los duenos de generaciones
 * distintas del mismo modelo. El tenant del que viene la peticion no aparece en
 * ningun lado: el foro es de la version, no de la flota.
 *
 * Decisiones que no son obvias y conviene no deshacer:
 *   - Borrado LOGICO (`deleted: true`), nunca fisico. Un hilo borrado sigue
 *     ocupando fila para que sus respuestas no queden huerfanas ni cambien de sitio,
 *     pero no se lista ni se cuenta. Es tambien lo que permite auditar que un
 *     moderador borro algo.
 *   - `lastActivityAt` se actualiza al responder, no al moderar: con el orden
 *     "fijados primero y luego por actividad", un pin no debe reordenar el foro.
 *   - El listado trae el CUERPO del primer mensaje dentro del hilo, y las respuestas
 *     se piden por separado (`getThread`): listar 30 hilos con 30 respuestas cada uno
 *     seria 30x el payload para pintar una lista.
 *
 * Limitacion conocida (MVP): `listEntities` trae todas las filas de una entidad y
 * filtra en memoria (docs/garage/ARCHITECTURE.md). Aguanta miles de hilos; para mas,
 * mover a tablas propias con indice es un cambio local a este fichero, porque aqui
 * se encapsula todo el acceso a la tabla `entity`.
 */
import { COMMUNITY_INSTANCE_ID } from '../../lib/domain.config';
import type { ForumPost, ForumThread } from '../contracts';
import { CommunityError } from './errors';
import { aliasFromHash } from './identity';
import { cleanBody, cleanTags, cleanTitle } from './text';

/** Fila de hilo como vive en D1: el contrato mas `deleted` (no se expone al cliente). */
type ThreadBase = ForumThread & { deleted?: boolean };
/** Fila de respuesta como vive en D1. */
type PostBase = ForumPost & { deleted?: boolean };

/**
 * Los helpers de `lib/domain.ts` (`listEntities<T>`, `getEntity<T>`, `updateEntity<T>`)
 * exigen `T extends Record<string, unknown>`, y un tipo derivado de una INTERFAZ no
 * tiene indice implicito: sin cruzarlo aqui, `ThreadRow` no satisface la restriccion
 * aunque tenga todas sus propiedades. Por eso `Row` lleva `& Record<string, unknown>`.
 *
 * `Row` es la fila tal como se LEE (con `id`); `NewRow` es la que se ESCRIBE, sin
 * `id` porque ese lo genera `createEntity`.
 */
type ThreadRow = ThreadBase & Record<string, unknown>;
type PostRow = PostBase & Record<string, unknown>;
type NewThreadRow = Omit<ThreadBase, 'id'>;
type NewPostRow = Omit<PostBase, 'id'>;

const INSTANCE = COMMUNITY_INSTANCE_ID;

/** Cuantos hilos trae una pagina. 20 cabe en el HUD sin scrollear de mas. */
const PAGE_SIZE = 20;

/** Los cuatro campos del cuerpo de `POST /api/garage/forum/:versionKey`. */
export interface CreateThreadInput {
  versionKey: string;
  title: string;
  body: string;
  tags?: string[];
  authorId: string;
}

/** Lo que devuelve `createThread`: la fila mas el mapeo a contrato publico. */
function toThread(row: ThreadRow): ForumThread {
  return {
    id: row.id,
    versionKey: row.versionKey,
    title: row.title,
    body: row.body,
    authorId: row.authorId,
    authorName: row.authorName,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    replyCount: row.replyCount,
    tags: row.tags,
    pinned: row.pinned,
    locked: row.locked,
  };
}

function toPost(row: PostRow): ForumPost {
  return {
    id: row.id,
    threadId: row.threadId,
    versionKey: row.versionKey,
    body: row.body,
    authorId: row.authorId,
    authorName: row.authorName,
    createdAt: row.createdAt,
  };
}

/**
 * Crea un hilo. El autor entra ya pseudonimizado (la ruta calcula `authorId` con
 * identity.ts): esta funcion no sabe ni puede saber el userId real.
 */
export async function createThread(input: CreateThreadInput): Promise<ForumThread> {
  const title = cleanTitle(input.title);
  if (!title.ok) throw new CommunityError(title.error, 400);
  const body = cleanBody(input.body);
  if (!body.ok) throw new CommunityError(body.error, 400);

  const now = new Date().toISOString();
  const rec = await createEntity<NewThreadRow>(
    'forumThread',
    {
      versionKey: input.versionKey,
      title: title.value,
      body: body.value,
      // Solo el HMAC y el alias: ni userId ni correo en la instancia compartida.
      authorId: input.authorId,
      authorName: aliasFromHash(input.authorId),
      createdAt: now,
      lastActivityAt: now,
      replyCount: 0,
      tags: cleanTags(input.tags),
      pinned: false,
      locked: false,
    },
    INSTANCE,
  );
  return toThread(rec as unknown as ThreadRow);
}

export interface ThreadPage {
  threads: ForumThread[];
  /** Cursor para la siguiente pagina; null si no hay mas. */
  nextCursor: string | null;
}

/**
 * Lista los hilos de una version: fijados primero, luego por `lastActivityAt`
 * descendente, paginado por cursor.
 *
 * El cursor es el indice del ultimo hilo devuelto, codificado en base64url con el
 * `lastActivityAt` para que el listado no cambie bajo los pies del cliente: si
 * alguien responde entre pagina 1 y pagina 2, el hilo movido no se duplica ni se
 * pierde (ya estaba antes del cursor). Es el mismo criterio que un keyset en SQL,
 * aqui sobre un array.
 */
export async function listThreads(
  versionKey: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ThreadPage> {
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 50);
  const all = await listEntities<ThreadRow>('forumThread', INSTANCE);
  const mine = all.filter((r) => r.versionKey === versionKey && !r.deleted).sort(compareThreads);

  const start = decodeCursor(options.cursor ?? null);
  const page = start === null ? mine : mine.filter((r) => isAfterCursor(r, start));
  const visible = page.slice(0, limit);
  const hasMore = page.length > limit;

  return {
    threads: visible.map((r) => toThread(r as unknown as ThreadRow)),
    nextCursor: hasMore && visible.length > 0 ? encodeCursor(visible[visible.length - 1]) : null,
  };
}

/** Fijados primero; dentro de cada grupo, mas reciente primero. */
function compareThreads(a: DomainRecord<ThreadRow>, b: DomainRecord<ThreadRow>): number {
  const pa = a.pinned ? 0 : 1;
  const pb = b.pinned ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const ta = Date.parse(a.lastActivityAt ?? a.created_at ?? '') || 0;
  const tb = Date.parse(b.lastActivityAt ?? b.created_at ?? '') || 0;
  if (ta !== tb) return tb - ta;
  // Empate de tiempo: se desempata por id. Es un orden TOTAL y estable —los ids
  // no cambian— asi que la paginacion por cursor nunca duplica ni pierde un hilo.
  // Se elige descendente porque `genId()` de domain.ts empieza por el tiempo en
  // base36 ("muqdqf2k-xyz"), de modo que, si dos hilos comparten milisegundo, el
  // mayor id es el creado despues. El sufijo aleatorio de `genId()` no ordena nada
  // por si mismo, pero tampoco estorba: solo desempata lo que la fecha no pudo.
  return String(b.id).localeCompare(String(a.id));
}

interface Cursor {
  pinned: boolean;
  at: string;
  id: string;
}

function encodeCursor(row: DomainRecord<ThreadRow>): string {
  const c: Cursor = {
    pinned: Boolean(row.pinned),
    at: row.lastActivityAt ?? row.created_at ?? '',
    id: String(row.id),
  };
  return btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(b64)) as Partial<Cursor>;
    if (typeof parsed.id !== 'string' || typeof parsed.at !== 'string') return null;
    return { pinned: Boolean(parsed.pinned), at: parsed.at, id: parsed.id };
  } catch {
    // Cursor manipulado o de una version antigua: se ignora y se empieza por el
    // principio. Es preferible a devolver 400 al usuario por un cursor caducado.
    return null;
  }
}

/** `true` si el hilo cae DESPUES del cursor en el orden de `compareThreads`. */
function isAfterCursor(row: DomainRecord<ThreadRow>, c: Cursor): boolean {
  const pa = row.pinned ? 0 : 1;
  const pc = c.pinned ? 0 : 1;
  if (pa !== pc) return pa > pc;
  const ta = Date.parse(row.lastActivityAt ?? row.created_at ?? '') || 0;
  const tc = Date.parse(c.at) || 0;
  if (ta !== tc) return ta < tc;
  return String(row.id).localeCompare(c.id) < 0;
}

export interface ThreadWithPosts {
  thread: ForumThread;
  /** Respuestas en orden cronologico (mas antigua primero): se lee como una conversacion. */
  posts: ForumPost[];
}

/** Lee un hilo y sus respuestas. Un hilo borrado devuelve 404: no se lista ni se lee. */
export async function getThread(threadId: string): Promise<ThreadWithPosts> {
  const row = await getEntity<ThreadRow>('forumThread', threadId, INSTANCE);
  if (!row || row.deleted) throw new CommunityError('Hilo no encontrado', 404);

  const all = await listEntities<PostRow>('forumPost', INSTANCE);
  const posts = all
    .filter((p) => p.threadId === threadId && !p.deleted)
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));

  return {
    thread: toThread(row as unknown as ThreadRow),
    posts: posts.map((p) => toPost(p as unknown as PostRow)),
  };
}

/**
 * Responde a un hilo: crea la respuesta y actualiza `replyCount` y
 * `lastActivityAt` del hilo. Un hilo `locked` no admite respuestas (409).
 */
export async function replyToThread(
  threadId: string,
  input: { body: string; authorId: string },
): Promise<ForumPost> {
  const body = cleanBody(input.body);
  if (!body.ok) throw new CommunityError(body.error, 400);

  const thread = await getEntity<ThreadRow>('forumThread', threadId, INSTANCE);
  if (!thread || thread.deleted) throw new CommunityError('Hilo no encontrado', 404);
  if (thread.locked) throw new CommunityError('El hilo esta cerrado: no admite respuestas', 409);

  const now = new Date().toISOString();
  const rec = await createEntity<NewPostRow>(
    'forumPost',
    {
      threadId,
      // Se copia del hilo y no de la peticion: una respuesta no puede cambiar de version.
      versionKey: thread.versionKey,
      body: body.value,
      authorId: input.authorId,
      authorName: aliasFromHash(input.authorId),
      createdAt: now,
    },
    INSTANCE,
  );

  await updateEntity<ThreadRow>(
    'forumThread',
    threadId,
    { replyCount: (thread.replyCount ?? 0) + 1, lastActivityAt: now },
    INSTANCE,
  );

  return toPost(rec as unknown as PostRow);
}

/** Campos que un moderador puede cambiar. `deleted` es el borrado logico. */
export interface ModerationInput {
  pinned?: boolean;
  locked?: boolean;
  deleted?: boolean;
}

/**
 * Moderacion (fijar / cerrar / borrar logico). SOLO admin: el rol se comprueba en
 * la ruta, no aqui, porque esta capa no ve la sesion.
 */
export async function moderateThread(
  threadId: string,
  patch: ModerationInput,
): Promise<ForumThread> {
  const thread = await getEntity<ThreadRow>('forumThread', threadId, INSTANCE);
  if (!thread) throw new CommunityError('Hilo no encontrado', 404);

  const update: Partial<ThreadRow> & Record<string, unknown> = {};
  if (typeof patch.pinned === 'boolean') update.pinned = patch.pinned;
  if (typeof patch.locked === 'boolean') update.locked = patch.locked;
  if (typeof patch.deleted === 'boolean') update.deleted = patch.deleted;
  if (Object.keys(update).length === 0) {
    throw new CommunityError('No sepidio ningun campo de moderacion (pinned/locked/deleted)', 400);
  }

  const updated = await updateEntity<ThreadRow>('forumThread', threadId, update, INSTANCE);
  if (!updated) throw new CommunityError('Hilo no encontrado', 404);
  return toThread(updated as unknown as ThreadRow);
}

/** Borra logicamente una respuesta (moderacion). No se lista ni aparece en el hilo. */
export async function deletePost(postId: string): Promise<void> {
  const post = await getEntity<PostRow>('forumPost', postId, INSTANCE);
  if (!post) throw new CommunityError('Respuesta no encontrada', 404);
  await updateEntity<PostRow>('forumPost', postId, { deleted: true }, INSTANCE);
  // El contador del hilo tambien baja: si no, el resumen "12 respuestas" miente.
  const thread = await getEntity<ThreadRow>('forumThread', post.threadId, INSTANCE);
  if (thread) {
    await updateEntity<ThreadRow>(
      'forumThread',
      post.threadId,
      { replyCount: Math.max(0, (thread.replyCount ?? 0) - 1) },
      INSTANCE,
    );
  }
}

/** Hilo crudo de la tabla. Lo usa la wiki para saber si una version tiene foro vivo. */
export async function threadCount(versionKey: string): Promise<number> {
  const all = await listEntities<ThreadRow>('forumThread', INSTANCE);
  return all.filter((r) => r.versionKey === versionKey && !r.deleted).length;
}
