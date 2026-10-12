/**
 * alertLabels.ts — Etiquetas en español de los valores guardados de una alerta.
 *
 * Lo que se guarda (`high`, `speed`, `depot`...) es un identificador estable que usan la API,
 * el CSV de respaldo y los filtros; lo que se muestra va por aquí. Un valor desconocido se
 * devuelve tal cual: mejor ver el identificador que esconder una alerta.
 */

export const SEVERITY_LABELS: Record<string, string> = {
  info: 'Informativa',
  low: 'Baja',
  medium: 'Media',
  warn: 'Advertencia',
  warning: 'Advertencia',
  high: 'Alta',
  critical: 'Crítica',
  danger: 'Peligro',
};

export const ALERT_KIND_LABELS: Record<string, string> = {
  speed: 'Exceso de velocidad',
  geofence: 'Geocerca',
  maintenance: 'Mantenimiento',
  fuel: 'Combustible',
  idle: 'Ralentí excesivo',
  harsh_braking: 'Frenado brusco',
  sos: 'S.O.S.',
  system: 'Sistema',
  engine: 'Motor',
  document: 'Documento',
  driver: 'Conductor',
  alert: 'Alerta',
  general: 'General',
};

export const GEOFENCE_TYPE_LABELS: Record<string, string> = {
  depot: 'Depósito',
  client: 'Cliente',
  service: 'Taller',
  port: 'Puerto',
  workzone: 'Zona de trabajo',
  restricted: 'Zona restringida',
};

export function severityLabel(value: unknown): string {
  const v = String(value ?? '');
  return SEVERITY_LABELS[v] ?? v;
}

export function alertKindLabel(value: unknown): string {
  const v = String(value ?? '');
  return ALERT_KIND_LABELS[v] ?? v;
}

export function geofenceTypeLabel(value: unknown): string {
  const v = String(value ?? '');
  return GEOFENCE_TYPE_LABELS[v] ?? v;
}

/**
 * Título legible de una notificación. Las de alerta se guardan como
 * "Alerta <tipo> — severidad <nivel>" con los valores en bruto: aquí se traducen al mostrarlas.
 * Cualquier otro título se devuelve sin tocar.
 */
export function notificationTitleLabel(title: unknown): string {
  const t = String(title ?? '');
  const m = t.match(/^Alerta (\S+) — severidad (\S+)$/);
  if (!m) return t;
  return `Alerta de ${alertKindLabel(m[1]).toLowerCase()} — severidad ${severityLabel(m[2]).toLowerCase()}`;
}
