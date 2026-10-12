// notifications.ts — Centro de notificaciones + fan-out de alertas (P1.2, issue #917).
//
// Helpers puros (sin DOM/storage) testeables con vitest. La persistencia usa
// la entity `notification` (whitelisteada en domain.config.ts) vía los helpers
// genéricos de `domain.ts`. El fan-out alert→notification vive en el endpoint
// POST /api/fleet/[entity] (server-side, 1 llamada).

export type NotificationKind =
  | 'alert'
  | 'maintenance'
  | 'system'
  | 'info';

export interface NotificationFields extends Record<string, unknown> {
  userId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  severity?: string;
  readAt?: string | null;
  createdAt?: string;
}

export interface AlertLike {
  id?: string;
  kind?: string;
  severity?: string;
  message?: string;
  vehicleId?: string;
}

/** Construye el payload de notificación a partir de una alerta. Puro. */
export function alertToNotification(
  alert: AlertLike,
  nowISO?: string,
): NotificationFields {
  return {
    kind: 'alert',
    title: `Alerta ${alert.kind ?? 'general'} — severidad ${alert.severity ?? 'info'}`,
    body: alert.message ?? '',
    severity: alert.severity ?? 'info',
    readAt: null,
    createdAt: nowISO ?? new Date().toISOString(),
  };
}

/** Filtra no leídas (readAt nulo/vacío). Puro. */
export function unreadOnly<T extends { readAt?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => !r.readAt);
}

/** Conteo de no leídas. Puro. */
export function unreadCount<T extends { readAt?: unknown }>(rows: T[]): number {
  return unreadOnly(rows).length;
}

/** Ordena por createdAt descendente (más nuevas primero). Puro. */
export function sortNewestFirst<T extends { createdAt?: unknown }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) =>
    String(b.createdAt ?? '') < String(a.createdAt ?? '') ? -1 : 1,
  );
}

/** Marca como leída (retorna copia con readAt). Puro. */
export function markRead<T extends Record<string, unknown>>(
  row: T,
  nowISO?: string,
): T {
  return { ...row, readAt: nowISO ?? new Date().toISOString() };
}
