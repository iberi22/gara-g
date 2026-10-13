/**
 * commitments.test.ts — Orden, urgencia y deduplicacion de la lista de compromisos.
 *
 * El caso que mas importa es el de duplicados: sin el, el HUD muestra "cambio de aceite"
 * dos veces (una del calendario, otra de la pieza del catalogo) y el usuario cuenta dos
 * trabajos donde hay uno.
 */
import { describe, expect, it } from 'vitest';
import { buildCommitments, sortCommitments, urgencyOf } from './commitments';
import { MARKETS } from '../../lib/market';
import type { MaintenanceRow, VehicleRow } from './records';

const NOW = new Date('2026-06-15T12:00:00.000Z');

const vehicle = (extra: Partial<VehicleRow> = {}): VehicleRow => ({ id: 'v1', ...extra });

const maint = (extra: Partial<MaintenanceRow> = {}): MaintenanceRow => ({
  id: 'm1',
  instance_id: 'inst',
  created_at: '',
  updated_at: '',
  vehicleId: 'v1',
  type: 'preventivo',
  km: 0,
  date: '2026-01-01',
  cost: 0,
  workshop: '',
  status: 'completed',
  ...extra,
});

const part = (slotId: string, healthPct: number | null, extra: Record<string, unknown> = {}) => ({
  slotId,
  label: slotId === 'engine_oil' ? 'Aceite 10W-40 moto' : slotId,
  category: 'liquido' as const,
  healthPct,
  status:
    healthPct === null
      ? ('unknown' as const)
      : healthPct <= 0
        ? ('overdue' as const)
        : ('ok' as const),
  nextDueKm: 30_000,
  ...extra,
});

describe('urgencyOf', () => {
  it('vencido si falta negativo, en km o en dias', () => {
    expect(urgencyOf(-1)).toBe('overdue');
    expect(urgencyOf(undefined, -5)).toBe('overdue');
  });
  it('soon en el borde: 1000 km y 30 dias exactos', () => {
    expect(urgencyOf(1000)).toBe('soon');
    expect(urgencyOf(undefined, 30)).toBe('soon');
  });
  it('planned pasado el borde', () => {
    expect(urgencyOf(1001)).toBe('planned');
    expect(urgencyOf(undefined, 31)).toBe('planned');
  });
  it('sin dato no inventa urgencia', () => {
    expect(urgencyOf()).toBe('planned');
  });
});

describe('sortCommitments: vencidos, luego soon, luego planned; dentro por lo que vence antes', () => {
  it('respeta el orden de urgencia y luego el mas proximo', () => {
    const items = sortCommitments([
      {
        id: 'c',
        vehicleId: 'v',
        kind: 'part_change',
        title: 'Planificado',
        urgency: 'planned',
        status: 'pending',
        source: 'catalog',
        remainingKm: 9000,
      },
      {
        id: 'a',
        vehicleId: 'v',
        kind: 'part_change',
        title: 'Vencido',
        urgency: 'overdue',
        status: 'pending',
        source: 'catalog',
        remainingKm: -100,
      },
      {
        id: 'b',
        vehicleId: 'v',
        kind: 'part_change',
        title: 'Pronto',
        urgency: 'soon',
        status: 'pending',
        source: 'catalog',
        remainingKm: 800,
      },
    ]);
    expect(items.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('dentro de un grupo, el mas proximo primero', () => {
    const items = sortCommitments([
      {
        id: 'lejos',
        vehicleId: 'v',
        kind: 'part_change',
        title: 'Lejos',
        urgency: 'soon',
        status: 'pending',
        source: 'catalog',
        remainingKm: 900,
      },
      {
        id: 'cerca',
        vehicleId: 'v',
        kind: 'part_change',
        title: 'Cerca',
        urgency: 'soon',
        status: 'pending',
        source: 'catalog',
        remainingKm: 50,
      },
    ]);
    expect(items[0]?.id).toBe('cerca');
  });
});

describe('buildCommitments', () => {
  it('un cambio de aceite del calendario y la pieza engine_oil salen como UNO solo', () => {
    const list = buildCommitments({
      vehicle: vehicle(),
      family: 'moto',
      odometerKm: 30_500,
      parts: [part('engine_oil', 12, { nextDueKm: 31_000 })],
      maintenance: [
        maint({
          id: 'cal',
          type: 'Cambio de aceite',
          km: 27_000,
          date: '2026-03-01',
          status: 'scheduled',
          nextKm: 31_000,
          nextDate: '2026-09-01',
        }),
      ],
      documents: [],
      now: NOW,
    });
    const oils = list.filter((c) => c.slotId === 'engine_oil');
    expect(oils).toHaveLength(1);
    // Se conserva la pieza (trae vida util y costo) y se rescata la fecha del calendario.
    expect(oils[0]?.source).toBe('catalog');
    expect(oils[0]?.dueDate).toBe('2026-09-01');
    expect(oils[0]?.remainingKm).toBe(500);
  });

  it('un mantenimiento completado NO aparece como compromiso', () => {
    const list = buildCommitments({
      vehicle: vehicle(),
      family: 'moto',
      odometerKm: 30_500,
      parts: [],
      maintenance: [maint({ status: 'completed', nextKm: 20_000, nextDate: '2026-01-01' })],
      documents: [],
      now: NOW,
    });
    expect(list).toHaveLength(0);
  });

  it('un mantenimiento scheduled vencido sale primero', () => {
    const list = buildCommitments({
      vehicle: vehicle(),
      family: 'moto',
      odometerKm: 30_500,
      parts: [],
      maintenance: [
        maint({ status: 'scheduled', km: 20_000, nextKm: 25_000, nextDate: '2026-02-01' }),
      ],
      documents: [],
      now: NOW,
    });
    expect(list[0]?.urgency).toBe('overdue');
    expect(list[0]?.remainingDays).toBeLessThan(0);
    expect(list[0]?.remainingKm).toBe(-5500);
  });

  it('un documento vencido sale como overdue con dias negativos', () => {
    const list = buildCommitments({
      vehicle: vehicle(),
      family: 'moto',
      odometerKm: 1000,
      parts: [],
      maintenance: [],
      documents: [{ id: 'd1', kind: 'SOAT', expiry: '2026-05-01' }],
      now: NOW,
    });
    const soat = list.find((c) => c.source === 'document');
    expect(soat?.urgency).toBe('overdue');
    expect(soat?.remainingDays).toBeLessThan(0);
    // El tipo guardado es el colombiano; el titulo visible depende del mercado.
    expect(soat?.title).toBe('Renovar SOAP');
    expect(
      buildCommitments(
        {
          vehicle: vehicle(),
          family: 'moto',
          odometerKm: 1000,
          parts: [],
          maintenance: [],
          documents: [{ id: 'd1', kind: 'SOAT', expiry: '2026-05-01' }],
          now: NOW,
        },
        MARKETS.CO,
      ).find((c) => c.source === 'document')?.title,
    ).toBe('Renovar SOAT');
  });

  it('un documento pronto de vencer sale como soon (corte de 30 dias)', () => {
    const list = buildCommitments({
      vehicle: vehicle(),
      family: 'moto',
      odometerKm: 1000,
      parts: [],
      maintenance: [],
      documents: [{ id: 'd1', kind: 'Tecnomecánica', expiry: '2026-07-01' }],
      now: NOW,
    });
    expect(list[0]?.urgency).toBe('soon');
    expect(list[0]?.remainingDays).toBe(16);
  });

  it('una pieza unknown no genera compromiso (no se puede afirmar que toque)', () => {
    const list = buildCommitments({
      vehicle: vehicle(),
      family: 'moto',
      odometerKm: 1000,
      parts: [part('battery', null, { nextDueKm: 5000 })],
      maintenance: [],
      documents: [],
      now: NOW,
    });
    expect(list).toHaveLength(0);
  });

  it('sin odometro: los compromisos por fecha siguen, los de km no', () => {
    const list = buildCommitments({
      vehicle: vehicle(),
      family: 'moto',
      parts: [part('engine_oil', 50, { nextDueKm: 31_000 })],
      maintenance: [maint({ status: 'scheduled', km: 20_000, nextDate: '2026-08-01' })],
      documents: [],
      now: NOW,
    });
    expect(list.every((c) => c.remainingKm === undefined)).toBe(true);
    expect(list.some((c) => c.kind === 'document' || c.kind === 'maintenance')).toBe(true);
  });
});
