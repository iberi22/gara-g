import { env } from 'cloudflare:workers';
import { domainConfig } from './domain.config.js';
/**
 * fleetApi.ts — Server-side helpers for fleet CRUD endpoints, plus the shared
 * document-upload contract (R2 key, size limits) used by files.ts and upload.ts.
 * All endpoints read/write via domain.ts (Memory adapter in SSR / IndexedDB in PWA).
 */
import { createEntity, deleteEntity, getEntity, listEntities, updateEntity } from './domain.js';
import { ensureSeedData } from './fleetSeed.js';
import { DEFAULT_INSTANCE_ID } from './xavier.js';
import { STAGING_TENANT, isStaging } from './staging.js';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function bad(message: string, status = 400): Response {
  return json({ error: message }, status);
}

const VALID_ENTITIES = (domainConfig.entities as readonly any[]).map((e) => e.name);

/**
 * Lee ENVIRONMENT del binding de Cloudflare.
 *
 * Se encapsula para que el resto del modulo no dependa de la forma del binding, y
 * para que un fallo al leerlo degrade a comportamiento de desarrollo (fail-open en
 * dev, fail-closed en prod solo cuando ENVIRONMENT === 'production' está presente).
 */
function readEnvironment(): string | undefined {
  try {
    return (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT;
  } catch {
    return undefined;
  }
}

/**
 * Resuelve el instanceId (tenant) desde la SESIÓN, nunca desde la request del cliente.
 *
 * ⚠  Por qué esto importa: en D1 la PK de la tabla `entity` es
 * (instance_id, entity, id), así que el instanceId decide qué filas ve el usuario.
 * Antes se tomaba de `?instanceId=` o de un header: cualquier usuario autenticado
 * cambiaba un parámetro y leía o escribía la flota de otro cliente. `rbac.ts` limita
 * el ROL, nunca el TENANT.
 *
 * Orden de preferencia:
 *   1. `fromSession` — lo inyecta el middleware desde la sesión validada en KV.
 *   2. Sin sesión, fuera de producción: `?instanceId=` / `x-instance-id`, para poder
 *      cambiar de tenant en desarrollo.
 *   3. Sin sesión, en producción: el tenant por defecto. El middleware ya devolvió 401,
 *      así que llegar aquí significa que no hay usuario y no hay nada que leer.
 *
 * ⚠  El header `x-tenant-instance` se acepta SOLO como `fromSession` cuando lo pasa el
 * middleware con la sesión ya validada. Si se leyera directamente de la request, sería
 * otro campo que elige el atacante: por eso aquí no se consulta. Verificado el 2026-09-30.
 */
export function resolveInstanceId(req: Request, fromSession?: string | null): string {
  // El stage nunca resuelve el tenant de otra parte, ni siquiera por la rama de
  // desarrollo de abajo. Es defensa en profundidad: hoy esa rama ya es inalcanzable
  // porque ENVIRONMENT='production' en los DOS Workers (ver src/lib/staging.ts), pero
  // si alguien bajara ENVIRONMENT en el stage para depurar, `?instanceId=` volvería a
  // ser un campo que elige el atacante — contra una D1 compartida con produccion.
  if (isStaging()) return STAGING_TENANT;

  if (fromSession) return fromSession;

  if (readEnvironment() !== 'production') {
    const url = new URL(req.url);
    return (
      url.searchParams.get('instanceId') || req.headers.get('x-instance-id') || DEFAULT_INSTANCE_ID
    );
  }

  // En producción no hay tenant en la sesión: devolver el de la demo en vez de
  // fallar hacía que las escrituras fueran a `demo-flota`, un tenant distinto
  // del real. Datos separados y, con el tiempo, mezclados en los informes.
  throw new Error('Sesion sin instanceId: no se puede resolver el tenant');
}

/** Nombres con los que un cliente puede intentar elegir tenant. */
const CLIENT_TENANT_KEYS = ['instanceId', 'instance_id'] as const;

/**
 * Tenants que el CLIENTE declara en la request: query (`instanceId` / `instance_id`), cabecera
 * `x-instance-id` y, si el cuerpo es JSON o un formulario urlencoded, los mismos campos del
 * cuerpo. El cuerpo se lee de un `clone()`, asi que el endpoint lo sigue pudiendo consumir.
 * Los multipart (subidas de archivos) no se leen: ningun endpoint toma el tenant de ahi.
 */
export async function clientDeclaredTenants(req: Request): Promise<string[]> {
  const found: string[] = [];
  const url = new URL(req.url);
  for (const k of CLIENT_TENANT_KEYS) {
    for (const v of url.searchParams.getAll(k)) found.push(v);
  }
  const header = req.headers.get('x-instance-id');
  if (header !== null) found.push(header);

  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && req.body) {
    const type = (req.headers.get('content-type') ?? '').toLowerCase();
    try {
      if (type.includes('application/json')) {
        const body = (await req.clone().json()) as unknown;
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          for (const k of CLIENT_TENANT_KEYS) {
            const v = (body as Record<string, unknown>)[k];
            if (v !== undefined && v !== null) found.push(String(v));
          }
        }
      } else if (type.includes('application/x-www-form-urlencoded')) {
        const form = new URLSearchParams(await req.clone().text());
        for (const k of CLIENT_TENANT_KEYS) {
          for (const v of form.getAll(k)) found.push(v);
        }
      }
    } catch {
      /* cuerpo ilegible: el endpoint respondera 400 por su cuenta */
    }
  }
  return found;
}

/**
 * ¿El cliente pidio un tenant distinto del de la sesion? El tenant SIEMPRE sale de la sesion
 * (KV SESSION); este control existe para que el intento no pase en silencio sino con 403.
 * Un valor vacio o igual al de la sesion no es un intento.
 */
export async function clientTenantMismatch(
  req: Request,
  sessionInstanceId: string | null | undefined,
): Promise<boolean> {
  const declared = await clientDeclaredTenants(req);
  return declared.some((v) => v !== '' && v !== sessionInstanceId);
}

export async function ensureSeeded(): Promise<void> {
  await ensureSeedData();
}

export function validateEntity(entity: string | null): entity is (typeof VALID_ENTITIES)[number] {
  if (!entity) return false;
  return VALID_ENTITIES.includes(entity as any);
}

export async function handleList(entity: string, instanceId: string): Promise<Response> {
  await ensureSeeded();
  const items = await listEntities(entity as any, instanceId);
  return json({ data: items, total: items.length });
}

export async function handleGet(entity: string, id: string, instanceId: string): Promise<Response> {
  await ensureSeeded();
  const item = await getEntity(entity as any, id, instanceId);
  if (!item) return bad('Not found', 404);
  return json({ data: item });
}

export async function handleCreate(
  entity: string,
  body: any,
  instanceId: string,
): Promise<Response> {
  await ensureSeeded();
  if (!body || typeof body !== 'object') return bad('Invalid body');
  const created = await createEntity(entity as any, body, instanceId);
  return json({ data: created }, 201);
}

export async function handleUpdate(
  entity: string,
  id: string,
  body: any,
  instanceId: string,
): Promise<Response> {
  await ensureSeeded();
  const updated = await updateEntity(entity as any, id, body, instanceId);
  if (!updated) return bad('Not found', 404);
  return json({ data: updated });
}

export async function handleDelete(
  entity: string,
  id: string,
  instanceId: string,
): Promise<Response> {
  await ensureSeeded();
  const ok = await deleteEntity(entity as any, id, instanceId);
  if (!ok) return bad('Not found', 404);
  return json({ ok: true });
}

// ── Contrato de subida de documentos (vault R2) ───────────────────────────────
// Compartido por /api/fleet/files y /api/fleet/upload. Antes cada uno tenía su
// copia y su propia idea de la clave, y por eso una clave escrita por uno la
// negaba el otro: el vault exigía `tenant/...` (pages/r2/[...path].ts) y los dos
// endpoints escribían `entityType/...`, así que toda descarga daba 404.

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const ALLOWED_FILE_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'] as const;

/** 10 MB para fotos; los PDF (manuales de taller) se miden en decenas de MB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 40 * 1024 * 1024;

/** Tope por tipo. Un tipo no permitido usa el tope de imagen: el 415 va después. */
export function maxBytesFor(contentType: string): number {
  return contentType === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}

export function isAllowedFileType(contentType: string): boolean {
  return (ALLOWED_FILE_TYPES as readonly string[]).includes(contentType);
}

/**
 * Valida las tres piezas que van dentro de la clave.
 *
 * No es saneamiento cosmético: `entityType`, `entityId` y `kind` son segmentos
 * de path en R2, así que un `../` dentro de ellos movería el objeto fuera del
 * prefijo del tenant y de la clave que valida pages/r2/[...path].ts.
 */
const ENTITY_TYPE_RE = /^[a-z][a-zA-Z]{1,30}$/;
const KEY_PART_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Devuelve el motivo del rechazo, o null si la clave se puede construir. */
export function keyPartError(entityType: string, entityId: string, kind: string): string | null {
  if (!ENTITY_TYPE_RE.test(entityType)) return `entityType inválido: ${entityType}`;
  if (!KEY_PART_RE.test(entityId)) return `entityId inválido: ${entityId}`;
  if (!KEY_PART_RE.test(kind)) return `kind inválido: ${kind}`;
  return null;
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/**
 * Clave del vault: `{tenant}/{entityType}/{entityId}/{kind}/{ts}-{safeName}`.
 *
 * El tenant va el primero porque es lo que pages/r2/[...path].ts exige antes de
 * servir nada (`key.startsWith(`${tenant}/`)`): sin él, el bucket solo servía a
 * quien acertara la clave, y un tenant authenticado leía los de todos.
 */
export function documentKey(parts: {
  tenant: string;
  entityType: string;
  entityId: string;
  kind: string;
  fileName: string;
  now?: number;
}): string {
  const ts = parts.now ?? Date.now();
  return `${parts.tenant}/${parts.entityType}/${parts.entityId}/${parts.kind}/${ts}-${parts.fileName}`;
}

type FixedLengthStreamCtor = new (
  length: number,
) => { readable: ReadableStream; writable: WritableStream };

/**
 * Cuerpo para `r2.put` sin cargarse el archivo entero en memoria.
 *
 * R2 exige conocer la longitud de antemano cuando el valor es un ReadableStream;
 * de ahí el FixedLengthStream (global de Workers). El bombeo no se espera a mano:
 * `r2.put` es quien va leyendo el stream mientras el archivo entra. Donde no
 * exista ese global (node en los tests) cae a arrayBuffer, que es lo único que
 * hay disponible.
 */
export async function r2PutBody(file: File): Promise<ReadableStream | ArrayBuffer> {
  const Fixed = (globalThis as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream;
  if (typeof Fixed === 'function') {
    const { readable, writable } = new Fixed(file.size);
    void file.stream().pipeTo(writable).catch(() => {
      /* el consumidor abortó el stream: nada que limpiar aquí */
    });
    return readable;
  }
  return file.arrayBuffer();
}

export { VALID_ENTITIES };
