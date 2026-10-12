/**
 * forum.test.ts — Hilos y respuestas por version.
 *
 * Lo que se protege aqui, en orden de importancia:
 *   1. Aislamiento por `versionKey`: dos generaciones del mismo modelo NO comparten
 *      foro. Es la razon de que exista esta isla, y un `listEntities` que olvide el
 *      filtro lo rompe en silencio.
 *   2. Que en la instancia compartida no quede ni userId ni correo.
 *   3. Orden y paginacion: fijados primero, luego actividad, y el cursor no duplica
 *      ni pierde hilos cuando alguien responde entre pagina 1 y pagina 2.
 *   4. Cerrado, moderacion (solo admin, en la ruta) y borrado logico.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMemoryAdapter, listEntities, setStorageAdapter } from '../../lib/domain';
import { COMMUNITY_INSTANCE_ID } from '../../lib/domain.config';
import type { ForumThread } from '../contracts';
import { CommunityError } from './errors';
import {
  createThread,
  deletePost,
  getThread,
  listThreads,
  moderateThread,
  replyToThread,
} from './forum';
import { authorHash, resetCommunitySecretCache } from './identity';

/** Reloj base para los casos que necesitan marcas de tiempo separadas. */
const T0 = 1_700_000_000_000;

const V_A = 'yamaha-fz16-2019-2024';
const V_B = 'yamaha-fz16-2015-2018';

async function hash(userId: string): Promise<string> {
  resetCommunitySecretCache();
  return authorHash(userId);
}

/**
 * Crea un hilo con un autor ya pseudonimizado. Devuelve el hilo entero, porque
 * casi todos los casos necesitan el `id` y algunos miran el `pinned`.
 */
async function hilo(
  versionKey: string,
  title: string,
  userId = 'usr_a',
  tags: string[] = [],
): Promise<ForumThread> {
  return createThread({
    versionKey,
    title,
    body: `Cuerpo de ${title}`,
    tags,
    authorId: await hash(userId),
  });
}

describe('foro por version', () => {
  beforeEach(() => {
    // Si un caso con reloj simulado falla antes de su `useRealTimers()`, el resto
    // correria con el tiempo congelado y las marcas ISO dejarian de avanzar.
    vi.useRealTimers();
    getMemoryAdapter().clear();
    setStorageAdapter(getMemoryAdapter());
  });

  it('crea un hilo con alias y lo guarda en la instancia compartida', async () => {
    const authorId = await hash('usr_a');
    const thread = await createThread({
      versionKey: V_A,
      title: 'Ruido al frenar VERSION',
      body: 'Desde los 40 km/h se escucha un chirrido',
      tags: ['Frenos', 'frenos'],
      authorId,
    });

    expect(thread.versionKey).toBe(V_A);
    expect(thread.title).toBe('Ruido al frenar VERSION');
    expect(thread.authorId).toBe(authorId);
    expect(thread.authorName).toMatch(/^Piloto-/);
    expect(thread.replyCount).toBe(0);
    // Las etiquetas se deduplican por slug.
    expect(thread.tags).toEqual(['frenos']);
    expect(thread.pinned).toBe(false);
    expect(thread.locked).toBe(false);

    // Vive en la instancia compartida, no en la del tenant.
    const rows = await listEntities('forumThread', COMMUNITY_INSTANCE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].instance_id).toBe(COMMUNITY_INSTANCE_ID);
  });

  it('no guarda ni el userId ni el correo en la fila compartida', async () => {
    const authorId = await hash('usr_secreto');
    const thread = await createThread({
      versionKey: V_A,
      title: 'Hilo de verificacion de privacidad',
      body: 'comprobando que no se filtra la identidad',
      authorId,
    });
    const post = await replyToThread(thread.id, {
      body: 'una respuesta cualquiera',
      authorId: await hash('usr_otro'),
    });

    const rows = await listEntities('forumThread', COMMUNITY_INSTANCE_ID);
    const posts = await listEntities('forumPost', COMMUNITY_INSTANCE_ID);
    for (const row of [...rows, ...posts]) {
      const serial = JSON.stringify(row);
      expect(serial).not.toContain('usr_secreto');
      expect(serial).not.toContain('usr_otro');
      expect(serial).not.toContain('@');
      // Y lo que si se guarda es el HMAC y el alias.
      expect(row.authorId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(String(row.authorName)).toMatch(/^Piloto-[a-z0-9]{6}$/);
    }
    expect(post.authorId).not.toBe('usr_otro');
  });

  it('aisla por versionKey: dos generaciones no comparten hilos', async () => {
    await hilo(V_A, 'Hilo de la generacion nueva');
    await hilo(V_B, 'Hilo de la generacion vieja');

    const nueva = await listThreads(V_A);
    const vieja = await listThreads(V_B);
    expect(nueva.threads).toHaveLength(1);
    expect(vieja.threads).toHaveLength(1);
    expect(nueva.threads[0].title).toContain('nueva');
    expect(vieja.threads[0].title).toContain('vieja');
  });

  it('las respuestas tampoco cruzan de version', async () => {
    const idA = (await hilo(V_A, 'Hilo A')).id;
    const idB = (await hilo(V_B, 'Hilo B')).id;
    await replyToThread(idA, { body: 'respuesta solo en A', authorId: await hash('usr_a') });

    const enA = await getThread(idA);
    const enB = await getThread(idB);
    expect(enA.posts).toHaveLength(1);
    expect(enB.posts).toHaveLength(0);
    expect(enA.posts[0].versionKey).toBe(V_A);
  });

  it('responder sube replyCount y lastActivityAt', async () => {
    const id = (await hilo(V_A, 'Hilo con respuestas')).id;
    const antes = await getThread(id);

    await replyToThread(id, { body: 'primera', authorId: await hash('usr_b') });
    await replyToThread(id, { body: 'segunda', authorId: await hash('usr_c') });

    const despues = await getThread(id);
    expect(despues.thread.replyCount).toBe(2);
    expect(despues.posts).toHaveLength(2);
    expect(Date.parse(despues.thread.lastActivityAt)).toBeGreaterThanOrEqual(
      Date.parse(antes.thread.lastActivityAt),
    );
  });

  it('las respuestas salen en orden cronologico (mas antigua primero)', async () => {
    const id = (await hilo(V_A, 'Hilo ordenado')).id;
    for (const texto of ['uno', 'dos', 'tres']) {
      await replyToThread(id, { body: texto, authorId: await hash('usr_a') });
    }
    const { posts } = await getThread(id);
    expect(posts.map((p) => p.body)).toEqual(['uno', 'dos', 'tres']);
  });

  it('ordena: fijados primero, luego por actividad reciente', async () => {
    // Reloj simulado desde antes de crear los hilos y ADVANZADO a mano: dos
    // respuestas en el mismo milisegundo tendrian la misma marca ISO y el orden
    // entre ellas lo decidiria el id (que se genera al crear el hilo, no al
    // responder). La fecha tiene que avanzar, no solo estar separada.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    const viejo = await hilo(V_A, 'Hilo viejo sin actividad');
    vi.setSystemTime(new Date(T0 + 1));
    const medio = await hilo(V_A, 'Hilo medio');
    vi.setSystemTime(new Date(T0 + 2));
    const nuevo = await hilo(V_A, 'Hilo nuevo');
    const fijado = await hilo(V_A, 'Hilo fijado pero inactivo');

    // Orden de actividad estricto: viejo < medio < nuevo < fijado.
    vi.setSystemTime(new Date(T0 + 10));
    await replyToThread(medio.id, { body: 'x', authorId: await hash('usr_a') });
    vi.setSystemTime(new Date(T0 + 20));
    await replyToThread(nuevo.id, { body: 'y', authorId: await hash('usr_a') });
    vi.setSystemTime(new Date(T0 + 30));
    await moderateThread(fijado.id, { pinned: true });
    vi.useRealTimers();

    const { threads } = await listThreads(V_A);
    expect(threads.map((t) => t.id)).toEqual([
      fijado.id, // el pin va primero aunque tenga la actividad mas reciente
      nuevo.id,
      medio.id,
      viejo.id,
    ]);
    // El pin no reordena por `lastActivityAt`: moderar no toca esa marca.
    expect(threads.find((t) => t.id === fijado.id)?.lastActivityAt).toBe(fijado.lastActivityAt);
  });

  it('el orden es estable aunque dos hilos compartan marca de tiempo', async () => {
    // Dos hilos creados en el mismo instante tienen la MISMA `lastActivityAt`. El
    // desempate por id mantiene el orden total entre llamadas, que es lo que hace
    // que la paginacion por cursor no los duplique ni los pierda.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    const a = await hilo(V_A, 'Hilo empatado A');
    const b = await hilo(V_A, 'Hilo empatado B');
    vi.useRealTimers();

    expect(a.lastActivityAt).toBe(b.lastActivityAt);
    const primera = (await listThreads(V_A)).threads.map((t) => t.id);
    const segunda = (await listThreads(V_A)).threads.map((t) => t.id);
    expect(primera).toEqual(segunda);
    expect(primera).toHaveLength(2);
  });

  it('pagina por cursor sin repetir ni perder hilos', async () => {
    // Reloj simulado y avanzado de uno en uno: cinco hilos creados en el mismo
    // milisegundo tendrian la misma `lastActivityAt`, y el cursor (que la lleva) no
    // los distinguiria. Es justo el caso limite que la paginacion debe aguantar.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await hilo(V_A, `Hilo numero ${i} de la lista`)).id);
      // Actividad escalonada para que el orden por fecha sea inequivoco.
      vi.setSystemTime(new Date(T0 + (i + 1) * 1000));
      await replyToThread(ids[i], { body: 'x', authorId: await hash('usr_a') });
    }
    vi.useRealTimers();

    const p1 = await listThreads(V_A, { limit: 2 });
    expect(p1.threads).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await listThreads(V_A, { limit: 2, cursor: p1.nextCursor });
    const p3 = await listThreads(V_A, { limit: 2, cursor: p2.nextCursor });

    const vistos = [...p1.threads, ...p2.threads, ...p3.threads].map((t) => t.id);
    expect(vistos).toHaveLength(5);
    expect(new Set(vistos).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
    // Mas reciente primero.
    expect(vistos).toEqual([...ids].reverse());
  });

  it('la paginacion aguanta hilos con la misma marca de tiempo', async () => {
    // Los cinco hilos comparten `lastActivityAt`: el cursor se apoya en la marca, asi
    // que sin un desempate TOTAL la pagina 2 devolveria los mismos o se saltaria uno.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await hilo(V_A, `Hilo empatado ${i}`)).id);
    vi.useRealTimers();

    const vistos: string[] = [];
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 5; pagina++) {
      const res = await listThreads(V_A, { limit: 2, cursor });
      vistos.push(...res.threads.map((t) => t.id));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(vistos).toHaveLength(5);
    expect(new Set(vistos).size).toBe(5);
    expect(new Set(vistos)).toEqual(new Set(ids));
  });

  it('un cursor invalido se ignora en vez de romper la lista', async () => {
    await hilo(V_A, 'Un solo hilo en la lista');
    const { threads } = await listThreads(V_A, { cursor: 'no-es-un-cursor' });
    expect(threads).toHaveLength(1);
  });

  it('un hilo locked no admite respuestas (409)', async () => {
    const id = (await hilo(V_A, 'Hilo cerrado por moderacion')).id;
    await moderateThread(id, { locked: true });

    await expect(
      replyToThread(id, { body: 'una mas', authorId: await hash('usr_a') }),
    ).rejects.toMatchObject({
      status: 409,
    });
    // El contador no se movio por el intento rechazado.
    expect((await getThread(id)).thread.replyCount).toBe(0);
  });

  it('moderacion: fija, cierra y borra logicamente', async () => {
    const id = (await hilo(V_A, 'Hilo que se va a moderar')).id;
    expect((await moderateThread(id, { pinned: true })).pinned).toBe(true);
    expect((await moderateThread(id, { locked: true })).locked).toBe(true);
    expect((await moderateThread(id, { pinned: false })).pinned).toBe(false);

    await moderateThread(id, { deleted: true });
    // Ni se lista ni se lee, pero la fila sigue existiendo (borrado logico).
    expect((await listThreads(V_A)).threads).toHaveLength(0);
    await expect(getThread(id)).rejects.toMatchObject({ status: 404 });
    const filas = await listEntities('forumThread', COMMUNITY_INSTANCE_ID);
    expect(filas).toHaveLength(1);
    expect(filas[0].deleted).toBe(true);
  });

  it('borrar una respuesta la saca del hilo y baja el contador', async () => {
    const id = (await hilo(V_A, 'Hilo con una respuesta que se va')).id;
    const post = await replyToThread(id, {
      body: 'respuesta naughty',
      authorId: await hash('usr_a'),
    });
    await replyToThread(id, { body: 'otra que se queda', authorId: await hash('usr_a') });

    await deletePost(post.id);

    const { thread, posts } = await getThread(id);
    expect(posts.map((p) => p.body)).toEqual(['otra que se queda']);
    expect(thread.replyCount).toBe(1);
  });

  it('moderar sin campos es 400 (no un PATCH vacio que hace nada)', async () => {
    const id = (await hilo(V_A, 'Hilo sin cambios')).id;
    await expect(moderateThread(id, {})).rejects.toMatchObject({ status: 400 });
  });

  it('rechaza titulo o cuerpo fuera de los limites antes de guardar', async () => {
    const authorId = await hash('usr_a');
    await expect(
      createThread({ versionKey: V_A, title: 'ok', body: 'cuerpo', authorId }),
    ).rejects.toBeInstanceOf(CommunityError);
    await expect(
      createThread({ versionKey: V_A, title: 'a'.repeat(200), body: 'cuerpo', authorId }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await listEntities('forumThread', COMMUNITY_INSTANCE_ID)).toHaveLength(0);
  });

  it('responder a un hilo inexistente es 404', async () => {
    await expect(
      replyToThread('no-existe', { body: 'hola', authorId: await hash('usr_a') }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
