/**
 * src/pages/api/fleet/files.ts — Gestión de archivos asociados a entidades.
 *
 * GET    /api/fleet/files?entityType=vehicle&entityId=xxx → lista archivos
 * POST   /api/fleet/files (multipart)                     → upload a R2
 * DELETE /api/fleet/files?key=xxx                         → borra de R2
 *
 * Clave en R2: {tenant}/{entityType}/{entityId}/{kind}/{ts}-{safeName}. El
 * tenant va el primero porque es lo que src/pages/r2/[...path].ts exige antes de
 * servir un byte; sin él, todo lo subido era indistinguible de un 404.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listEntities, createEntity, deleteEntity } from '../../../lib/domain.js';
import {
  documentKey,
  isAllowedFileType,
  keyPartError,
  maxBytesFor,
  r2PutBody,
  safeFileName,
} from '../../../lib/fleetApi.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

/**
 * Tenant de la peticion, derivado de la sesion.
 *
 * Este archivo es la excepcion que rompia el aislamiento multi-tenant: sus cinco
 * puntos (listar, crear, borrar x2, reemplazar) tenian 'demo-flota' hardcodeado. El
 * resto de la API resuelve el tenant igual que aqui, desde la sesion via
 * `resolveInstanceId`, de modo que un cliente real no sube, ve ni borra documentos
 * en el tenant de otro.
 */
const tenantOf = (ctx: { request: Request; locals?: any }): string | null =>
  ctx.locals?.tenant?.instanceId ?? null;

const NO_TENANT = () =>
  json({ error: 'No autenticado: sin tenant en la sesión' }, 401);

/**
 * ¿Este documento está adjunto a la entidad que pide la request?
 *
 * Antes el DELETE borraba por `fileKey` sin mirar a qué vehículo iba el documento:
 * bastaba con conocer una clave ajena para borrar el documento de otro. Aqui se
 * exige que `attachedTo` coincida con `entityType:entityId`.
 */
const belongsTo = (doc: any, entityType: string, entityId: string): boolean => {
  const attached = doc?.attachedTo ?? doc?.attached_to;
  if (!attached) return false;
  if (typeof attached === 'string') return attached === `${entityType}:${entityId}`;
  return attached.entityType === entityType && attached.entityId === entityId;
};

/**
 * ¿La clave cae dentro del prefijo del tenant de la sesión?
 *
 * Defensa en profundidad del borrado: `listEntities` ya limita por tenant y
 * `belongsTo` exige la entidad, pero `key` lo pone el cliente y va directo a
 * `r2.delete(key)`. Una clave fuera del prefijo no puede ser nuestra (las que se
 * escriben lo llevan), así que se responde 404 y no se toca R2.
 */
const inTenant = (tenant: string, key: string): boolean => key.startsWith(`${tenant}/`);

// GET /api/fleet/files?entityType=vehicle&entityId=xxx
export const GET: APIRoute = async (ctx) => {
  const { url } = ctx;
  const tenant = tenantOf(ctx);
  if (!tenant) return NO_TENANT();
  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');
  if (!entityType || !entityId) {
    return json({ error: 'Faltan: entityType, entityId' }, 400);
  }
  try {
    const all = await listEntities('document', tenant).catch(() => []);
    const files = all
      .filter((d: any) => {
        const attached = d.attachedTo ?? d.attached_to;
        if (!attached) return false;
        if (typeof attached === 'string') return attached === `${entityType}:${entityId}`;
        return attached.entityType === entityType && attached.entityId === entityId;
      })
      .map((d: any) => ({
        id: d.id,
        key: d.fileKey ?? d.r2Key ?? d.url,
        name: d.name ?? d.fileName,
        type: d.fileType ?? d.mimeType,
        size: d.fileSize ?? d.size,
        kind: d.kind ?? 'document',
        uploadedAt: d.uploadedAt ?? d.createdAt ?? d.updated_at,
      }));
    return json({ files });
  } catch (e) {
    console.error('[files] GET error:', e);
    return json({ error: 'Error al listar archivos' }, 500);
  }
};

// ── Upload helper ──────────────────────────────────────────────────────────────

async function doUpload(
  formData: FormData,
  request: Request,
  tenant: string,
): Promise<Response> {
  const file = formData.get('file') as File | null;
  const entityType = formData.get('entityType') as string | null;
  const entityId = formData.get('entityId') as string | null;
  const kind = (formData.get('kind') as string | null) ?? 'document';
  const redirectTo = formData.get('_redirect') as string | null;

  const isForm = request.headers.get('content-type')?.includes('multipart/form-data') ?? false;

  const okRedirect = (key: string) => {
    if (isForm && redirectTo) {
      const sep = redirectTo.includes('?') ? '&' : '?';
      return new Response(null, { status: 303, headers: { Location: `${redirectTo}${sep}uploaded=${encodeURIComponent(key)}` } });
    }
    const domain = (env as any).DOMAIN || 'gara-g.swal.network';
    return json({ key, url: `https://${domain}/r2/${key}`, size: (file as File).size, type: (file as File).type }, 201);
  };

  const errRedirect = (msg: string, code: number) => {
    if (isForm && redirectTo) {
      const sep = redirectTo.includes('?') ? '&' : '?';
      return new Response(null, { status: 303, headers: { Location: `${redirectTo}${sep}error=${encodeURIComponent(msg)}` } });
    }
    return json({ error: msg }, code);
  };

  if (!file || !entityType || !entityId) {
    return errRedirect('Faltan: file, entityType, entityId', 400);
  }

  // El tope depende del tipo: 10 MB para fotos, 40 MB para PDF. El manual de
  // taller de un camión no cabe en 10 MB, y el 413 debe decir cuál era el tope.
  const max = maxBytesFor(file.type);
  if (file.size > max) {
    const limitMB = max / 1024 / 1024;
    return errRedirect(`Máx ${limitMB}MB, recibido ${(file.size / 1024 / 1024).toFixed(1)}MB`, 413);
  }

  if (!isAllowedFileType(file.type)) {
    return errRedirect(`Tipo no permitido: ${file.type}`, 415);
  }

  // Las tres piezas son segmentos de la clave: sin validarlas, un `../` sacaba
  // el objeto del prefijo del tenant y de la comprobación del vault.
  const keyError = keyPartError(entityType, entityId, kind);
  if (keyError) return errRedirect(keyError, 400);

  const safeName = safeFileName(file.name);
  const key = documentKey({ tenant, entityType, entityId, kind, fileName: safeName });

  const r2 = (env as unknown as { SWAL_R2?: R2Bucket }).SWAL_R2;
  if (!r2) return errRedirect('R2 unavailable', 503);

  await r2.put(key, await r2PutBody(file), {
    httpMetadata: {
      contentType: file.type,
      contentDisposition: `inline; filename="${safeName}"`,
    },
    customMetadata: { entityType, entityId, kind, originalName: file.name, size: String(file.size) },
  });

  await createEntity('document', ({
    name: file.name,
    fileKey: key,
    fileName: safeName,
    fileType: file.type,
    fileSize: file.size,
    kind,
    attachedTo: `${entityType}:${entityId}`,
    uploadedAt: new Date().toISOString(),
  }) as Record<string, unknown>, tenant).catch((e) => console.error('[files] createEntity failed:', e));

  return okRedirect(key);
}

// ── POST: handles both file upload and _method=DELETE from HTML forms ─────────

export const POST: APIRoute = async (ctx) => {
  const { request, url } = ctx;
  const tenant = tenantOf(ctx);
  if (!tenant) return NO_TENANT();
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Invalid form data' }, 400);
  }

  // HTML form delete button: POST _method=DELETE key=... _redirect=...
  if (formData.get('_method') === 'DELETE') {
    const key = url.searchParams.get('key') || (formData.get('key') as string | null);
    if (!key) return json({ error: 'Falta: key' }, 400);
    if (!inTenant(tenant, key)) return json({ error: 'Documento no encontrado' }, 404);
    const redirectTo = formData.get('_redirect') as string | null;
    const entityType = url.searchParams.get('entityType') ?? (formData.get('entityType') as string | null) ?? '';
    const entityId = url.searchParams.get('entityId') ?? (formData.get('entityId') as string | null) ?? '';
    const doRedirect = (loc: string) =>
      new Response(null, { status: 303, headers: { Location: loc } });
    try {
      const r2 = (env as unknown as { SWAL_R2?: R2Bucket }).SWAL_R2;
      if (!r2) {
        if (redirectTo) return doRedirect(`${redirectTo}?error=R2+unavailable`);
        return json({ error: 'R2 unavailable' }, 503);
      }
      const all = await listEntities('document', tenant).catch(() => []);
      const doc = all.find((d: any) => (d.fileKey ?? d.r2Key ?? d.url) === key);
      if (!doc) return json({ error: 'Documento no encontrado' }, 404);
      if (entityType && entityId && !belongsTo(doc, entityType, entityId)) {
        return json({ error: 'El documento no pertenece a esa entidad' }, 403);
      }
      await r2.delete(key);
      await deleteEntity('document', doc.id as string, tenant).catch(() => {});
      if (redirectTo) return doRedirect(`${redirectTo}?deleted=1`);
      return json({ ok: true, deleted: key });
    } catch (e) {
      console.error('[files] DELETE (POST) error:', e);
      if (redirectTo) return doRedirect(`${redirectTo}?error=Delete+failed`);
      return json({ error: 'Error al borrar archivo' }, 500);
    }
  }

  return doUpload(formData, request, tenant);
};

// DELETE /api/fleet/files?key=xxx
export const DELETE: APIRoute = async (ctx) => {
  const { url, request } = ctx;
  const tenant = tenantOf(ctx);
  if (!tenant) return NO_TENANT();
  const entityType = url.searchParams.get('entityType') ?? '';
  const entityId = url.searchParams.get('entityId') ?? '';
  let key = url.searchParams.get('key');
  let redirectTo: string | null = null;

  // Form-encoded delete via HTML form
  if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
    const fd = await request.formData();
    key = (fd.get('key') as string) || key;
    redirectTo = (fd.get('_redirect') as string) || null;
  }

  if (!key) return json({ error: 'Falta: key' }, 400);
  if (!inTenant(tenant, key)) return json({ error: 'Documento no encontrado' }, 404);

  const doRedirect = (loc: string) =>
    new Response(null, { status: 303, headers: { Location: loc } });

  try {
    const r2 = (env as unknown as { SWAL_R2?: R2Bucket }).SWAL_R2;
    if (!r2) {
      if (redirectTo) return doRedirect(`${redirectTo}?error=R2+unavailable`);
      return json({ error: 'R2 unavailable' }, 503);
    }
    const all = await listEntities('document', tenant).catch(() => []);
    const doc = all.find((d: any) => (d.fileKey ?? d.r2Key ?? d.url) === key);
    if (!doc) return json({ error: 'Documento no encontrado' }, 404);
    if (entityType && entityId && !belongsTo(doc, entityType, entityId)) {
      return json({ error: 'El documento no pertenece a esa entidad' }, 403);
    }
    await r2.delete(key);
    await deleteEntity('document', doc.id, tenant).catch(() => {});
    if (redirectTo) return doRedirect(`${redirectTo}?deleted=1`);
    return json({ ok: true, deleted: key });
  } catch (e) {
    console.error('[files] DELETE error:', e);
    if (redirectTo) return doRedirect(`${redirectTo}?error=Delete+failed`);
    return json({ error: 'Error al borrar archivo' }, 500);
  }
};
