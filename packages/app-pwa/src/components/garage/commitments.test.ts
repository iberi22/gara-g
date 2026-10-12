/**
 * commitments.test.ts — Pruebas unitarias para la selección de compromisos urgentes del notificador.
 */
import { describe, expect, it } from 'vitest';
import type { Commitment } from '../../garage/contracts';
import { selectUrgentCommitments } from './commitments';

describe('selectUrgentCommitments', () => {
  it('devuelve array vacío si la lista es nula o vacía', () => {
    expect(selectUrgentCommitments(null)).toEqual([]);
    expect(selectUrgentCommitments([])).toEqual([]);
  });

  it('prioriza compromisos vencidos (overdue) sobre soon y planned', () => {
    const list: Commitment[] = [
      { id: '1', vehicleId: 'v1', kind: 'part_change', title: 'Planned task', urgency: 'planned', status: 'pending', source: 'catalog' },
      { id: '2', vehicleId: 'v1', kind: 'part_change', title: 'Overdue task', urgency: 'overdue', status: 'pending', source: 'catalog' },
      { id: '3', vehicleId: 'v1', kind: 'part_change', title: 'Soon task', urgency: 'soon', status: 'pending', source: 'catalog' },
    ];

    const result = selectUrgentCommitments(list, 3);
    expect(result.map((r) => r.id)).toEqual(['2', '3', '1']);
  });

  it('ordena por kilometraje restante más bajo/negativo dentro de la misma urgencia', () => {
    const list: Commitment[] = [
      { id: '1', vehicleId: 'v1', kind: 'part_change', title: 'Overdue -100', urgency: 'overdue', remainingKm: -100, status: 'pending', source: 'catalog' },
      { id: '2', vehicleId: 'v1', kind: 'part_change', title: 'Overdue -500', urgency: 'overdue', remainingKm: -500, status: 'pending', source: 'catalog' },
      { id: '3', vehicleId: 'v1', kind: 'part_change', title: 'Overdue -50', urgency: 'overdue', remainingKm: -50, status: 'pending', source: 'catalog' },
    ];

    const result = selectUrgentCommitments(list, 3);
    expect(result.map((r) => r.id)).toEqual(['2', '1', '3']);
  });

  it('limita el resultado a los 3 más urgentes', () => {
    const list: Commitment[] = [
      { id: '1', vehicleId: 'v1', kind: 'part_change', title: 'T1', urgency: 'overdue', status: 'pending', source: 'catalog' },
      { id: '2', vehicleId: 'v1', kind: 'part_change', title: 'T2', urgency: 'overdue', status: 'pending', source: 'catalog' },
      { id: '3', vehicleId: 'v1', kind: 'part_change', title: 'T3', urgency: 'soon', status: 'pending', source: 'catalog' },
      { id: '4', vehicleId: 'v1', kind: 'part_change', title: 'T4', urgency: 'planned', status: 'pending', source: 'catalog' },
    ];

    const result = selectUrgentCommitments(list, 3);
    expect(result.length).toBe(3);
    expect(result.map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('ignora compromisos completados si hay pendientes', () => {
    const list: Commitment[] = [
      { id: '1', vehicleId: 'v1', kind: 'part_change', title: 'Overdue done', urgency: 'overdue', status: 'done', source: 'catalog' },
      { id: '2', vehicleId: 'v1', kind: 'part_change', title: 'Soon pending', urgency: 'soon', status: 'pending', source: 'catalog' },
    ];

    const result = selectUrgentCommitments(list, 3);
    expect(result.map((r) => r.id)).toEqual(['2']);
  });
});
