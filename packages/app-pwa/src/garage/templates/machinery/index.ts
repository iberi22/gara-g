/**
 * machinery/index.ts — Plantillas de maquinaria amarilla sobre machineryKit.ts.
 *
 *   machinery-excavator     Excavadora de orugas
 *   machinery-backhoe       Retroexcavadora
 *   machinery-wheel-loader  Cargador frontal
 *   machinery-dozer         Bulldozer
 *   machinery-grader        Motoniveladora
 *   machinery-roller        Vibrocompactador
 */
import type { VehicleTemplate } from '../../contracts';
import { BACKHOE } from './backhoe';
import { DOZER } from './dozer';
import { EXCAVATOR } from './excavator';
import { GRADER } from './grader';
import { ROLLER } from './roller';
import { WHEEL_LOADER } from './wheelLoader';

export { BACKHOE, DOZER, EXCAVATOR, GRADER, ROLLER, WHEEL_LOADER };

export const MACHINERY_TEMPLATES: VehicleTemplate[] = [EXCAVATOR, BACKHOE, WHEEL_LOADER, DOZER, GRADER, ROLLER];
