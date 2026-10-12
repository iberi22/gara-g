/**
 * statusRow.ts — Hechos resumidos de la fila de estado que va bajo el vehiculo.
 *
 * En el lenguaje del configurador de referencia esa fila es una tira de datos cortos
 * precedidos de un punto naranja ("Ride height +55 mm", "Cannons Safed"). Aqui se arma
 * con lo que el dominio ya calcula: piezas vencidas, documentos proximos, estado del
 * enlace APK, odometro y el modo 3D activo. Es logica pura (sin DOM) para poder testearla.
 */
import type { Commitment, GarageVehicle, MonitoringState, ViewMode } from '../../garage/contracts';
import { formatTimeAgo } from './formatters';

/** Un hecho de la fila: etiqueta corta (ya en mayusculas) y valor. */
export interface StatusFact {
  id: string;
  label: string;
  value: string;
  /** Un hecho en rojo se marca como urgente (vencido). */
  urgent?: boolean;
  /** Un hecho apagado es informativo sin alerta (ej. "APK SIN SEÑAL"). */
  muted?: boolean;
}

const MAX_FACTS = 6;

function viewModeLabel(mode: ViewMode): string {
  switch (mode) {
    case 'health':
      return 'MODO SALUD';
    case 'xray':
      return 'MODO RAYOS X';
    default:
      return 'MODO ESTETICO';
  }
}

/**
 * Resumen de 4 a 6 hechos. El orden es fijo para que la fila no "salte" al cambiar de
 * vehiculo: alertas primero (lo que exige accion), luego documentos, enlace y datos.
 */
export function buildStatusFacts(
  vehicle: GarageVehicle,
  opts: { monitoring?: MonitoringState | null; viewMode?: ViewMode; max?: number } = {},
): StatusFact[] {
  const { monitoring, viewMode = 'beauty', max = MAX_FACTS } = opts;
  const facts: StatusFact[] = [];

  // 1. Piezas vencidas (compromisos overdue) — el dato que mas importa.
  const overdue = (vehicle.commitments ?? []).filter(
    (c: Commitment) => c.status !== 'done' && c.urgency === 'overdue',
  );
  for (const c of overdue) {
    facts.push({ id: `overdue-${c.id}`, label: shortLabel(c.title), value: 'VENCIDO', urgent: true });
  }

  // 2. Documento o compromiso mas proximo (SOAT,Revision, etc.).
  const next = (vehicle.commitments ?? [])
    .filter((c) => c.status !== 'done' && c.urgency !== 'overdue')
    .sort((a, b) => (a.remainingDays ?? 999) - (b.remainingDays ?? 999))[0];
  if (next) {
    const days = next.remainingDays;
    const value =
      days === undefined
        ? 'PENDIENTE'
        : days <= 0
          ? 'VENCIDO'
          : days === 1
            ? '1 DÍA'
            : `${days} DÍAS`;
    facts.push({
      id: `next-${next.id}`,
      label: shortLabel(next.title),
      value,
      urgent: days !== undefined && days <= 0,
    });
  }

  // 3. Enlace APK / OBD.
  const latest = monitoring?.latest;
  facts.push({
    id: 'link',
    label: 'APK',
    value: monitoring?.connected ? 'EN LÍNEA' : latest || monitoring?.lastSeen ? 'SIN SEÑAL' : 'SIN DATOS',
    muted: !(monitoring?.connected ?? false),
  });

  // 4. Odometro.
  if (vehicle.odometerKm !== undefined && vehicle.odometerKm !== null) {
    facts.push({ id: 'odo', label: vehicle.usageUnit === 'h' ? 'HORAS' : 'KM', value: Math.round(vehicle.odometerKm).toLocaleString('es-CO') });
  }

  // 5. Alertas activas.
  const alerts = (vehicle.commitments ?? []).filter((c) => c.status !== 'done' && c.urgency !== 'planned').length;
  if (alerts > 0) {
    facts.push({ id: 'alerts', label: 'ALERTAS', value: String(alerts) });
  }

  // 6. Modo 3D activo.
  facts.push({ id: 'mode', label: 'VISTA', value: viewModeLabel(viewMode), muted: true });

  return facts.slice(0, Math.max(1, max));
}

/**
 * Versión compacta del estado del enlace para la tarjeta lateral derecha.
 * Devuelve el texto ya formateado ("EN LÍNEA", "SEÑAL HACE 3 DÍAS", "SIN SEÑAL").
 */
export function formatLinkFact(monitoring: MonitoringState | null | undefined): string {
  if (!monitoring) return 'SIN SEÑAL';
  if (monitoring.connected) return 'EN LÍNEA';
  if (monitoring.lastSeen) return formatTimeAgo(monitoring.lastSeen).replace('hace ', 'SEÑAL HACE ');
  return 'SIN SEÑAL';
}

/**
 * Palabras que describen la ACCION y no la pieza: se descartan para que la etiqueta de la
 * fila de estado diga QUE hay que hacer ("ACEITE") y no COMO ("CAMBIO DE"). Solo verbos y
 * conectores: "Revisión técnica" o "Mantenimiento preventivo" ya son el sujeto, asi que se
 * conservan. Tambien se quitan los conectores ("de") que quedan al principio.
 */
const ACTION_STOPWORDS = new Set([
  'cambio',
  'cambiar',
  'reemplazo',
  'reemplazar',
  'renovar',
  'revalidar',
  'realizar',
  'programar',
  'hacer',
  'de',
  'del',
]);

/**
 * Recorta un titulo de compromiso a una etiqueta corta de una palabra en mayusculas y
 * sin tildes: "Renovar SOAT" -> "SOAT", "Cambio de aceite 10W-40" -> "ACEITE",
 * "Revisión técnica" -> "REVISION".
 */
export function shortLabel(title: string): string {
  const tokens = title.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && ACTION_STOPWORDS.has(stripAccents(tokens[0].toLowerCase()))) {
    tokens.shift();
  }
  const first = tokens[0] ?? title;
  return first.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}