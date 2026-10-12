/**
 * commitments.ts — Lógica de orden y selección de compromisos urgentes para el notificador HUD.
 *
 * Prioriza vencidos ('overdue'), seguidos de próximos ('soon') y luego planificados ('planned').
 * Dentro de la misma urgencia, prioriza menor km restante (negativos primero) o días restantes.
 */
import type { Commitment, CommitmentUrgency } from '../../garage/contracts';

const URGENCY_PRIORITY: Record<CommitmentUrgency, number> = {
  overdue: 0,
  soon: 1,
  planned: 2,
};

/**
 * Ordena y selecciona los N compromisos más urgentes (por defecto 3).
 */
export function selectUrgentCommitments(commitments: Commitment[] | undefined | null, limit = 3): Commitment[] {
  if (!commitments || commitments.length === 0) {
    return [];
  }

  // Filtrar solo los pendientes si hay estado disponible
  const pending = commitments.filter((c) => c.status !== 'done');
  const pool = pending.length > 0 ? pending : commitments;

  const sorted = [...pool].sort((a, b) => {
    // 1. Prioridad de urgencia
    const prioA = URGENCY_PRIORITY[a.urgency] ?? 99;
    const prioB = URGENCY_PRIORITY[b.urgency] ?? 99;
    if (prioA !== prioB) {
      return prioA - prioB;
    }

    // 2. Si ambos tienen remainingKm, ordenar ascendente (menor o más negativo primero)
    if (a.remainingKm !== undefined && b.remainingKm !== undefined) {
      return a.remainingKm - b.remainingKm;
    }
    if (a.remainingKm !== undefined) return -1;
    if (b.remainingKm !== undefined) return 1;

    // 3. Si ambos tienen remainingDays, ordenar ascendente
    if (a.remainingDays !== undefined && b.remainingDays !== undefined) {
      return a.remainingDays - b.remainingDays;
    }
    if (a.remainingDays !== undefined) return -1;
    if (b.remainingDays !== undefined) return 1;

    return a.id.localeCompare(b.id);
  });

  return sorted.slice(0, limit);
}
