import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { GET, PUT, DELETE } from '../src/pages/api/sync/[id].js';
import { deriveKeys, encryptEnvelope, solveCreatePow, verifyCreatePow } from '../src/lib/e2ee/crypto';

/**
 * El nonce de la prueba de trabajo es una funcion DETERMINISTA del id (mismo id -> mismo
 * nonce), asi que resolverlo por cada peticion es trabajo repetido: cada resolucion son ~4 096
 * SHA-256. Todos los tests de este fichero siembran las mismas claves, luego el mismo id, y
 * habia ~20 resoluciones por ejecucion. Con la suite completa (12 workers) algun test se pasaba
 * del timeout de 5 s por tiempo de CPU, no por ningun fallo real del handler.
 *
 * Se memoiza por id: el nonce sigue siendo valido y el servidor sigue verificandolo igual.
 */
import { fakeR2 } from './mocks/fake-r2';

const powCache = new Map<string, Promise<string>>();
const powFor = (syncId: string): Promise<string> => {
  let p = powCache.get(syncId);
  if (!p) {
    p = solveCreatePow(syncId);
    powCache.set(syncId, p);
  }
  return p;
};

const envMock = env as unknown as Record<string, unknown>;
const LIMITERS = ['SYNC_RATE_LIMITER', 'SYNC_CREATE_LIMITER', 'SYNC_UPDATE_LIMITER'];
let r2: ReturnType<typeof fakeR2>;
let id: string;
let token: string;
let envelope: string;
let pow: string;

const call = (h: typeof GET, method: string, opts: { id?: string; token?: string | null; headers?: Record<string, string>; body?: BodyInit } = {}) => {
  const useId = opts.id ?? id;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const t = opts.token === undefined ? token : opts.token;
  if (t) headers.authorization = `Bearer ${t}`;
  return h({ request: new Request(`https://x.test/api/sync/${useId}`, { method, headers, body: opts.body }), params: { id: useId } } as any);
};

beforeEach(async () => {
  r2 = fakeR2();
  envMock.SWAL_R2 = r2;
  for (const n of LIMITERS) delete envMock[n];
  delete envMock.ENVIRONMENT;
  const k = await deriveKeys(new Uint8Array(16).fill(7));
  id = k.syncId;
  token = k.authToken;
  pow = await powFor(id);
  envelope = JSON.stringify(await encryptEnvelope(k.encKey, k.syncId, '{"hola":1}'));
});

const create = async () =>
  call(PUT, 'PUT', { headers: { 'if-none-match': '*', 'x-sync-pow': pow }, body: envelope });

describe('/api/sync/[id]', () => {
  it('crea (201), 412 al recrear, y GET devuelve el sobre con ETag y no-store', async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await create()).status).toBe(412);
    const g = await call(GET, 'GET');
    expect(g.status).toBe(200);
    expect(g.headers.get('cache-control')).toBe('no-store');
    expect(g.headers.get('etag')).toBe(r.headers.get('etag'));
    expect(await g.text()).toBe(envelope);
  });

  it('solo guarda el hash del token, no el token', async () => {
    await create();
    const meta = r2.store.get(`sync/v1/${id}`)!.meta;
    expect(meta.authHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(meta)).not.toContain(token);
  });

  it('actualiza con If-Match; un etag viejo da 412', async () => {
    const etag1 = (await create()).headers.get('etag')!;
    const u = await call(PUT, 'PUT', { headers: { 'if-match': etag1 }, body: envelope });
    expect(u.status).toBe(200);
    const etag2 = u.headers.get('etag')!;
    expect(etag2).not.toBe(etag1);
    const stale = await call(PUT, 'PUT', { headers: { 'if-match': etag1 }, body: envelope });
    expect(stale.status).toBe(412);
    expect((await call(PUT, 'PUT', { headers: { 'if-match': etag2 }, body: envelope })).status).toBe(200);
  });

  it('un PUT sin condicional da 428', async () => {
    await create();
    expect((await call(PUT, 'PUT', { body: envelope })).status).toBe(428);
  });

  it('token incorrecto o ausente: el mismo 404 que un objeto inexistente (GET, PUT, DELETE)', async () => {
    const etag = (await create()).headers.get('etag')!;
    const bad = 'A'.repeat(43);
    const missing = await call(GET, 'GET', { id: 'f'.repeat(32) });
    const missingBody = await missing.text();
    for (const t of [bad, null]) {
      const g = await call(GET, 'GET', { token: t });
      expect(g.status).toBe(404);
      expect(await g.text()).toBe(missingBody);
    }
    expect((await call(PUT, 'PUT', { token: bad, headers: { 'if-match': etag }, body: envelope })).status).toBe(404);
    expect((await call(DELETE, 'DELETE', { token: bad })).status).toBe(404);
    expect(r2.store.has(`sync/v1/${id}`)).toBe(true); // nada se borro ni se pisó
    expect(missing.status).toBe(404);
  });

  it('DELETE con el token correcto: 204 y luego 404', async () => {
    await create();
    expect((await call(DELETE, 'DELETE')).status).toBe(204);
    expect((await call(GET, 'GET')).status).toBe(404);
  });

  it('id invalido: 400', async () => {
    for (const bad of ['abc', 'G'.repeat(32), 'A'.repeat(32), '../etc/passwd', 'a'.repeat(33)]) {
      expect((await call(GET, 'GET', { id: bad })).status).toBe(400);
    }
    expect(r2.store.size).toBe(0);
  });

  it('413 por tamaño (declarado y real) y 400 por forma', async () => {
    const big = JSON.stringify({ v: 1, alg: 'A256GCM', iv: 'A'.repeat(16), ct: 'A'.repeat(1024 * 1024 + 10) });
    const bigPow = await powFor(id);
    expect((await call(PUT, 'PUT', { headers: { 'if-none-match': '*', 'x-sync-pow': bigPow }, body: big })).status).toBe(413);
    // sin content-length confiable: stream
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const req = new Request(`https://x.test/api/sync/${id}`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'if-none-match': '*', 'x-sync-pow': await powFor(id) }, body: stream, duplex: 'half',
    } as any);
    expect((await PUT({ request: req, params: { id } } as any)).status).toBe(413);
    for (const bad of ['no json', '{}', '[]', JSON.stringify({ v: 1, alg: 'A256GCM', iv: 'x', ct: 'y' }), JSON.stringify({ v: 1, alg: 'A256GCM', iv: 'A'.repeat(16), ct: 'A'.repeat(30), z: 'br' })]) {
      expect((await call(PUT, 'PUT', { headers: { 'if-none-match': '*', 'x-sync-pow': pow }, body: bad })).status).toBe(400);
    }
    expect(r2.store.size).toBe(0);
  });

  it('un PUT de actualizacion con token incorrecto da 404 sin leer el cuerpo', async () => {
    expect((await create()).status).toBe(201);
    const etag = (await call(GET, 'GET')).headers.get('etag')!;
    let pulled = false;
    const stream = new ReadableStream({ pull(c) { pulled = true; c.enqueue(new Uint8Array(1024)); c.close(); } }, { highWaterMark: 0 });
    const req = new Request(`https://x.test/api/sync/${id}`, {
      method: 'PUT', headers: { authorization: 'Bearer ' + 'A'.repeat(43), 'if-match': etag }, body: stream, duplex: 'half',
    } as any);
    expect((await PUT({ request: req, params: { id } } as any)).status).toBe(404);
    expect(pulled).toBe(false);
  });

  const deny = () => ({ limit: async () => ({ success: false }) });
  const allow = () => ({ limit: async () => ({ success: true }) });

  it('rate limiter general: 429 si el binding lo niega; sin binding (no produccion) sigue', async () => {
    envMock.SYNC_RATE_LIMITER = deny();
    expect((await create()).status).toBe(429);
    delete envMock.SYNC_RATE_LIMITER;
    expect((await create()).status).toBe(201);
  });

  it('429 con forma estable: JSON, Retry-After y no-store, y no escribe en R2', async () => {
    envMock.SYNC_CREATE_LIMITER = deny();
    const r = await create();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.json()).toEqual({ error: 'Demasiadas peticiones' });
    expect(r2.store.size).toBe(0);
  });

  it('crear: el limitador va por IP (cf-connecting-ip); la 4a creacion de una IP da 429', async () => {
    const seen: string[] = [];
    let n = 0;
    envMock.SYNC_CREATE_LIMITER = { limit: async ({ key }: { key: string }) => { seen.push(key); return { success: ++n <= 3 }; } };
    const ipPow = await powFor(id);
    const mk = (ip: string) => call(PUT, 'PUT', { headers: { 'if-none-match': '*', 'x-sync-pow': ipPow, 'cf-connecting-ip': ip }, body: envelope });
    expect((await mk('1.2.3.4')).status).toBe(201);
    r2.store.clear();
    expect((await mk('1.2.3.4')).status).toBe(201);
    r2.store.clear();
    expect((await mk('1.2.3.4')).status).toBe(201);
    r2.store.clear();
    expect((await mk('1.2.3.4')).status).toBe(429);
    expect(seen).toEqual(['1.2.3.4', '1.2.3.4', '1.2.3.4', '1.2.3.4']);
    expect(r2.store.size).toBe(0);
  });

  it('actualizar: el limitador va por id; 429 antes de tocar R2; no afecta a la creacion', async () => {
    const etag = (await create()).headers.get('etag')!;
    const keys: string[] = [];
    envMock.SYNC_UPDATE_LIMITER = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } };
    envMock.SYNC_CREATE_LIMITER = deny(); // no debe consultarse al actualizar
    const u = await call(PUT, 'PUT', { headers: { 'if-match': etag }, body: envelope });
    expect(u.status).toBe(429);
    expect(keys).toEqual([id]);
    expect((await call(GET, 'GET')).headers.get('etag')).toBe(etag);
  });

  it('crear sin prueba de trabajo, o con una invalida: 400 y R2 intacto', async () => {
    for (const pow of [undefined, '', 'zzzz', '../x']) {
      const headers: Record<string, string> = { 'if-none-match': '*' };
      if (pow !== undefined) headers['x-sync-pow'] = pow;
      const r = await call(PUT, 'PUT', { headers, body: envelope });
      expect(r.status).toBe(400);
    }
    // un nonce valido para otro id no sirve
    const other = await powFor('f'.repeat(32));
    expect(await verifyCreatePow(id, other) && await verifyCreatePow('f'.repeat(32), other)).toBe(false);
    expect(r2.store.size).toBe(0);
  });

  it('produccion con un limitador ausente: 503 (falla cerrado), con todos presentes sigue', async () => {
    envMock.ENVIRONMENT = 'production';
    expect((await call(GET, 'GET')).status).toBe(503);
    for (const n of LIMITERS) envMock[n] = allow();
    expect((await create()).status).toBe(201);
    delete envMock.SYNC_UPDATE_LIMITER;
    const etag = (await call(GET, 'GET')).headers.get('etag')!;
    expect((await call(PUT, 'PUT', { headers: { 'if-match': etag }, body: envelope })).status).toBe(503);
  });

  it('dos escrituras con el mismo etag: solo una gana', async () => {
    const etag = (await create()).headers.get('etag')!;
    const [a, b] = await Promise.all([
      call(PUT, 'PUT', { headers: { 'if-match': etag }, body: envelope }),
      call(PUT, 'PUT', { headers: { 'if-match': etag }, body: envelope }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 412]);
  });
});
