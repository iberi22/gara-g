/**
 * Plantillas de motos. Cada plantilla vive en su fichero (naked.ts, sport.ts,
 * scooter.ts, trail.ts) y se agrega a esta lista.
 */
import type { VehicleTemplate } from '../../contracts';
import { NAKED } from './naked';
import { SPORT } from './sport';
import { SCOOTER } from './scooter';
import { TRAIL } from './trail';

export const MOTO_TEMPLATES: VehicleTemplate[] = [NAKED, SPORT, SCOOTER, TRAIL];