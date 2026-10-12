/**
 * registry.ts — Catalogo de plantillas parametricas.
 *
 * Cada familia exporta su lista desde su index (moto/index.ts, car/index.ts); este
 * fichero solo las junta y resuelve que plantilla usar para un vehiculo.
 */
import type { BodyType, VehicleFamily, VehicleSpec, VehicleTemplate } from '../contracts';
import { CAR_TEMPLATES } from './car';
import { HEAVY_TEMPLATES } from './heavy';
import { MACHINERY_TEMPLATES } from './machinery';
import { MOTO_TEMPLATES } from './moto';
import { DEBUG_TEMPLATE } from './common/debugTemplate';

export const TEMPLATES: VehicleTemplate[] = [...MOTO_TEMPLATES, ...CAR_TEMPLATES, ...HEAVY_TEMPLATES, ...MACHINERY_TEMPLATES];

export function getTemplateById(id: string): VehicleTemplate | undefined {
  if (id === DEBUG_TEMPLATE.id) return DEBUG_TEMPLATE;
  return TEMPLATES.find((t) => t.id === id);
}

/** Plantilla para una carroceria; si falta, la mas parecida de la familia y por ultimo la de depuracion. */
export function getTemplate(body: BodyType, family?: VehicleFamily): VehicleTemplate {
  return (
    TEMPLATES.find((t) => t.body === body) ??
    (family ? TEMPLATES.find((t) => t.family === family) : undefined) ??
    DEBUG_TEMPLATE
  );
}

/** Tipo del catalogo (src/lib/vehicleCatalog.ts) → familia y carroceria por defecto. */
export function bodyForCatalogType(type: string | undefined): { family: VehicleFamily; body: BodyType } {
  switch (type) {
    case 'moto':
      return { family: 'moto', body: 'naked' };
    case 'sedan':
      return { family: 'car', body: 'sedan' };
    case 'suv':
      return { family: 'car', body: 'suv' };
    case 'pickup':
      return { family: 'car', body: 'pickup' };
    case 'van':
      return { family: 'car', body: 'van' };
    case 'camion':
      return { family: 'heavy', body: 'truck' };
    case 'estacas':
      return { family: 'heavy', body: 'flatbed' };
    case 'volqueta':
      return { family: 'heavy', body: 'dump' };
    case 'tractomula':
      return { family: 'heavy', body: 'tractor' };
    case 'excavadora':
      return { family: 'machinery', body: 'excavator' };
    case 'retroexcavadora':
      return { family: 'machinery', body: 'backhoe' };
    case 'cargador':
      return { family: 'machinery', body: 'wheel_loader' };
    case 'bulldozer':
      return { family: 'machinery', body: 'dozer' };
    case 'motoniveladora':
      return { family: 'machinery', body: 'grader' };
    case 'vibrocompactador':
      return { family: 'machinery', body: 'roller' };
    default:
      return { family: 'car', body: 'sedan' };
  }
}

/** Spec por defecto de una carroceria (medidas tipicas de la plantilla + pintura neutra). */
export function defaultSpec(body: BodyType, family?: VehicleFamily): VehicleSpec {
  const t = getTemplate(body, family);
  return { ...t.defaults, paint: { baseColor: '#9aa3ad', finish: 'metallic' } };
}
