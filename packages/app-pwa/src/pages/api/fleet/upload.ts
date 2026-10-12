/**
 * src/pages/api/fleet/upload.ts — Upload de archivos a R2.
 *
 * POST /api/fleet/upload
 * Body: FormData con:
 *   - file: File (imagen, PDF)
 *   - entityType: 'vehicle' | 'driver' | ...
 *   - entityId: string
 *   - kind: string (e.g., 'photo', 'soat', 'tecno')
 *
 * OPTIONS /api/fleet/upload → CORS preflight
 *
 * R2 key: {tenant}/{entityType}/{entityId}/{kind}/{timestamp}-{safeName}
 * URL: https://domain/r2/{key}
 *
 * El tenant sale de la sesión (`locals.tenant`, validada en middleware.ts), igual
 * que en files.ts: es lo que hace falta para que la clave sea servible por
 * src/pages/r2/[...path].ts, que solo entrega claves con prefijo del tenant.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  documentKey,
  isAllowedFileType,
  keyPartError,
  maxBytesFor,
  r2PutBody,
  safeFileName,
} from '../../../lib/fleetApi.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const tenant = (locals as { tenant?: { instanceId?: string } } | undefined)?.tenant?.instanceId;
    if (!tenant) {
      return jsonResponse({ error: 'No autenticado: sin tenant en la sesión' }, 401);
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const entityType = formData.get('entityType') as string | null;
    const entityId = formData.get('entityId') as string | null;
    const kind = formData.get('kind') as string | null;

    if (!file || !entityType || !entityId || !kind) {
      return jsonResponse({ error: 'Faltan campos requeridos: file, entityType, entityId, kind' }, 400);
    }

    // 10 MB para imágenes, 40 MB para PDF: los manuales de taller no entran en 10.
    const max = maxBytesFor(file.type);
    if (file.size > max) {
      const limitMB = max / 1024 / 1024;
      return jsonResponse({ error: `Máximo ${limitMB}MB, recibido: ${(file.size / 1024 / 1024).toFixed(1)}MB` }, 413);
    }

    if (!isAllowedFileType(file.type)) {
      return jsonResponse({ error: `Tipo no permitido: ${file.type}` }, 415);
    }

    // Van dentro de la clave, así que se validan antes de construirla.
    const keyError = keyPartError(entityType, entityId, kind);
    if (keyError) return jsonResponse({ error: keyError }, 400);

    const safeName = safeFileName(file.name);
    const uploadKey = documentKey({ tenant, entityType, entityId, kind, fileName: safeName });

    const r2 = (env as unknown as { SWAL_R2?: R2Bucket }).SWAL_R2;
    if (!r2) {
      return jsonResponse({ error: 'R2 binding no disponible' }, 503);
    }

    await r2.put(uploadKey, await r2PutBody(file), {
      httpMetadata: {
        contentType: file.type,
        contentDisposition: `inline; filename="${safeName}"`,
      },
      customMetadata: {
        entityType,
        entityId,
        kind,
        originalName: file.name,
        size: String(file.size),
      },
    });

    const domain = (env as unknown as { DOMAIN?: string }).DOMAIN || 'gara-g.swal.network';
    const url = `https://${domain}/r2/${uploadKey}`;

    return jsonResponse({ url, key: uploadKey, size: file.size, type: file.type }, 201);

  } catch (err) {
    console.error('[upload] Error:', err);
    return jsonResponse({ error: 'Error interno al procesar upload' }, 500);
  }
};
