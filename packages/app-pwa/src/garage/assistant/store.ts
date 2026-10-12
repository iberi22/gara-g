/**
 * store.ts — Datos del expediente de un vehiculo que no son del garage: manuales (PDF en
 * R2, con su texto extraido) y notas tecnicas que escribe el dueno.
 *
 * Los manuales son filas de la entidad `document` que crea /api/fleet/files con
 * `kind: 'manual'` y `attachedTo: 'vehicle:<id>'`. Al indexarlos se guarda el markdown en
 * R2 junto al PDF (`<fileKey>.md`) y la fila recibe `textKey`, `pages` e `indexedAt`. La
 * busqueda de fragmentos la hace el navegador sobre ese markdown (ver manualText.ts): el
 * plan gratuito de Workers da 10 ms de CPU por peticion y partir un manual de 300 paginas
 * en el servidor no cabe.
 *
 * Todo pasa por el tenant de la sesion. Una clave de R2 que no empiece por `<tenant>/` no
 * se lee ni se escribe aunque la fila exista (defensa en profundidad: es la misma regla
 * que aplica /r2/[...path]).
 */
import { getEntity, listEntities, updateEntity } from '../../lib/domain';
import type { TechNote } from './prompt';

export interface DocumentRow extends Record<string, unknown> {
  id?: string;
  name?: string;
  fileKey?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  kind?: string;
  attachedTo?: string;
  uploadedAt?: string;
  textKey?: string;
  pages?: number;
  textChars?: number;
  indexedAt?: string;
  indexError?: string;
}

export interface ManualInfo {
  id: string;
  name: string;
  fileKey: string;
  fileSize?: number;
  uploadedAt?: string;
  /** Clave del markdown en R2 si ya se indexo. */
  textKey?: string;
  pages?: number;
  indexedAt?: string;
  indexError?: string;
}

/** Lo minimo que se usa de R2 (permite probar con un doble en memoria). */
export interface R2Like {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: string | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

/** Lo minimo que se usa del binding de Workers AI para convertir documentos. */
export interface MarkdownAi {
  toMarkdown(files: { name: string; blob: Blob }[]): Promise<{ name?: string; format?: string; data?: string; error?: string }[]>;
}

export const MANUAL_KINDS = ['manual'] as const;

const ownedKey = (key: string | undefined, tenant: string): key is string => !!key && key.startsWith(`${tenant}/`);

/** Documentos de un vehiculo (cualquier tipo). */
export async function documentsOf(instanceId: string, vehicleId: string): Promise<(DocumentRow & { id: string })[]> {
  const docs = await listEntities<DocumentRow>('document', instanceId);
  return docs.filter((d) => d.attachedTo === `vehicle:${vehicleId}`) as (DocumentRow & { id: string })[];
}

/** Manuales del vehiculo, del mas nuevo al mas viejo. */
export async function manualsOf(instanceId: string, vehicleId: string): Promise<ManualInfo[]> {
  const docs = await documentsOf(instanceId, vehicleId);
  return docs
    .filter((d) => d.kind === 'manual' && ownedKey(d.fileKey, instanceId))
    .map((d) => ({
      id: d.id,
      name: d.name ?? d.fileName ?? 'Manual',
      fileKey: d.fileKey as string,
      fileSize: typeof d.fileSize === 'number' ? d.fileSize : Number(d.fileSize) || undefined,
      uploadedAt: d.uploadedAt,
      textKey: ownedKey(d.textKey, instanceId) ? d.textKey : undefined,
      pages: typeof d.pages === 'number' ? d.pages : undefined,
      indexedAt: d.indexedAt,
      indexError: d.indexError,
    }))
    .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
}

export type IndexResult =
  | { ok: true; textKey: string; pages: number; chars: number }
  | { ok: false; status: number; error: string };

/**
 * Extrae el texto de un manual (PDF en R2) con Workers AI y lo guarda como markdown
 * junto al PDF. Idempotente: indexar dos veces sobrescribe el mismo `.md`.
 */
export async function indexManual(
  instanceId: string,
  docId: string,
  deps: { r2: R2Like; ai: MarkdownAi; now?: Date },
): Promise<IndexResult> {
  const doc = await getEntity<DocumentRow>('document', docId, instanceId);
  if (!doc || doc.kind !== 'manual') return { ok: false, status: 404, error: 'Manual no encontrado' };
  if (!ownedKey(doc.fileKey, instanceId)) return { ok: false, status: 404, error: 'Manual no encontrado' };

  const obj = await deps.r2.get(doc.fileKey);
  if (!obj) return { ok: false, status: 404, error: 'El archivo del manual no esta en el almacenamiento' };
  const type = obj.httpMetadata?.contentType ?? doc.fileType ?? 'application/pdf';
  if (type !== 'application/pdf') return { ok: false, status: 415, error: 'Solo se indexan manuales en PDF' };

  const name = doc.fileName ?? doc.name ?? 'manual.pdf';
  let markdown: string | undefined;
  let failure: string | undefined;
  try {
    const [out] = await deps.ai.toMarkdown([{ name, blob: new Blob([await obj.arrayBuffer()], { type }) }]);
    if (out?.format === 'markdown' && typeof out.data === 'string') markdown = out.data;
    else failure = out?.error ?? 'La conversion no devolvio texto';
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  const content = markdown?.replace(/^[\s\S]*?## Contents/, '').replace(/^###\s+Page\s+\d+\s*$/gm, '') ?? '';
  if (!markdown || !/[A-Za-z0-9]{3,}/.test(content)) {
    const error = failure ?? 'El PDF no tiene texto seleccionable (parece escaneado)';
    await updateEntity<DocumentRow>('document', docId, { indexError: error.slice(0, 300) }, instanceId);
    return { ok: false, status: 422, error };
  }

  const textKey = `${doc.fileKey}.md`;
  await deps.r2.put(textKey, markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
  const pages = (markdown.match(/^###\s+Page\s+\d+\s*$/gm) ?? []).length;
  await updateEntity<DocumentRow>(
    'document',
    docId,
    { textKey, pages, textChars: markdown.length, indexedAt: (deps.now ?? new Date()).toISOString(), indexError: '' },
    instanceId,
  );
  return { ok: true, textKey, pages, chars: markdown.length };
}

// ---------------------------------------------------------------------------
// Notas tecnicas
// ---------------------------------------------------------------------------

export const MAX_NOTES = 60;
export const MAX_NOTE_LABEL = 80;
export const MAX_NOTE_VALUE = 240;
export const MAX_NOTES_TEXT = 8000;

export interface VehicleNotes {
  techNotes: TechNote[];
  techNotesText: string;
}

/** Notas del vehiculo tal como estan guardadas (vacias si nunca se escribieron). */
export function notesOf(vehicle: Record<string, unknown> | null | undefined): VehicleNotes {
  const raw = vehicle?.techNotes;
  const techNotes = Array.isArray(raw)
    ? raw
        .filter((n): n is { label: unknown; value: unknown } => !!n && typeof n === 'object')
        .map((n) => ({ label: String(n.label ?? ''), value: String(n.value ?? '') }))
    : [];
  const text = vehicle?.techNotesText;
  return { techNotes, techNotesText: typeof text === 'string' ? text : '' };
}

/** Valida y limpia las notas que manda el cliente. Devuelve el error o las notas limpias. */
export function parseNotes(body: unknown): { ok: true; notes: VehicleNotes } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo invalido' };
  const b = body as { techNotes?: unknown; techNotesText?: unknown };
  const list = Array.isArray(b.techNotes) ? b.techNotes : [];
  if (list.length > MAX_NOTES) return { ok: false, error: `Maximo ${MAX_NOTES} datos tecnicos` };
  const techNotes: TechNote[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Dato tecnico invalido' };
    const label = String((item as { label?: unknown }).label ?? '').trim();
    const value = String((item as { value?: unknown }).value ?? '').trim();
    if (!label && !value) continue;
    if (!label || !value) return { ok: false, error: 'Cada dato tecnico necesita nombre y valor' };
    if (label.length > MAX_NOTE_LABEL || value.length > MAX_NOTE_VALUE) return { ok: false, error: 'Dato tecnico demasiado largo' };
    techNotes.push({ label, value });
  }
  const techNotesText = typeof b.techNotesText === 'string' ? b.techNotesText.trim() : '';
  if (techNotesText.length > MAX_NOTES_TEXT) return { ok: false, error: `Las notas admiten ${MAX_NOTES_TEXT} caracteres` };
  return { ok: true, notes: { techNotes, techNotesText } };
}

// ---------------------------------------------------------------------------
// Limite de uso del asistente (por usuario, en memoria del isolate)
// ---------------------------------------------------------------------------

export const ASSISTANT_PER_MINUTE = 8;
export const ASSISTANT_PER_DAY = 150;
const hits = new Map<string, number[]>();

/** true si el usuario puede hacer otra consulta ahora (y la registra). */
export function takeAssistantSlot(userId: string, now = Date.now()): { ok: true } | { ok: false; retryAfterS: number } {
  const day = 24 * 3600 * 1000;
  const list = (hits.get(userId) ?? []).filter((t) => now - t < day);
  const lastMinute = list.filter((t) => now - t < 60_000);
  if (lastMinute.length >= ASSISTANT_PER_MINUTE) return { ok: false, retryAfterS: Math.ceil((60_000 - (now - lastMinute[0])) / 1000) };
  if (list.length >= ASSISTANT_PER_DAY) return { ok: false, retryAfterS: Math.ceil((day - (now - list[0])) / 1000) };
  list.push(now);
  hits.set(userId, list);
  return { ok: true };
}

export function resetAssistantSlots(): void {
  hits.clear();
}
