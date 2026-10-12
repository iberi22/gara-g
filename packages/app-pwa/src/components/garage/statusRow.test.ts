/**
 * statusRow.test.ts — Pruebas del resumen de la fila de estado bajo el vehiculo.
 */
import { describe, expect, it } from 'vitest';
import type { GarageVehicle, MonitoringState } from '../../garage/contracts';
import { MOCK_SNAPSHOT } from '../../garage/mock';
import { buildStatusFacts, formatLinkFact, shortLabel } from './statusRow';

function vehicleOf(index = 0): GarageVehicle {
  const v = MOCK_SNAPSHOT.vehicles[index];
  if (!v) throw new Error('El mock debe traer al menos un vehiculo');
  return v;
}

const ONLINE: MonitoringState = {
  vin: 'X',
  connected: true,
  lastSeen: new Date().toISOString(),
  series: [],
};

const OFFLINE_RECENT: MonitoringState = {
  vin: 'X',
  connected: false,
  lastSeen: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  series: [],
};

describe('shortLabel', () => {
  it('recorta el verbo y deja la primera palabra en mayusculas sin tildes', () => {
    expect(shortLabel('Renovar SOAT')).toBe('SOAT');
    expect(shortLabel('Cambio de aceite 10W-40')).toBe('ACEITE');
    expect(shortLabel('Revisión técnica')).toBe('REVISION');
  });
});

describe('buildStatusFacts', () => {
  it('empieza por los compromisos vencidos y los marca como urgentes', () => {
    const facts = buildStatusFacts(vehicleOf(0), { monitoring: ONLINE, viewMode: 'health' });
    expect(facts.length).toBeGreaterThanOrEqual(4);
    expect(facts.length).toBeLessThanOrEqual(6);
    expect(facts[0].value).toBe('VENCIDO');
    expect(facts[0].urgent).toBe(true);
  });

  it('incluye odometro y el modo 3D activo', () => {
    const v = vehicleOf(0);
    const facts = buildStatusFacts(v, { monitoring: ONLINE, viewMode: 'health' });
    const odo = facts.find((f) => f.id === 'odo');
    const mode = facts.find((f) => f.id === 'mode');
    expect(odo?.value).toBe(Math.round(v.odometerKm ?? 0).toLocaleString('es-CO'));
    expect(mode?.value).toBe('MODO SALUD');
    expect(mode?.muted).toBe(true);
  });

  it('marca el enlace como sin senal y apagado cuando no hay muestras', () => {
    const facts = buildStatusFacts(vehicleOf(0), { monitoring: null });
    const link = facts.find((f) => f.id === 'link');
    expect(link?.value).toBe('SIN DATOS');
    expect(link?.muted).toBe(true);
  });

  it('distingue en linea de "sin senal" con ultima muestra', () => {
    const on = buildStatusFacts(vehicleOf(0), { monitoring: ONLINE }).find((f) => f.id === 'link');
    const off = buildStatusFacts(vehicleOf(0), { monitoring: OFFLINE_RECENT }).find((f) => f.id === 'link');
    expect(on?.value).toBe('EN LÍNEA');
    expect(on?.muted).toBe(false);
    expect(off?.value).toBe('SIN SEÑAL');
    expect(off?.muted).toBe(true);
  });

  it('el proximo compromisoSoon se muestra en dias', () => {
    const facts = buildStatusFacts(vehicleOf(0), { monitoring: ONLINE });
    const next = facts.find((f) => f.id.startsWith('next-'));
    expect(next).toBeDefined();
    expect(next?.value).toMatch(/DÍAS|VENCIDO|PENDIENTE/);
  });

  it('respeta el limite maximo de hechos', () => {
    const facts = buildStatusFacts(vehicleOf(0), { monitoring: ONLINE, max: 3 });
    expect(facts).toHaveLength(3);
  });

  it('no incluye compromisos ya completados', () => {
    const v: GarageVehicle = {
      ...vehicleOf(0),
      commitments: [
        {
          id: 'c-done',
          vehicleId: v0Id(),
          kind: 'part_change',
          title: 'Cambio de aceite',
          urgency: 'overdue',
          status: 'done',
          source: 'catalog',
        },
      ],
    };
    const facts = buildStatusFacts(v, { monitoring: ONLINE });
    expect(facts.some((f) => f.id.startsWith('overdue-'))).toBe(false);
  });
});

function v0Id(): string {
  return vehicleOf(0).id;
}

describe('formatLinkFact', () => {
  it('resume el estado del enlace para la tarjeta lateral', () => {
    expect(formatLinkFact(ONLINE)).toBe('EN LÍNEA');
    expect(formatLinkFact(null)).toBe('SIN SEÑAL');
    expect(formatLinkFact({ vin: 'X', connected: false, series: [] })).toBe('SIN SEÑAL');
    expect(formatLinkFact(OFFLINE_RECENT)).toMatch(/^SEÑAL HACE /);
  });
});