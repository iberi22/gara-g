/**
 * src/pages/api/sync/[id].ts — Respaldo cifrado de extremo a extremo (solo texto cifrado).
 *
 * GET    /api/sync/<id>   -> 200 sobre + ETag | 404
 * PUT    /api/sync/<id>   -> 201 (If-None-Match: *) | 200 (If-Match: <etag>) | 412 | 413 | 400
 * DELETE /api/sync/<id>   -> 204 | 404
 *
 * `id` son 32 hex derivados del codigo de respaldo; el objeto R2 es `sync/v1/<id>`.
 * Credencial: `Authorization: Bearer <authToken>`. El servidor guarda solo el SHA-256 del token
 * (customMetadata.authHash) y el sobre cifrado: no puede leer los datos y no hace ningun KDF
 * (Workers Free: 10 ms de CPU). Ruta publica en el middleware: no lee sesion ni cookies, y no
 * registra el cuerpo ni el token. Un token incorrecto y un objeto inexistente dan el MISMO 404.
 *
 * LIMITES DE ABUSO (sin ellos cualquiera crearia objetos de 1 MB bajo ids aleatorios en R2).
 * Tres bindings de Workers Rate Limiting (`ratelimits` en el bundle de deploy, ver
 * packages/app-pwa/scripts/normalize-wrangler-config.mjs; no usan KV, asi que no gastan sus
 * 1 000 escrituras/dia de Workers Free):
 *   - SYNC_RATE_LIMITER : 120 peticiones/min por IP, cualquier metodo           -> 429
 *   - SYNC_CREATE_LIMITER: 3 creaciones/min por IP                              -> 429
 *   - SYNC_UPDATE_LIMITER: 20 actualizaciones/min por id                        -> 429
 * Ademas, crear exige `X-Sync-Pow`: nonce con SHA-256("gara-sync-create:<id>:<nonce>") que empiece
 * por 3 ceros hex (~4 096 hashes en el cliente, 1 hash en el servidor). Falta o es invalido -> 400.
 * Cota de R2 por IP: 3 x 1 MB/min = ~4,3 GB/dia como maximo teorico por IP (en la practica menos:
 * el contador es por ubicacion de Cloudflare y aproximado, no exacto). No hay tope global exacto:
 * contar objetos exigiria un `list` de R2 por creacion. En produccion (ENVIRONMENT=production) un
 * binding ausente cierra la ruta con 503 en vez de dejarla abierta.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isEnvelope, sha256Hex, verifyCreatePow } from '../../../lib/e2ee/crypto';

const ID_RE = /^[0-9a-f]{32}$/;
const MAX_BYTES = 1024 * 1024;

interface SyncEnv {
  SWAL_R2?: R2Bucket;
  ENVIRONMENT?: string;
  SYNC_RATE_LIMITER?: Limiter;
  SYNC_CREATE_LIMITER?: Limiter;
  SYNC_UPDATE_LIMITER?: Limiter;
}

type Limiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };
type LimiterName = 'SYNC_RATE_LIMITER' | 'SYNC_CREATE_LIMITER' | 'SYNC_UPDATE_LIMITER';

const tooMany = () => json({ error: 'Demasiadas peticiones' }, 429, { 'Retry-After': '60' });

/**
 * Consulta un limitador. `null` = pasa; Response = 429, o 503 si falta el binding en produccion
 * (fallar abierto reabriria el abuso de R2).
 */
async function throttle(name: LimiterName, key: string): Promise<Response | null> {
  const e = env as unknown as SyncEnv;
  const limiter = e[name];
  if (!limiter) {
    return e.ENVIRONMENT === 'production' ? json({ error: 'Servicio no disponible' }, 503) : null;
  }
  const { success } = await limiter.limit({ key });
  return success ? null : tooMany();
}

const clientIp = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'unknown';

const BASE_HEADERS = { 'Cache-Control': 'no-store' };

function json(data: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...BASE_HEADERS, ...extra },
  });
}

/** Un solo 404 para "no existe" y "token incorrecto": no hay oraculo de existencia. */
const notFound = () => json({ error: 'No encontrado' }, 404);

function bearer(request: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(request.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

/** Comparacion en tiempo constante de dos hex del mismo largo (SHA-256 -> 64 caracteres). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Valor de ETag / If-Match sin comillas ni prefijo debil. */
function cleanEtag(v: string | null): string | null {
  if (!v) return null;
  return v.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

/** Lee el cuerpo con tope: no confia en content-length (puede faltar o mentir). */
async function readCapped(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function prelude(
  request: Request,
  id: string | undefined,
): Promise<{ r2: R2Bucket; key: string; authHash: string | null } | Response> {
  const e = env as unknown as SyncEnv;
  const limited = await throttle('SYNC_RATE_LIMITER', clientIp(request));
  if (limited) return limited;
  if (!id || !ID_RE.test(id)) return json({ error: 'Id invalido' }, 400);
  if (!e.SWAL_R2) return json({ error: 'Almacenamiento no disponible' }, 503);
  const token = bearer(request);
  return { r2: e.SWAL_R2, key: `sync/v1/${id}`, authHash: token ? await sha256Hex(token) : null };
}

/** Existe y el token coincide con el hash guardado. */
async function authorized(r2: R2Bucket, key: string, authHash: string | null): Promise<R2Object | null> {
  if (!authHash) return null;
  const head = await r2.head(key);
  const stored = head?.customMetadata?.authHash;
  if (!head || !stored || !safeEqual(stored, authHash)) return null;
  return head;
}

export const GET: APIRoute = async ({ request, params }) => {
  const p = await prelude(request, params.id);
  if (p instanceof Response) return p;
  if (!(await authorized(p.r2, p.key, p.authHash))) return notFound();
  const obj = await p.r2.get(p.key);
  if (!obj) return notFound();
  return new Response(await obj.text(), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...BASE_HEADERS, ETag: obj.httpEtag },
  });
};

export const PUT: APIRoute = async ({ request, params }) => {
  const p = await prelude(request, params.id);
  if (p instanceof Response) return p;
  if (!p.authHash) return json({ error: 'Falta la credencial' }, 401);

  const ifNoneMatch = request.headers.get('if-none-match')?.trim();
  const ifMatch = cleanEtag(request.headers.get('if-match'));
  const creating = ifNoneMatch === '*';
  if (!creating && !ifMatch) return json({ error: 'Falta If-None-Match: * o If-Match' }, 428);

  if (creating) {
    const limited = await throttle('SYNC_CREATE_LIMITER', clientIp(request));
    if (limited) return limited;
    const pow = request.headers.get('x-sync-pow') ?? '';
    if (!(await verifyCreatePow(params.id!, pow))) return json({ error: 'Falta la prueba de trabajo' }, 400);
  } else {
    const limited = await throttle('SYNC_UPDATE_LIMITER', params.id!);
    if (limited) return limited;
  }

  // Actualizar exige el token: se comprueba ANTES de leer el cuerpo, para que quien no lo tiene
  // no pueda hacernos leer (y descartar) un megabyte por peticion.
  const current = creating ? null : await authorized(p.r2, p.key, p.authHash);
  if (!creating && !current) return notFound();

  const body = await readCapped(request);
  if (!body) return json({ error: 'El respaldo supera 1 MB' }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ error: 'El cuerpo no es JSON' }, 400);
  }
  if (!isEnvelope(parsed)) return json({ error: 'Formato de respaldo invalido' }, 400);

  const opts = (onlyIf: R2Conditional): R2PutOptions => ({
    onlyIf,
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { authHash: p.authHash! },
  });

  if (creating) {
    // R2 no documenta si `etagDoesNotMatch: '*'` significa "solo si no existe". El head previo da el
    // 412 en el caso normal; el onlyIf cubre la carrera si R2 lo respeta. Solo el dueño del código
    // conoce el id, así que la carrera es entre sus propios dispositivos.
    if (await p.r2.head(p.key)) return json({ error: 'Ya existe un respaldo con ese codigo' }, 412);
    const saved = await p.r2.put(p.key, body, opts({ etagDoesNotMatch: '*' }));
    if (!saved) return json({ error: 'Ya existe un respaldo con ese codigo' }, 412);
    return json({ ok: true }, 201, { ETag: saved.httpEtag });
  }

  // onlyIf de R2: la escritura solo ocurre si el etag sigue siendo el que el cliente vio.
  const saved = await p.r2.put(p.key, body, opts({ etagMatches: ifMatch! }));
  if (!saved) return json({ error: 'El respaldo cambio en otro dispositivo' }, 412);
  return json({ ok: true }, 200, { ETag: saved.httpEtag });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const p = await prelude(request, params.id);
  if (p instanceof Response) return p;
  if (!(await authorized(p.r2, p.key, p.authHash))) return notFound();
  await p.r2.delete(p.key);
  return new Response(null, { status: 204, headers: BASE_HEADERS });
};
