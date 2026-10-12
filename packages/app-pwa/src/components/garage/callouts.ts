/**
 * callouts.ts — Construccion de las llamadas flotantes del plano.
 *
 * El plano tecnico de referencia senala con llamadas las piezas que exigen accion. Aqui son
 * las dos mas urgentes del vehiculo (vencidas, criticas o en aviso), y el texto que se
 * muestra es el dato que obliga a actuar ("ACEITE · VENCIDO", "FRENOS · 31 %").
 *
 * La logica vive aqui, y no dentro del componente, por una razon concreta: dos piezas
 * criticas del mismo eje llegan del dominio con la MISMA etiqueta ("Pastillas freno
 * delantero" para la izquierda y la derecha). Sin desambiguar, las dos llamadas de la
 * pantalla decian literalmente lo mismo y la segunda no aportaba nada. Al no haber un lugar
 * donde probar un `.svelte`, esto se prueba aqui.
 */
import type { PartHealthStatus } from '../../garage/contracts';

/** Los estados de una pieza que justifican una llamada en el plano. */
const URGENT_STATUSES: readonly PartHealthStatus[] = ['overdue', 'critical', 'warn'];

/** Una pieza en el formato que espera el componente de llamadas. */
export interface CalloutPart {
  slotId: string;
  label: string;
  category: string;
  status: PartHealthStatus;
  healthPct: number | null;
}

/** Una llamada ya resuelta, lista para dibujar. */
export interface Callout {
  slotId: string;
  label: string;
  value: string;
  urgent: boolean;
}

/** Orden de urgencia: lo vencido es lo primero, luego lo critico, luego el aviso. */
function statusRank(status: PartHealthStatus): number {
  const index = URGENT_STATUSES.indexOf(status);
  return index === -1 ? URGENT_STATUSES.length : index;
}

/**
 * Sufijo que distingue dos piezas con la misma etiqueta. Las ranuras de un carro llevan el
 * lado al final del id ("brake_fl", "brake_fr") y las de moto usan "front"/"rear".
 *
 * Se usan palabras completas y no abreviaturas ("DER"): en el plano una etiqueta de tres
 * letras se lee como un codigo y obliga a ir a buscar que significa.
 */
export function slotSuffix(slotId: string): string | null {
  const side = /_(fl|fr|rl|rr)$/.exec(slotId);
  if (side) {
    const map: Record<string, string> = { fl: 'IZQUIERDA', fr: 'DERECHA', rl: 'IZQUIERDA', rr: 'DERECHA' };
    return map[side[1]] ?? null;
  }
  if (/front/.test(slotId)) return 'DELANTERO';
  if (/rear/.test(slotId)) return 'TRASERO';
  return null;
}

/**
 * Etiqueta corta de una pieza para la llamada: se queda con la PRIMERA palabra en mayusculas
 * y sin tildes ("Aceite de motor" -> "ACEITE"), que es el formato de etiqueta del plano de
 * referencia. Si la primera palabra viniera vacia se cae a la categoria, para no pintar una
 * llamada sin texto.
 */
export function shortPartLabel(label: string, category = ''): string {
  const first = label.trim().split(/\s+/)[0] ?? '';
  const source = first !== '' ? first : category;
  return source.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Dato que obliga a actuar segun el estado de la pieza. Lo vencido manda el motivo
 * ("VENCIDO"), y en el resto se muestra la salud en porcentaje ("31 %"), que es el numero
 * que el usuario compara con el resto del plano.
 */
export function partCalloutValue(status: PartHealthStatus, healthPct: number | null): string {
  if (status === 'overdue') return 'VENCIDO';
  if (typeof healthPct === 'number' && Number.isFinite(healthPct)) {
    return `${Math.round(healthPct)} %`;
  }
  return status === 'critical' ? 'CRÍTICA' : 'REVISAR';
}

/**
 * Elige las piezas para las llamadas y les da texto unico.
 *
 * Se ordenan por urgencia y despues por salud (la peor primero), se toman como mucho
 * `limit`, y se descartan las que repetirian la etiqueta de otra ya elegida salvo que se
 * puedan desambiguar con el lado. El resultado siempre es unico por ranura.
 */
export function buildCallouts(parts: readonly CalloutPart[], limit = 2): Callout[] {
  const candidates = parts
    .filter((p) => URGENT_STATUSES.includes(p.status))
    .sort((a, b) => {
      const order = statusRank(a.status) - statusRank(b.status);
      if (order !== 0) return order;
      return (a.healthPct ?? 100) - (b.healthPct ?? 100);
    });

  const out: Callout[] = [];
  const usedLabels = new Set<string>();
  const usedSlots = new Set<string>();
  for (const part of candidates) {
    if (out.length >= limit) break;
    if (usedSlots.has(part.slotId)) continue;
    let label = shortPartLabel(part.label, part.category);
    if (usedLabels.has(label)) {
      const refined = slotSuffix(part.slotId);
      if (!refined) continue;
      label = `${label} ${refined}`;
      if (usedLabels.has(label)) continue;
    }
    usedSlots.add(part.slotId);
    usedLabels.add(label);
    out.push({
      slotId: part.slotId,
      label,
      value: partCalloutValue(part.status, part.healthPct),
      urgent: part.status === 'overdue' || part.status === 'critical',
    });
  }
  return out;
}