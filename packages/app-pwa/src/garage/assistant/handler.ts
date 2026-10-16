/**
 * handler.ts — Composición del asistente del expediente SIN servidor.
 *
 * Antes esta carpeta tenía un `handleAssistant` que corría Workers AI detrás de una ruta de
 * servidor con cuota. Ahora el asistente vive en el navegador: este módulo solo compone el
 * prompt (con los helpers puros de `prompt.ts`) y llama a la IA local (`localChat`), que
 * cae a las reglas deterministas si el navegador no tiene motor.
 *
 * Sigue siendo la única puerta: la interfaz no arma mensajes de sistema a mano.
 */
import type { AiTier, LocalChatMessage, LocalChatOptions, LocalChatResult } from '../../lib/localAi/index';
import { localChat } from '../../lib/localAi/index';
import type { VehicleModel } from '../../lib/vehicleCatalog';
import type { GarageVehicle, HistoryEvent } from '../contracts';
import type { ManualChunk } from './manualText';
import { buildSystemPrompt, sanitizeMessages, type TechNote } from './prompt';

export const MAX_EXCERPTS = 6;
export const MAX_EXCERPT_CHARS = 1800;

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

/** Contexto del vehículo que la interfaz ya tiene en la mano. */
export interface LocalAssistantContext {
  vehicle: GarageVehicle;
  history: HistoryEvent[];
  catalog?: VehicleModel;
  notes?: TechNote[];
  notesText?: string;
  /** Títulos de todos los manuales cargados. */
  manuals: string[];
  /** Fragmentos elegidos en el navegador (ver chatClient.pickExcerpts). */
  excerpts: ManualChunk[];
  now?: Date;
}

export interface LocalAssistantOptions {
  onToken?: (chunk: string) => void;
  /** Limpia el parcial cuando un motor falla a mitad y la cadena sigue con el siguiente. */
  onReset?: () => void;
  signal?: AbortSignal;
  /** Fuerza un nivel de IA local (p. ej. reglas mientras no se acepta la descarga). */
  tier?: AiTier;
  /** Inyectable en tests: por defecto, `localChat` del módulo localAi. */
  chat?: (messages: readonly LocalChatMessage[], options?: LocalChatOptions) => Promise<LocalChatResult>;
}

export interface LocalAssistantResult extends LocalChatResult {
  /** false si los mensajes no terminaban en una pregunta y no se llamó a la IA. */
  asked: boolean;
}

/**
 * Sanea la conversación, arma el prompt de sistema en el dispositivo y responde con la IA
 * local. No lanza: sin pregunta devuelve `asked: false`; si el motor falla, `localChat`
 * cae a las reglas.
 */
export async function runLocalAssistant(
  rawMessages: unknown,
  context: LocalAssistantContext,
  options: LocalAssistantOptions = {},
): Promise<LocalAssistantResult> {
  const messages = sanitizeMessages(rawMessages);
  if (!messages) return { via: 'rules', model: 'reglas-locales', text: '', asked: false };

  const system = buildSystemPrompt({
    vehicle: context.vehicle,
    history: context.history,
    catalog: context.catalog,
    notes: context.notes,
    notesText: context.notesText,
    excerpts: context.excerpts,
    manuals: context.manuals,
    now: context.now ?? new Date(),
  });

  const chat = options.chat ?? localChat;
  const result = await chat(
    [{ role: 'system', content: system }, ...messages],
    {
      excerpts: context.excerpts,
      onToken: options.onToken,
      onReset: options.onReset,
      signal: options.signal,
      tier: options.tier,
    },
  );
  return { ...result, asked: true };
}
