/**
 * vehicles.ts — Lo que la red de datos necesita saber de un vehiculo del dueno, sacado del
 * garage local (GarageSnapshot).
 *
 * `OwnerVehicle` SI trae el odometro exacto y el nombre: es para emparejar ofertas en el
 * dispositivo y nunca sale de el. Lo que sale a la malla es `DemandSignal` (demand.ts), que
 * no tiene placa, VIN, km exactos ni posicion. Aqui no se copia la placa ni el VIN a proposito.
 */
import type { Commitment, GarageSnapshot, GarageVehicle, VehicleFamily } from '../../garage/contracts';
import type { NeedKey, VehicleClass } from './offer';

export type NeedUnit = 'km' | 'h' | 'dias';

export interface Need {
  key: NeedKey;
  /** Lo que falta, en `unit`. Negativo = ya se paso. */
  remaining: number;
  unit: NeedUnit;
}

export interface OwnerVehicle {
  id: string;
  /** Nombre que le puso el dueno ("Hilux"); solo para la explicacion en pantalla. */
  name: string;
  cls: VehicleClass;
  make?: string;
  model?: string;
  year?: number;
  usage: 'km' | 'h';
  /** Odometro o horometro exacto. Solo local. */
  odometer?: number;
  needs: Need[];
}

export function classOfFamily(f: VehicleFamily): VehicleClass {
  switch (f) {
    case 'moto':
      return 'moto';
    case 'heavy':
      return 'pesado';
    case 'machinery':
      return 'maquinaria';
    default:
      return 'liviano';
  }
}

/** A que necesidad corresponde un compromiso del garage, o null si no es algo que se venda. */
export function needOfCommitment(c: Commitment): NeedKey | null {
  const slot = c.slotId ?? '';
  const t = c.title.toLowerCase();
  if (c.kind === 'document') {
    if (/soat|seguro/.test(t)) return 'seguro';
    if (/tecno|revisi/.test(t)) return 'revision';
    return null;
  }
  if (slot === 'engine_oil' || slot === 'oil_filter' || /aceite/.test(t)) return /filtro de aceite/.test(t) ? 'filtros' : 'aceite';
  if (slot.startsWith('tire') || /llanta|neum/.test(t)) return 'llantas';
  if (slot.startsWith('brake') || /freno|pastilla|disco/.test(t)) return 'frenos';
  if (slot === 'battery' || /bater/.test(t)) return 'bateria';
  if (slot.endsWith('_filter') || /filtro/.test(t)) return 'filtros';
  if (c.kind === 'maintenance' || c.kind === 'inspection') return 'revision';
  return null;
}

function needsOf(v: GarageVehicle): Need[] {
  const byKey = new Map<NeedKey, Need>();
  for (const c of v.commitments) {
    if (c.status === 'done') continue;
    const key = needOfCommitment(c);
    if (!key) continue;
    // Si no hay km (documento, o mantenimiento solo con fecha) se usa los dias que faltan.
    const need: Need | null =
      c.remainingKm !== undefined
        ? { key, remaining: c.remainingKm, unit: v.usageUnit }
        : c.remainingDays !== undefined
          ? { key, remaining: c.remainingDays, unit: 'dias' }
          : null;
    if (!need) continue;
    const prev = byKey.get(key);
    // De varias del mismo tipo gana la mas apurada, comparada en la misma escala.
    if (!prev || scaleKm(need) < scaleKm(prev)) byKey.set(key, need);
  }
  return [...byKey.values()];
}

/** Lleva km, horas y dias a una escala comparable (una hora de motor ~ 20 km; un dia ~ 30 km). */
export function scaleKm(n: Need): number {
  return n.remaining * (n.unit === 'h' ? 20 : n.unit === 'dias' ? 30 : 1);
}

export function vehiclesFromSnapshot(snapshot: GarageSnapshot): OwnerVehicle[] {
  return snapshot.vehicles
    .filter((v) => v.status !== 'idle' || v.commitments.length > 0)
    .map((v) => ({
      id: v.id,
      name: v.name,
      cls: classOfFamily(v.spec.family),
      make: v.make,
      model: v.model,
      year: v.year,
      usage: v.usageUnit,
      odometer: v.odometerKm,
      needs: needsOf(v),
    }));
}
