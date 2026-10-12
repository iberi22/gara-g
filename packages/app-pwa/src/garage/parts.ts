/**
 * parts.ts — Ranuras de piezas canonicas por familia y su relacion con el catalogo.
 *
 * Una "ranura" (slot) es una pieza que el 3D construye por separado y que puede
 * tener estado (salud), variante y foco de camara. Las plantillas construyen las
 * ranuras `required` de su familia; el dominio traduce los repuestos del catalogo
 * (src/lib/vehicleCatalog.ts, commonParts) a ranuras con slotsForCatalogPart().
 */
import type { BodyType, PartCategory, PartSlotDef, PartSlotId, VehicleFamily } from './contracts';

const M: VehicleFamily[] = ['moto'];
const C: VehicleFamily[] = ['car'];
const CH: VehicleFamily[] = ['car', 'heavy'];
const H: VehicleFamily[] = ['heavy'];
const HX: VehicleFamily[] = ['heavy', 'machinery'];
const X: VehicleFamily[] = ['machinery'];
/** Llantas: obligatorias en carro y pesados; en maquinaria solo las de llantas (las de orugas no). */
const CHX: VehicleFamily[] = ['car', 'heavy', 'machinery'];
const ALL: VehicleFamily[] = ['moto', 'car', 'heavy', 'machinery'];

export const PART_SLOTS: readonly PartSlotDef[] = [
  // --- comunes ---
  { id: 'engine', label: 'Motor', category: 'motor', families: ALL, required: true },
  { id: 'engine_oil', label: 'Aceite de motor', category: 'liquido', families: ALL, required: true, internal: true },
  { id: 'air_filter', label: 'Filtro de aire', category: 'filtro', families: ALL, required: true, internal: true },
  { id: 'spark_plugs', label: 'Bujias', category: 'motor', families: ['moto', 'car'], required: false, internal: true },
  { id: 'battery', label: 'Bateria', category: 'electrico', families: ALL, required: true, internal: true },
  { id: 'exhaust', label: 'Escape', category: 'escape', families: ALL, required: true },
  { id: 'headlight', label: 'Farola', category: 'iluminacion', families: ALL, required: true },
  { id: 'taillight', label: 'Stop', category: 'iluminacion', families: ALL, required: true },
  { id: 'mirrors', label: 'Espejos', category: 'carroceria', families: ALL, required: false },

  // --- moto ---
  { id: 'frame', label: 'Chasis', category: 'chasis', families: M, required: true },
  { id: 'fuel_tank', label: 'Tanque', category: 'carroceria', families: M, required: true },
  { id: 'seat', label: 'Sillin', category: 'carroceria', families: M, required: true },
  { id: 'bodywork', label: 'Carenaje', category: 'carroceria', families: M, required: false },
  { id: 'handlebar', label: 'Manubrio', category: 'chasis', families: M, required: true },
  { id: 'fork', label: 'Barras de suspension', category: 'suspension', families: M, required: true },
  { id: 'shock_rear', label: 'Amortiguador trasero', category: 'suspension', families: M, required: true },
  { id: 'swingarm', label: 'Basculante', category: 'chasis', families: M, required: true },
  { id: 'drive', label: 'Kit de arrastre', category: 'transmision', families: M, required: true },
  { id: 'rim_front', label: 'Rin delantero', category: 'llantas', families: M, required: true },
  { id: 'rim_rear', label: 'Rin trasero', category: 'llantas', families: M, required: true },
  { id: 'tire_front', label: 'Llanta delantera', category: 'llantas', families: M, required: true },
  { id: 'tire_rear', label: 'Llanta trasera', category: 'llantas', families: M, required: true },
  { id: 'brake_front', label: 'Freno delantero', category: 'frenos', families: M, required: true },
  { id: 'brake_rear', label: 'Freno trasero', category: 'frenos', families: M, required: true },

  // --- carro y pesados ---
  { id: 'body', label: 'Carroceria', category: 'carroceria', families: CH, required: true },
  { id: 'hood', label: 'Capo', category: 'carroceria', families: CH, required: true },
  { id: 'bumper_front', label: 'Bomper delantero', category: 'carroceria', families: CH, required: true },
  { id: 'bumper_rear', label: 'Bomper trasero', category: 'carroceria', families: CH, required: true },
  { id: 'glass', label: 'Vidrios', category: 'carroceria', families: CH, required: true },
  { id: 'door_fl', label: 'Puerta delantera izquierda', category: 'carroceria', families: CH, required: false },
  { id: 'door_fr', label: 'Puerta delantera derecha', category: 'carroceria', families: CH, required: false },
  { id: 'door_rl', label: 'Puerta trasera izquierda', category: 'carroceria', families: C, required: false },
  { id: 'door_rr', label: 'Puerta trasera derecha', category: 'carroceria', families: C, required: false },
  { id: 'trunk', label: 'Baul / porton', category: 'carroceria', families: C, required: false },
  { id: 'cargo_bed', label: 'Platon', category: 'carroceria', families: CH, required: false },
  { id: 'oil_filter', label: 'Filtro de aceite', category: 'filtro', families: ['car', 'heavy', 'machinery'], required: true, internal: true },
  { id: 'fuel_filter', label: 'Filtro de combustible', category: 'filtro', families: ['car', 'heavy', 'machinery'], required: true, internal: true },
  { id: 'clutch', label: 'Embrague', category: 'transmision', families: CH, required: false, internal: true },
  { id: 'suspension_front', label: 'Suspension delantera', category: 'suspension', families: CH, required: true },
  { id: 'suspension_rear', label: 'Suspension trasera', category: 'suspension', families: CH, required: true },
  { id: 'rim_fl', label: 'Rin delantero izquierdo', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'rim_fr', label: 'Rin delantero derecho', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'rim_rl', label: 'Rin trasero izquierdo', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'rim_rr', label: 'Rin trasero derecho', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'tire_fl', label: 'Llanta delantera izquierda', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'tire_fr', label: 'Llanta delantera derecha', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'tire_rl', label: 'Llanta trasera izquierda', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'tire_rr', label: 'Llanta trasera derecha', category: 'llantas', families: CHX, required: true, optionalIn: X },
  { id: 'brake_fl', label: 'Freno delantero izquierdo', category: 'frenos', families: CH, required: true },
  { id: 'brake_fr', label: 'Freno delantero derecho', category: 'frenos', families: CH, required: true },
  { id: 'brake_rl', label: 'Freno trasero izquierdo', category: 'frenos', families: CH, required: true },
  { id: 'brake_rr', label: 'Freno trasero derecho', category: 'frenos', families: CH, required: true },
  { id: 'cab', label: 'Cabina', category: 'carroceria', families: HX, required: true },
  { id: 'chassis_frame', label: 'Chasis', category: 'chasis', families: HX, required: true },
  { id: 'cargo_box', label: 'Furgon / carga', category: 'carroceria', families: H, required: false },
  { id: 'fifth_wheel', label: 'Quinta rueda', category: 'chasis', families: H, required: false },
  { id: 'fuel_tank_heavy', label: 'Tanque de combustible', category: 'chasis', families: HX, required: true },
  { id: 'dump_body', label: 'Volco', category: 'carroceria', families: H, required: false },
  { id: 'dump_cylinder', label: 'Cilindro de volteo', category: 'hidraulico', families: H, required: false },
  { id: 'stake_bed', label: 'Carroceria de estacas', category: 'carroceria', families: H, required: false },

  // --- maquinaria amarilla (vida util en horas de motor) ---
  { id: 'hydraulic_pump', label: 'Bomba hidraulica', category: 'hidraulico', families: X, required: true, internal: true },
  { id: 'hydraulic_oil', label: 'Aceite y filtro hidraulico', category: 'hidraulico', families: X, required: true, internal: true },
  { id: 'hydraulic_cylinders', label: 'Cilindros hidraulicos', category: 'hidraulico', families: X, required: true },
  { id: 'engine_hood', label: 'Capot del motor', category: 'carroceria', families: X, required: true },
  { id: 'counterweight', label: 'Contrapeso', category: 'chasis', families: X, required: false },
  { id: 'swing', label: 'Tornamesa de giro', category: 'transmision', families: X, required: false },
  { id: 'transmission', label: 'Transmision', category: 'transmision', families: X, required: false, internal: true },
  { id: 'final_drive', label: 'Mandos finales', category: 'transmision', families: X, required: false, internal: true },
  { id: 'track_left', label: 'Oruga izquierda', category: 'llantas', families: X, required: false },
  { id: 'track_right', label: 'Oruga derecha', category: 'llantas', families: X, required: false },
  { id: 'boom', label: 'Pluma', category: 'hidraulico', families: X, required: false },
  { id: 'arm', label: 'Brazo', category: 'hidraulico', families: X, required: false },
  { id: 'bucket', label: 'Balde', category: 'carroceria', families: X, required: false },
  { id: 'loader_arms', label: 'Brazos de cargue', category: 'hidraulico', families: X, required: false },
  { id: 'blade', label: 'Hoja / cuchilla', category: 'carroceria', families: X, required: false },
  { id: 'ripper', label: 'Escarificador', category: 'carroceria', families: X, required: false },
  { id: 'drum', label: 'Rodillo vibratorio', category: 'chasis', families: X, required: false },
];

const BY_ID = new Map(PART_SLOTS.map((s) => [s.id, s]));

export function getSlot(id: PartSlotId): PartSlotDef | undefined {
  return BY_ID.get(id);
}

export function slotsForFamily(family: VehicleFamily): PartSlotDef[] {
  return PART_SLOTS.filter((s) => s.families.includes(family));
}

const WHEELS = ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'tire_fl', 'tire_fr', 'tire_rl', 'tire_rr'];
const TRACKS = ['track_left', 'track_right', 'final_drive'];
/**
 * Ranuras opcionales que una carroceria concreta NO tiene. Sin esto, el estado de piezas de
 * una excavadora listaba llantas y rines, y el de un furgon la quinta rueda.
 */
const NOT_ON_BODY: Partial<Record<BodyType, readonly string[]>> = {
  truck: ['dump_body', 'dump_cylinder', 'stake_bed', 'fifth_wheel', 'cargo_bed'],
  flatbed: ['dump_body', 'dump_cylinder', 'cargo_box', 'fifth_wheel', 'cargo_bed'],
  dump: ['stake_bed', 'cargo_box', 'fifth_wheel', 'cargo_bed'],
  tractor: ['dump_body', 'dump_cylinder', 'stake_bed', 'cargo_box', 'cargo_bed'],
  excavator: [...WHEELS, 'loader_arms', 'blade', 'ripper', 'drum', 'transmission'],
  dozer: [...WHEELS, 'boom', 'arm', 'bucket', 'loader_arms', 'drum', 'swing', 'counterweight'],
  backhoe: [...TRACKS, 'blade', 'ripper', 'drum', 'counterweight'],
  wheel_loader: [...TRACKS, 'boom', 'arm', 'blade', 'ripper', 'drum', 'swing'],
  grader: ['track_left', 'track_right', 'boom', 'arm', 'bucket', 'loader_arms', 'drum', 'swing', 'counterweight', 'ripper'],
  roller: [...TRACKS, 'boom', 'arm', 'bucket', 'loader_arms', 'blade', 'ripper', 'swing', 'rim_fl', 'rim_fr', 'tire_fl', 'tire_fr'],
};

/** Ranuras de la familia que existen en esa carroceria. */
export function slotsForBody(family: VehicleFamily, body?: BodyType): PartSlotDef[] {
  const skip = body ? NOT_ON_BODY[body] : undefined;
  const all = slotsForFamily(family);
  return skip ? all.filter((s) => !skip.includes(s.id)) : all;
}

export function requiredSlots(family: VehicleFamily): PartSlotId[] {
  return slotsForFamily(family)
    .filter((s) => s.required && !s.optionalIn?.includes(family))
    .map((s) => s.id);
}

const FRONT = /delanter/i;
const REAR = /traser/i;

function axle(name: string, front: PartSlotId[], rear: PartSlotId[]): PartSlotId[] {
  if (FRONT.test(name)) return front;
  if (REAR.test(name)) return rear;
  return [...front, ...rear];
}

/**
 * Traduce un repuesto del catalogo a las ranuras 3D que representa.
 * "Pastillas freno delantero" en un carro → ['brake_fl', 'brake_fr'].
 * Devuelve [] si el repuesto no tiene representacion 3D.
 */
export function slotsForCatalogPart(name: string, category: string, family: VehicleFamily): PartSlotId[] {
  const n = name.toLowerCase();
  const moto = family === 'moto';
  if (family === 'machinery') {
    const hit = machinerySlots(n);
    if (hit) return hit;
  }
  if (family === 'heavy' && /volco|volteo/.test(n)) return /cilindro|hidraul/.test(n) ? ['dump_cylinder'] : ['dump_body'];
  if (/filtro de aceite/.test(n)) return moto ? ['engine_oil'] : ['oil_filter'];
  if (/filtro de aire/.test(n)) return ['air_filter'];
  if (/filtro de combustible/.test(n)) return moto ? [] : ['fuel_filter'];
  if (/aceite/.test(n)) return ['engine_oil'];
  if (/buj/.test(n)) return family === 'heavy' || family === 'machinery' ? [] : ['spark_plugs'];
  if (/bater/.test(n)) return ['battery'];
  if (/cadena|sprocket|arrastre|correa cvt/.test(n)) return moto ? ['drive'] : [];
  if (/embrague/.test(n)) return moto ? [] : ['clutch'];
  if (category === 'frenos' || /freno|pastilla|disco/.test(n)) {
    return moto ? axle(n, ['brake_front'], ['brake_rear']) : axle(n, ['brake_fl', 'brake_fr'], ['brake_rl', 'brake_rr']);
  }
  if (category === 'llantas' || /llanta/.test(n)) {
    return moto ? axle(n, ['tire_front'], ['tire_rear']) : axle(n, ['tire_fl', 'tire_fr'], ['tire_rl', 'tire_rr']);
  }
  if (category === 'suspension' || /amortiguador/.test(n)) {
    return moto ? axle(n, ['fork'], ['shock_rear']) : axle(n, ['suspension_front'], ['suspension_rear']);
  }
  return [];
}

/**
 * Repuestos propios de maquinaria amarilla. Va antes de las reglas generales porque
 * "Aceite hidraulico" no es el aceite de motor y "Cuchillas" no es un freno.
 * Devuelve undefined para que el resto (filtros, bateria, llantas) siga la regla comun.
 */
function machinerySlots(n: string): PartSlotId[] | undefined {
  if (/tambor|vibrator|raspador/.test(n)) return ['drum'];
  if (/hidraul/.test(n)) return /cilindro|sello|reten/.test(n) ? ['hydraulic_cylinders'] : ['hydraulic_oil'];
  if (/oruga|zapata|cadena|rueda guia|sprocket|segmento/.test(n)) return ['track_left', 'track_right'];
  if (/diente|balde|cucharon|cuchara/.test(n)) return ['bucket'];
  if (/escarific|ripper/.test(n)) return ['ripper'];
  if (/cuchilla|hoja|esquinero|cantonera|vertedera/.test(n)) return ['blade'];
  if (/pasador|buje|articulacion/.test(n)) return /brazos/.test(n) ? ['loader_arms'] : ['boom', 'arm'];
  if (/tornamesa|giro/.test(n)) return ['swing'];
  if (/mandos? final|reductor|tandem/.test(n)) return ['final_drive'];
  if (/transmision|convertidor/.test(n)) return ['transmission'];
  if (/freno/.test(n)) return [];
  return undefined;
}

/** Categoria de anuncios que corresponde a una ranura (para el slot 'part_context'). */
export function categoryOfSlot(id: PartSlotId): PartCategory | undefined {
  return BY_ID.get(id)?.category;
}
