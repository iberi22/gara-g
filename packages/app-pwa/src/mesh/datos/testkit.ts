/** testkit.ts — Datos de prueba compartidos por los tests de la red de datos (no entra al bundle). */
import type { VendorOffer } from './offer';
import { regionOf } from './topics';
import type { OwnerVehicle } from './vehicles';

export const NOW = Date.UTC(2026, 9, 2, 15, 0, 0); // viernes 15:00 UTC
export const DAY = 24 * 60 * 60 * 1000;

export const BOGOTA = regionOf(4.711, -74.072);
export const MEDELLIN = regionOf(6.244, -75.581);

export function offer(over: Partial<VendorOffer> = {}): VendorOffer {
  return {
    id: 'oferta-0001',
    vendor: 'Lubricentro El Motor',
    category: 'lubricentro',
    title: 'Cambio de aceite sintético',
    description: 'Incluye filtro.',
    target: { classes: [], brands: [], models: [] },
    region: BOGOTA,
    radiusKm: 10,
    validFrom: NOW - DAY,
    validUntil: NOW + 30 * DAY,
    createdAt: NOW - 1000,
    active: true,
    ...over,
  };
}

export function hilux(over: Partial<OwnerVehicle> = {}): OwnerVehicle {
  return {
    id: 'v-hilux',
    name: 'Hilux',
    cls: 'liviano',
    make: 'Toyota',
    model: 'Hilux',
    year: 2018,
    usage: 'km',
    odometer: 84_200,
    needs: [{ key: 'aceite', remaining: 800, unit: 'km' }],
    ...over,
  };
}

export function moto(over: Partial<OwnerVehicle> = {}): OwnerVehicle {
  return {
    id: 'v-moto',
    name: 'Pulsar',
    cls: 'moto',
    make: 'Bajaj',
    model: 'Pulsar 200',
    year: 2021,
    usage: 'km',
    odometer: 31_000,
    needs: [{ key: 'llantas', remaining: 3000, unit: 'km' }],
    ...over,
  };
}
