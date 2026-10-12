/**
 * handler.ts — Logica de POST /api/garage/assistant sin dependencias de Astro, para
 * poder probarla con dobles (binding de IA y datos del tenant).
 *
 * Cuerpo: { vehicleId, messages: [{role, content}], excerpts?: [{manual, page, text}] }
 * Respuesta: text/event-stream con eventos `{t}`, `{thinking}`, `{done, model}` o `{error}`.
 *
 * `excerpts` los elige el navegador sobre el texto de los manuales del vehiculo (ver
 * store.ts: el plan gratuito no da CPU para buscar en el servidor). Vienen del cliente,
 * asi que se acotan en numero y tamano; lo peor que puede hacer un usuario es darle a SU
 * asistente un texto falso de SU manual.
 */
import { findModel } from '../../lib/vehicleCatalog';
import type { VehicleDetail } from '../contracts';
import { type AiBinding, runAssistant } from './ai';
import type { ManualChunk } from './manualText';
import { buildSystemPrompt, sanitizeMessages, type TechNote } from './prompt';
import { takeAssistantSlot } from './store';

export const MAX_EXCERPTS = 6;
export const MAX_EXCERPT_CHARS = 1800;

export interface AssistantDeps {
  ai: AiBinding | undefined;
  userId: string;
  loadVehicle(vehicleId: string): Promise<{ detail: VehicleDetail; notes: TechNote[]; notesText: string; manuals: string[] } | null>;
  now?: Date;
}

const jsonError = (status: number, error: string, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'Content-Type': 'application/json', ...extra } });

export function sanitizeExcerpts(raw: unknown): ManualChunk[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualChunk[] = [];
  for (const e of raw.slice(0, MAX_EXCERPTS)) {
    if (!e || typeof e !== 'object') continue;
    const { manual, page, text } = e as { manual?: unknown; page?: unknown; text?: unknown };
    if (typeof text !== 'string' || !text.trim()) continue;
    const p = Number(page);
    out.push({
      manual: typeof manual === 'string' && manual.trim() ? manual.trim().slice(0, 120) : 'Manual',
      page: Number.isInteger(p) && p >= 0 && p < 100_000 ? p : 0,
      text: text.trim().slice(0, MAX_EXCERPT_CHARS),
    });
  }
  return out;
}

export async function handleAssistant(body: unknown, deps: AssistantDeps): Promise<Response> {
  if (!body || typeof body !== 'object') return jsonError(400, 'Cuerpo invalido');
  const b = body as { vehicleId?: unknown; messages?: unknown; excerpts?: unknown };
  if (typeof b.vehicleId !== 'string' || !b.vehicleId) return jsonError(400, 'Falta vehicleId');
  const messages = sanitizeMessages(b.messages);
  if (!messages) return jsonError(400, 'Falta la pregunta');

  if (!deps.ai) return jsonError(503, 'El asistente no esta disponible en este entorno (falta el binding de Workers AI)');

  const slot = takeAssistantSlot(deps.userId, (deps.now ?? new Date()).getTime());
  if (!slot.ok) {
    return jsonError(429, `Hiciste muchas consultas seguidas. Intenta de nuevo en ${slot.retryAfterS} s.`, {
      'Retry-After': String(slot.retryAfterS),
    });
  }

  const loaded = await deps.loadVehicle(b.vehicleId);
  if (!loaded) return jsonError(404, 'Vehiculo no encontrado');

  const { detail } = loaded;
  const system = buildSystemPrompt({
    vehicle: detail.vehicle,
    history: detail.history,
    catalog: findModel(detail.vehicle.make ?? '', detail.vehicle.model ?? ''),
    notes: loaded.notes,
    notesText: loaded.notesText,
    excerpts: sanitizeExcerpts(b.excerpts),
    manuals: loaded.manuals,
    now: deps.now ?? new Date(),
  });

  try {
    const run = await runAssistant(deps.ai, [{ role: 'system', content: system }, ...messages]);
    return new Response(run.stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Assistant-Model': run.model,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[assistant] Workers AI fallo:', msg);
    const quota = /4006|neuron|quota|limit/i.test(msg);
    return jsonError(
      503,
      quota
        ? 'Se agoto la cuota diaria gratuita de IA. Vuelve a intentar manana o activa el plan pago de Workers.'
        : 'El asistente no pudo responder ahora. Intenta de nuevo en un momento.',
    );
  }
}
