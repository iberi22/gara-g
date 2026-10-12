/**
 * rateLimit.ts — Tope de mensajes por autor en la comunidad (foro y wiki).
 *
 * Reglas: 5 mensajes por 10 min y 30 por dia, contados por `authorId` (el HMAC del
 * userId, no el id). Se cuentan los dos al escribir: crear un hilo, responder a uno
 * o editar una seccion de wiki consumen cuota, para que nadie pueda llenar una
 * version de spam cambiando de endpoint.
 *
 * ⚠  LIMITACION CONOCIDA (MVP): el contador vive en la MEMORIA del isolate, asi que
 * es por isolate: con varios isolates la cuota real es N x el tope, y un reinicio
 * la reinicia. Sirve para frenar al usuario que pulsa "enviar" 40 veces, no para
 * un atacante distribuido. En produccion esto debe vivir en KV (contador con TTL
 * del dia) o en un Durable Object con un contador por autor, que es la unica forma
 * de tener un limite global sin carrera entre isolates. Ver docs/garage/ARCHITECTURE.md.
 */

const WINDOW_10MIN_MS = 10 * 60 * 1000;
const WINDOW_1DAY_MS = 24 * 60 * 60 * 1000;
export const RATE_SHORT_LIMIT = 5;
export const RATE_DAILY_LIMIT = 30;

/** Una marca de tiempo por mensaje, recortada a la ventana corta. */
type Window = number[];

/** authorId -> marcas de la ventana de 10 min. */
const shortWindow = new Map<string, Window>();
/** authorId -> marcas de la ventana de un dia. */
const dailyWindow = new Map<string, Window>();

export interface RateVerdict {
  ok: boolean;
  /** Que ventana salto: 'short' (10 min) o 'daily' (un dia). */
  scope?: 'short' | 'daily';
  /** Segundos que faltan para poder volver a escribir. 0 si se puede. */
  retryAfterSec: number;
}

/** Quita las marcas que ya caducaron de la ventana. */
function prune(marks: Window, windowMs: number, now: number): Window {
  const keep = marks.filter((t) => now - t < windowMs);
  marks.length = 0;
  marks.push(...keep);
  return keep;
}

/**
 * Consulta el estado del autor sin consumir cuota. Se llama antes de escribir
 * (para poder devolver 429 sin haber creado nada) y el consumo real ocurre en
 * `consume()`, que solo suma si la peticion va a aceptarse.
 */
export function checkRateLimit(authorId: string, now = Date.now()): RateVerdict {
  const short = prune(shortWindow.get(authorId) ?? [], WINDOW_10MIN_MS, now);
  const day = prune(dailyWindow.get(authorId) ?? [], WINDOW_1DAY_MS, now);
  shortWindow.set(authorId, short);
  dailyWindow.set(authorId, day);

  if (short.length >= RATE_SHORT_LIMIT) {
    return { ok: false, scope: 'short', retryAfterSec: secondsUntil(short, WINDOW_10MIN_MS, now) };
  }
  if (day.length >= RATE_DAILY_LIMIT) {
    return { ok: false, scope: 'daily', retryAfterSec: secondsUntil(day, WINDOW_1DAY_MS, now) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Cuenta un mensaje para el autor. Se llama DESPUES de que la operacion tenga
 * exito (o, si se prefiere fallar antes, se usa el veredicto de `checkRateLimit`):
 * asi una peticion rechazada por validacion de texto no gasta cuota.
 */
export function consumeRateLimit(authorId: string, now = Date.now()): void {
  const short = prune(shortWindow.get(authorId) ?? [], WINDOW_10MIN_MS, now);
  const day = prune(dailyWindow.get(authorId) ?? [], WINDOW_1DAY_MS, now);
  short.push(now);
  day.push(now);
  shortWindow.set(authorId, short);
  dailyWindow.set(authorId, day);
}

/** Combina las dos ventanas en una operacion: mira, y si se puede, consume. */
export function hitRateLimit(authorId: string, now = Date.now()): RateVerdict {
  const verdict = checkRateLimit(authorId, now);
  if (verdict.ok) consumeRateLimit(authorId, now);
  return verdict;
}

/** Segundos (mínimo 1) hasta que caduque la marca mas antigua de la ventana. */
function secondsUntil(marks: Window, windowMs: number, now: number): number {
  if (marks.length === 0) return 1;
  const oldest = Math.min(...marks);
  const remaining = windowMs - (now - oldest);
  return Math.max(1, Math.ceil(remaining / 1000));
}

/** Vacia los contadores. Solo para tests: entre pruebas hay que empezar de cero. */
export function resetRateLimits(): void {
  shortWindow.clear();
  dailyWindow.clear();
}
