/**
 * usageUnit.test.ts — Maquinaria por horas de motor (horometro) de punta a punta del
 * dominio: unidad, salud de piezas, compromisos, indicadores e historial.
 */
import { describe, expect, it } from 'vitest';
import { normalizeVehicleType, usageUnitOfType } from '../../lib/vehicleCatalog';
import { bodyFor } from './vehicleSpec';
import { buildGarageVehicle, inUsageUnit, usageUnitOf, type VehicleData } from './snapshot';

const NOW = new Date('2026-10-02T12:00:00Z');

function machine(extra: Partial<VehicleData> = {}): VehicleData {
  return {
    vehicle: { id: 'exc-1', make: 'Caterpillar', model: '320', year: 2019, type: 'excavadora', plate: '', hours: 1250 },
    maintenance: [
      { id: 'm1', vehicleId: 'exc-1', type: 'Cambio de aceite de motor', hours: 1000, date: '2026-08-01', status: 'completed' },
      { id: 'm2', vehicleId: 'exc-1', type: 'Cambio de filtro hidraulico', hours: 400, date: '2026-03-01', status: 'completed' },
    ],
    fuelLogs: [
      { id: 'f1', vehicleId: 'exc-1', date: '2026-09-01', hours: 1100, gallons: 60, cost: 900000 },
      { id: 'f2', vehicleId: 'exc-1', date: '2026-09-10', hours: 1150, gallons: 300, cost: 4500000 },
      { id: 'f3', vehicleId: 'exc-1', date: '2026-09-20', hours: 1250, gallons: 600, cost: 9000000 },
    ],
    documents: [],
    alerts: [],
    telemetry: [],
    ...extra,
  } as VehicleData;
}

describe('tipos del catalogo', () => {
  it('normaliza texto libre a los tipos del catalogo', () => {
    expect(normalizeVehicleType('Camión')).toBe('camion');
    expect(normalizeVehicleType('Volqueta')).toBe('volqueta');
    expect(normalizeVehicleType('Retroexcavadora')).toBe('retroexcavadora');
    expect(normalizeVehicleType('cargador frontal')).toBe('cargador');
    expect(normalizeVehicleType('Vibro-compactador')).toBe('vibrocompactador');
    expect(normalizeVehicleType('platillo volador')).toBeUndefined();
  });

  it('la maquinaria va por horas y lo demas por km', () => {
    expect(usageUnitOfType('excavadora')).toBe('h');
    expect(usageUnitOfType('Motoniveladora')).toBe('h');
    expect(usageUnitOfType('volqueta')).toBe('km');
    expect(usageUnitOfType(undefined)).toBe('km');
  });

  it('cada tipo nuevo llega a su plantilla 3D', () => {
    expect(bodyFor({ type: 'volqueta' })).toEqual({ family: 'heavy', body: 'dump' });
    expect(bodyFor({ type: 'Camión de estacas' })).toEqual({ family: 'heavy', body: 'flatbed' });
    expect(bodyFor({ type: 'excavadora' })).toEqual({ family: 'machinery', body: 'excavator' });
    expect(bodyFor({ type: 'bulldozer' })).toEqual({ family: 'machinery', body: 'dozer' });
    // Sin tipo, el catalogo decide por marca/modelo.
    expect(bodyFor({ make: 'CAT', model: '950' })).toEqual({ family: 'machinery', body: 'wheel_loader' });
  });
});

describe('maquinaria por horometro', () => {
  it('detecta la unidad por familia o por modelo del catalogo', () => {
    expect(usageUnitOf(machine().vehicle)).toBe('h');
    expect(usageUnitOf({ make: 'Toyota', model: 'Hilux', type: 'pickup' })).toBe('km');
  });

  it('pasa las horas a los campos de uso y no toca un vehiculo por km', () => {
    const d = inUsageUnit(machine(), 'h');
    expect(d.vehicle.mileage).toBe(1250);
    expect(d.maintenance[0].km).toBe(1000);
    expect(d.fuelLogs[2].km).toBe(1250);
    const road = machine();
    expect(inUsageUnit(road, 'km')).toBe(road);
  });

  it('calcula la salud de piezas en horas', () => {
    const v = buildGarageVehicle(machine(), NOW);
    expect(v.usageUnit).toBe('h');
    expect(v.odometerKm).toBe(1250);
    expect(v.spec.family).toBe('machinery');
    expect(v.spec.paint.baseColor).toBe('#f2b200');
    const oil = v.parts.find((p) => p.slotId === 'engine_oil');
    // Aceite cada 500 h, cambiado a las 1000 h, horometro en 1250 h → 50 %.
    expect(oil?.lifeKm).toBe(500);
    expect(oil?.kmSinceService).toBe(250);
    expect(oil?.healthPct).toBe(50);
    expect(oil?.nextDueKm).toBe(1500);
    // Filtro hidraulico cada 1000 h, cambiado a las 400 h → 850 h de uso → 15 %.
    const hyd = v.parts.find((p) => p.slotId === 'hydraulic_oil');
    expect(hyd?.kmSinceService).toBe(850);
    expect(hyd?.healthPct).toBe(15);
  });

  it('solo lista las piezas que tiene una excavadora (sin llantas ni hoja)', () => {
    const ids = buildGarageVehicle(machine(), NOW).parts.map((p) => p.slotId);
    expect(ids).toContain('track_left');
    expect(ids).toContain('bucket');
    expect(ids).not.toContain('tire_fl');
    expect(ids).not.toContain('blade');
  });

  it('los compromisos y el HUD hablan en horas', () => {
    const v = buildGarageVehicle(machine(), NOW);
    const odo = v.indicators.left.find((i) => i.id === 'odo');
    expect(odo?.label).toBe('Horómetro');
    expect(odo?.unit).toBe('h');
    const next = v.indicators.left.find((i) => i.id === 'next');
    expect(next?.unit).toBe('h');
    // Filtro hidraulico vence a las 1400 h: faltan 150 h → planeado (umbral de pronto: 50 h).
    const hyd = v.commitments.find((c) => c.slotId === 'hydraulic_oil');
    expect(hyd?.remainingKm).toBe(150);
    expect(hyd?.urgency).toBe('planned');
    // Consumo en gal/h: (300 + 600) gal / (1250 - 1100) h = 6 gal/h.
    const eff = v.indicators.right.find((i) => i.id === 'eff');
    expect(eff?.unit).toBe('gal/h');
    expect(eff?.value).toBe('6.0');
  });

  it('un servicio programado sin proximo usa 500 h y no 10 000', () => {
    const v = buildGarageVehicle(
      machine({
        maintenance: [{ id: 'm3', vehicleId: 'exc-1', type: 'Servicio de 500 horas', hours: 800, date: '2026-07-01', status: 'scheduled' }],
      } as Partial<VehicleData>),
      NOW,
    );
    const svc = v.commitments.find((c) => c.kind === 'maintenance');
    expect(svc?.dueKm).toBe(1300);
    expect(svc?.remainingKm).toBe(50);
    expect(svc?.urgency).toBe('soon');
  });
});
