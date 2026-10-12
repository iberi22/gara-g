/**
 * index.ts — Registro central de plantillas parametricas de carros y vehiculos pesados.
 *
 * Exporta todas las plantillas genericas de la familia 'car' (los camiones viven en
 * ../heavy, sobre truckKit.ts):
 *   - car-sedan (sedan.ts)
 *   - car-pickup (pickup.ts)
 *   - car-suv (suv.ts)
 *   - car-hatchback (hatchback.ts)
 *   - car-van (van.ts)
 */
import type { VehicleTemplate } from '../../contracts';
import { HATCHBACK } from './hatchback';
import { PICKUP } from './pickup';
import { SEDAN } from './sedan';
import { SUV } from './suv';
import { VAN } from './van';
export { HATCHBACK, PICKUP, SEDAN, SUV, VAN };

export const CAR_TEMPLATES: VehicleTemplate[] = [
  SEDAN,
  PICKUP,
  SUV,
  HATCHBACK,
  VAN,
];
