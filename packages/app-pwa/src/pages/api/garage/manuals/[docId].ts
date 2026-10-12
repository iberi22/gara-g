/**
 * POST /api/garage/manuals/:docId — Extrae el texto de un manual (PDF) para el asistente.
 *
 * Lo llama el expediente despues de subir un PDF con kind=manual. Convierte el PDF a
 * markdown con Workers AI y lo deja en R2 junto al PDF (ver src/garage/assistant/store.ts).
 * Requiere permiso de crear documentos; el manual se busca SOLO en el tenant de la sesion.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { indexManual, type MarkdownAi, type R2Like } from '../../../../garage/assistant/store';
import { instanceIdFor } from '../../../../garage/domain/tenant';
import { bad, json } from '../../../../lib/fleetApi';
import { can } from '../../../../lib/rbac';
import { forbidden, getAuthUser, unauthorized } from '../../fleetApi/auth';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, 'document', 'create')) return forbidden(`Rol ${user.role} no puede indexar manuales`);

  const docId = params.docId as string | undefined;
  if (!docId || !/^[A-Za-z0-9_-]{1,80}$/.test(docId)) return bad('Id de manual invalido');

  const bindings = env as unknown as { SWAL_R2?: R2Like; AI?: MarkdownAi };
  if (!bindings.SWAL_R2 || !bindings.AI) return bad('Almacenamiento o IA no disponibles en este entorno', 503);

  const result = await indexManual(instanceIdFor(request, locals), docId, { r2: bindings.SWAL_R2, ai: bindings.AI });
  if (!result.ok) return bad(result.error, result.status);
  return json(result);
};
