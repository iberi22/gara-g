/**
 * chatClient.ts — Lado navegador del asistente del expediente.
 *
 *  - Carga el texto de los manuales indexados (`/r2/<textKey>`), lo parte por pagina y lo
 *    guarda en memoria: la busqueda de fragmentos corre aqui (ver garage/assistant/store.ts).
 *  - Elige los fragmentos de la pregunta (`pickExcerpts`) para que el asistente local los
 *    cite; el envio a la IA vive en lib/localAi (ya no hay SSE de servidor).
 *  - Guarda la conversacion por vehiculo en localStorage (solo comodidad: si el navegador
 *    la borra, se empieza de cero).
 */
import { chunkManual, manualTitle, retrieve, type ManualChunk } from '../../garage/assistant/manualText';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Fragmentos de manual que se mandaron con esta pregunta (para mostrarlos). */
  sources?: { manual: string; page: number }[];
  model?: string;
  error?: boolean;
}

export interface IndexedManual {
  name: string;
  textKey?: string;
}

const chunkCache = new Map<string, Promise<ManualChunk[]>>();

/** Fragmentos de todos los manuales indexados del vehiculo (cacheados por textKey). */
export async function loadManualChunks(manuals: IndexedManual[], fetcher: typeof fetch = fetch): Promise<ManualChunk[]> {
  const lists = await Promise.all(
    manuals
      .filter((m): m is IndexedManual & { textKey: string } => !!m.textKey)
      .map((m) => {
        let p = chunkCache.get(m.textKey);
        if (!p) {
          p = fetcher(`/r2/${m.textKey.split('/').map(encodeURIComponent).join('/')}`, { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.text() : ''))
            .then((md) => chunkManual(md, manualTitle(m.name)))
            .catch(() => []);
          chunkCache.set(m.textKey, p);
        }
        return p;
      }),
  );
  return lists.flat();
}

/**
 * Fragmentos para la pregunta. Se busca con la pregunta y la anterior del usuario: "¿y el
 * torque?" despues de "kit de arrastre" necesita las dos para encontrar la pagina.
 */
export function pickExcerpts(chunks: ManualChunk[], turns: ChatTurn[], k = 5): ManualChunk[] {
  const users = turns.filter((t) => t.role === 'user').slice(-2).map((t) => t.content);
  if (!users.length) return [];
  const main = retrieve(chunks, users[users.length - 1], k);
  if (main.length >= k || users.length < 2) return main;
  const extra = retrieve(chunks, users.join(' '), k).filter((c) => !main.includes(c));
  return [...main, ...extra].slice(0, k);
}

const storeKey = (vehicleId: string) => `gara:dossier-chat:${vehicleId}`;

export function loadTurns(vehicleId: string): ChatTurn[] {
  try {
    const raw = localStorage.getItem(storeKey(vehicleId));
    const parsed = raw ? (JSON.parse(raw) as ChatTurn[]) : [];
    return Array.isArray(parsed) ? parsed.filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTurns(vehicleId: string, turns: ChatTurn[]): void {
  try {
    localStorage.setItem(storeKey(vehicleId), JSON.stringify(turns.slice(-40)));
  } catch {
    /* almacenamiento bloqueado o lleno: la conversacion vive solo en esta pestana */
  }
}

export function clearTurns(vehicleId: string): void {
  try {
    localStorage.removeItem(storeKey(vehicleId));
  } catch {
    /* nada que borrar */
  }
}

export function finalizeAssistantTurn(content: string, aborted: boolean): Pick<ChatTurn, 'content' | 'error'> {
  if (content.trim()) {
    return { content, error: false };
  }
  if (aborted) {
    return { content: 'Detuviste la respuesta.', error: false };
  }
  return { content: 'No se pudo responder con la IA local.', error: true };
}
