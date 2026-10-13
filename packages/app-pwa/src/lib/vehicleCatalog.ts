/**
 * vehicleCatalog.ts — Catálogo vehicular local para LATAM.
 *
 * Contiene datos de marcas/modelos/años/fechas técnicas y repuestos comunes.
 * NO usa APIs externas — todo es estático para que funcione offline-first
 * en la PWA (Pages estáticas + Service Worker).
 *
 * Esquema de cada modelo:
 *   - make: marca
 *   - model: modelo
 *   - type: ver VehicleType (livianos, camiones y maquinaria amarilla)
 *   - usageUnit: 'km' (por defecto) u 'h' (maquinaria: horas de motor, horometro).
 *     TODOS los intervalos del modelo (revisionPeriodKm, oilChangeKm, tireRotationKm y
 *     commonParts[].lifeKm) van en esa unidad: en una excavadora "lifeKm: 500" son 500 h.
 *     Se mantiene el nombre del campo para que la salud de piezas sea un solo calculo.
 *   - yearsAvailable: años de fabricación comunes
 *   - soatDefaultCOP / tecnoManualCOP / avgCostCOP: costos anuales aproximados de los
 *     documentos obligatorios y de cada repuesto. El sufijo `COP` es el NOMBRE del campo
 *     (renombrarlo rompe el JSON serializado que consume el cliente): el valor se muestra
 *     con la moneda del mercado activo, ver `formatMoney` de lib/market.ts.
 *   - revisionPeriodKm: cada cuántos km toca revisión
 *   - oilChangeKm: cada cuántos km toca cambio de aceite
 *   - tireRotationKm: cada cuántos km toca rotación de llantas
 *   - commonParts: repuestos comunes con vida útil esperada en km
 *   - fuelType: 'gasoline' | 'diesel' | 'electric' | 'hybrid' | 'gas'
 */

import { MARKET, formatMoney, type MarketConfig } from './market';

export type VehicleType =
  | 'sedan'
  | 'suv'
  | 'pickup'
  | 'van'
  | 'camion'
  | 'estacas'
  | 'volqueta'
  | 'tractomula'
  | 'moto'
  | 'excavadora'
  | 'retroexcavadora'
  | 'cargador'
  | 'bulldozer'
  | 'motoniveladora'
  | 'vibrocompactador';

/** Unidad del contador de uso de un vehiculo. */
export type UsageUnit = 'km' | 'h';

/** Tipos de maquinaria amarilla: se mantienen por horas de motor (horometro). */
export const MACHINERY_TYPES: readonly VehicleType[] = [
  'excavadora',
  'retroexcavadora',
  'cargador',
  'bulldozer',
  'motoniveladora',
  'vibrocompactador',
];

/** Etiquetas para selects y tablas, en el orden en que se ofrecen. */
export const VEHICLE_TYPE_LABELS: ReadonlyArray<{ value: VehicleType; label: string; group: string }> = [
  { value: 'moto', label: 'Moto', group: 'Livianos' },
  { value: 'sedan', label: 'Automovil / sedan', group: 'Livianos' },
  { value: 'suv', label: 'Campero / SUV', group: 'Livianos' },
  { value: 'pickup', label: 'Camioneta pickup', group: 'Livianos' },
  { value: 'van', label: 'Van / furgoneta', group: 'Livianos' },
  { value: 'camion', label: 'Camion furgon', group: 'Camiones' },
  { value: 'estacas', label: 'Camion de estacas', group: 'Camiones' },
  { value: 'volqueta', label: 'Volqueta', group: 'Camiones' },
  { value: 'tractomula', label: 'Tractomula', group: 'Camiones' },
  { value: 'excavadora', label: 'Excavadora', group: 'Maquinaria amarilla' },
  { value: 'retroexcavadora', label: 'Retroexcavadora', group: 'Maquinaria amarilla' },
  { value: 'cargador', label: 'Cargador frontal', group: 'Maquinaria amarilla' },
  { value: 'bulldozer', label: 'Bulldozer', group: 'Maquinaria amarilla' },
  { value: 'motoniveladora', label: 'Motoniveladora', group: 'Maquinaria amarilla' },
  { value: 'vibrocompactador', label: 'Vibrocompactador', group: 'Maquinaria amarilla' },
];

export function isMachineryType(type: string | undefined): boolean {
  return MACHINERY_TYPES.includes(normalizeVehicleType(type) as VehicleType);
}

export function usageUnitOfType(type: string | undefined): UsageUnit {
  return isMachineryType(type) ? 'h' : 'km';
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Tipo del catalogo a partir de lo que haya guardado (los datos viejos traen texto libre:
 * 'Camión', 'camioneta', 'Sedán', 'auto'). Devuelve undefined si no se reconoce.
 */
export function normalizeVehicleType(raw: string | undefined): VehicleType | undefined {
  if (!raw) return undefined;
  const t = fold(raw).replace(/[\s_-]+/g, '');
  const known = VEHICLE_TYPE_LABELS.find((v) => v.value === t);
  if (known) return known.value;
  const alias: Record<string, VehicleType> = {
    auto: 'sedan',
    automovil: 'sedan',
    carro: 'sedan',
    campero: 'suv',
    camioneta: 'pickup',
    furgoneta: 'van',
    bus: 'van',
    buseta: 'van',
    furgon: 'camion',
    camionfurgon: 'camion',
    camiondeestacas: 'estacas',
    tracto: 'tractomula',
    tractocamion: 'tractomula',
    mula: 'tractomula',
    retro: 'retroexcavadora',
    cargadorfrontal: 'cargador',
    minicargador: 'cargador',
    buldozer: 'bulldozer',
    dozer: 'bulldozer',
    vibro: 'vibrocompactador',
    compactador: 'vibrocompactador',
    rodillo: 'vibrocompactador',
    motocicleta: 'moto',
  };
  return alias[t];
}

export type FuelType = 'gasoline' | 'diesel' | 'electric' | 'hybrid' | 'gas';

export interface CommonPart {
  name: string;
  category:
    | 'filtro'
    | 'liquido'
    | 'frenos'
    | 'suspension'
    | 'motor'
    | 'electrico'
    | 'llantas'
    | 'transmision'
    | 'hidraulico'
    | 'implemento'
    | 'rodaje';
  /** Vida util esperada en la unidad del modelo (km, u horas si usageUnit = 'h'). */
  lifeKm: number;
  avgCostCOP: number; // costo promedio de repuesto + mano de obra
}

export interface VehicleModel {
  make: string;
  model: string;
  type: VehicleType;
  yearsAvailable: number[];
  fuelType: FuelType;
  engineCC: number;
  powerHP: number;
  payloadKg?: number; // para camiones
  /** 'h' en maquinaria: todos los intervalos de este modelo van en horas de motor. */
  usageUnit?: UsageUnit;
  soatDefaultCOP: number;
  tecnoManualCOP: number;
  revisionPeriodKm: number;
  oilChangeKm: number;
  tireRotationKm: number;
  commonParts: CommonPart[];
}

export interface VehicleMake {
  name: string;
  countryOrigin: string;
  models: VehicleModel[];
}

export const VEHICLE_CATALOG: VehicleMake[] = [
  {
    name: 'Toyota',
    countryOrigin: 'Japón',
    models: [
      {
        make: 'Toyota', model: 'Hilux', type: 'pickup',
        yearsAvailable: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 2800, powerHP: 204, payloadKg: 1100,
        soatDefaultCOP: 1450000, tecnoManualCOP: 350000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 10000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 45000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 20000, avgCostCOP: 60000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 30000, avgCostCOP: 85000 },
          { name: 'Aceite motor 5W-30 sintético', category: 'liquido', lifeKm: 10000, avgCostCOP: 180000 },
          { name: 'Pastillas freno delantero', category: 'frenos', lifeKm: 40000, avgCostCOP: 320000 },
          { name: 'Discos freno delantero (par)', category: 'frenos', lifeKm: 80000, avgCostCOP: 580000 },
          { name: 'Amortiguador (par trasero)', category: 'suspension', lifeKm: 60000, avgCostCOP: 480000 },
          { name: 'Kit embrague', category: 'transmision', lifeKm: 120000, avgCostCOP: 1200000 },
          { name: 'Batería 12V', category: 'electrico', lifeKm: 50000, avgCostCOP: 380000 },
          { name: 'Llantas (4u)', category: 'llantas', lifeKm: 50000, avgCostCOP: 2400000 },
        ],
      },
      {
        make: 'Toyota', model: 'Land Cruiser', type: 'suv',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 4500, powerHP: 232,
        soatDefaultCOP: 1850000, tecnoManualCOP: 380000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 10000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 55000 },
          { name: 'Aceite motor 5W-30', category: 'liquido', lifeKm: 10000, avgCostCOP: 220000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 20000, avgCostCOP: 75000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 380000 },
          { name: 'Amortiguadores (juego)', category: 'suspension', lifeKm: 70000, avgCostCOP: 1800000 },
        ],
      },
      {
        make: 'Toyota', model: 'Corolla', type: 'sedan',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 1800, powerHP: 140,
        soatDefaultCOP: 850000, tecnoManualCOP: 280000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 35000 },
          { name: 'Aceite 0W-20 sintético', category: 'liquido', lifeKm: 10000, avgCostCOP: 150000 },
          { name: 'Pastillas freno delantero', category: 'frenos', lifeKm: 45000, avgCostCOP: 280000 },
          { name: 'Batería', category: 'electrico', lifeKm: 50000, avgCostCOP: 320000 },
          { name: 'Bujías (juego 4u)', category: 'motor', lifeKm: 100000, avgCostCOP: 220000 },
        ],
      },
      {
        make: 'Toyota', model: 'Prado', type: 'suv',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 2800, powerHP: 201,
        soatDefaultCOP: 1620000, tecnoManualCOP: 360000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 10000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 50000 },
          { name: 'Aceite motor 5W-30', category: 'liquido', lifeKm: 10000, avgCostCOP: 200000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 350000 },
        ],
      },
    ],
  },
  {
    name: 'Chevrolet',
    countryOrigin: 'Estados Unidos',
    models: [
      {
        make: 'Chevrolet', model: 'NPR', type: 'camion',
        yearsAvailable: [2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 4500, powerHP: 150, payloadKg: 3500,
        soatDefaultCOP: 1850000, tecnoManualCOP: 420000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 55000 },
          { name: 'Aceite 15W-40 diesel', category: 'liquido', lifeKm: 10000, avgCostCOP: 180000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 20000, avgCostCOP: 80000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 30000, avgCostCOP: 95000 },
          { name: 'Pastillas freno (camión)', category: 'frenos', lifeKm: 35000, avgCostCOP: 480000 },
          { name: 'Batería camión', category: 'electrico', lifeKm: 50000, avgCostCOP: 620000 },
          { name: 'Llantas camión (4u)', category: 'llantas', lifeKm: 60000, avgCostCOP: 3600000 },
          { name: 'Amortiguador pesado', category: 'suspension', lifeKm: 80000, avgCostCOP: 720000 },
        ],
      },
      {
        make: 'Chevrolet', model: 'D-Max', type: 'pickup',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 2500, powerHP: 163, payloadKg: 1050,
        soatDefaultCOP: 1320000, tecnoManualCOP: 340000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 10000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 45000 },
          { name: 'Aceite 5W-30', category: 'liquido', lifeKm: 10000, avgCostCOP: 170000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 20000, avgCostCOP: 65000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 320000 },
        ],
      },
      {
        make: 'Chevrolet', model: 'Sail', type: 'sedan',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023],
        fuelType: 'gasoline', engineCC: 1400, powerHP: 98,
        soatDefaultCOP: 720000, tecnoManualCOP: 250000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 32000 },
          { name: 'Aceite 5W-30', category: 'liquido', lifeKm: 10000, avgCostCOP: 130000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 240000 },
        ],
      },
      {
        make: 'Chevrolet', model: 'Tracker', type: 'suv',
        yearsAvailable: [2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 1400, powerHP: 138,
        soatDefaultCOP: 980000, tecnoManualCOP: 290000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 35000 },
          { name: 'Aceite 5W-30', category: 'liquido', lifeKm: 10000, avgCostCOP: 140000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 280000 },
        ],
      },
    ],
  },
  {
    name: 'Renault',
    countryOrigin: 'Francia',
    models: [
      {
        make: 'Renault', model: 'Logan', type: 'sedan',
        yearsAvailable: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 1600, powerHP: 115,
        soatDefaultCOP: 680000, tecnoManualCOP: 240000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 30000 },
          { name: 'Aceite 5W-40', category: 'liquido', lifeKm: 10000, avgCostCOP: 125000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 230000 },
          { name: 'Bujías', category: 'motor', lifeKm: 60000, avgCostCOP: 95000 },
        ],
      },
      {
        make: 'Renault', model: 'Kangoo', type: 'van',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 1600, powerHP: 115, payloadKg: 800,
        soatDefaultCOP: 850000, tecnoManualCOP: 270000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 30000 },
          { name: 'Aceite 5W-40', category: 'liquido', lifeKm: 10000, avgCostCOP: 130000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 240000 },
        ],
      },
      {
        make: 'Renault', model: 'Duster', type: 'suv',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 1600, powerHP: 115,
        soatDefaultCOP: 920000, tecnoManualCOP: 290000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 32000 },
          { name: 'Aceite 5W-40', category: 'liquido', lifeKm: 10000, avgCostCOP: 135000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 250000 },
        ],
      },
    ],
  },
  {
    name: 'Ford',
    countryOrigin: 'Estados Unidos',
    models: [
      {
        make: 'Ford', model: 'Transit', type: 'van',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 2000, powerHP: 130, payloadKg: 1200,
        soatDefaultCOP: 1100000, tecnoManualCOP: 320000,
        revisionPeriodKm: 15000, oilChangeKm: 15000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 15000, avgCostCOP: 45000 },
          { name: 'Aceite 5W-30 diesel', category: 'liquido', lifeKm: 15000, avgCostCOP: 180000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 30000, avgCostCOP: 70000 },
          { name: 'Pastillas freno (van)', category: 'frenos', lifeKm: 45000, avgCostCOP: 320000 },
          { name: 'Batería', category: 'electrico', lifeKm: 60000, avgCostCOP: 380000 },
        ],
      },
      {
        make: 'Ford', model: 'Ranger', type: 'pickup',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 3200, powerHP: 200, payloadKg: 1100,
        soatDefaultCOP: 1480000, tecnoManualCOP: 360000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 10000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 48000 },
          { name: 'Aceite 5W-30', category: 'liquido', lifeKm: 10000, avgCostCOP: 185000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 340000 },
        ],
      },
    ],
  },
  {
    name: 'Nissan',
    countryOrigin: 'Japón',
    models: [
      {
        make: 'Nissan', model: 'Frontier', type: 'pickup',
        yearsAvailable: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 2500, powerHP: 188, payloadKg: 1100,
        soatDefaultCOP: 1380000, tecnoManualCOP: 340000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 10000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 45000 },
          { name: 'Aceite 5W-30', category: 'liquido', lifeKm: 10000, avgCostCOP: 175000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 320000 },
        ],
      },
      {
        make: 'Nissan', model: 'Versa', type: 'sedan',
        yearsAvailable: [2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 1600, powerHP: 118,
        soatDefaultCOP: 720000, tecnoManualCOP: 240000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 30000 },
          { name: 'Aceite 0W-20', category: 'liquido', lifeKm: 10000, avgCostCOP: 130000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 250000 },
        ],
      },
    ],
  },
  {
    name: 'Mercedes-Benz',
    countryOrigin: 'Alemania',
    models: [
      {
        make: 'Mercedes-Benz', model: 'Sprinter', type: 'van',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 2200, powerHP: 163, payloadKg: 1500,
        soatDefaultCOP: 1450000, tecnoManualCOP: 380000,
        revisionPeriodKm: 15000, oilChangeKm: 15000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 15000, avgCostCOP: 65000 },
          { name: 'Aceite 5W-30 MB', category: 'liquido', lifeKm: 15000, avgCostCOP: 280000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 30000, avgCostCOP: 95000 },
          { name: 'Pastillas freno premium', category: 'frenos', lifeKm: 50000, avgCostCOP: 480000 },
          { name: 'Batería AGM', category: 'electrico', lifeKm: 60000, avgCostCOP: 580000 },
        ],
      },
    ],
  },
  {
    name: 'Volvo',
    countryOrigin: 'Suecia',
    models: [
      {
        make: 'Volvo', model: 'FH16', type: 'tractomula',
        yearsAvailable: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 16000, powerHP: 750, payloadKg: 40000,
        soatDefaultCOP: 3200000, tecnoManualCOP: 680000,
        revisionPeriodKm: 15000, oilChangeKm: 15000, tireRotationKm: 20000,
        commonParts: [
          { name: 'Filtro de aceite pesado', category: 'filtro', lifeKm: 15000, avgCostCOP: 95000 },
          { name: 'Aceite 5W-30 sintético pesado', category: 'liquido', lifeKm: 15000, avgCostCOP: 380000 },
          { name: 'Filtro de aire pesado', category: 'filtro', lifeKm: 30000, avgCostCOP: 145000 },
          { name: 'Filtro de combustible pesado', category: 'filtro', lifeKm: 30000, avgCostCOP: 165000 },
          { name: 'Pastillas freno tractomula', category: 'frenos', lifeKm: 40000, avgCostCOP: 850000 },
          { name: 'Llantas tractomula (6u)', category: 'llantas', lifeKm: 80000, avgCostCOP: 6800000 },
          { name: 'Batería tractomula (2u)', category: 'electrico', lifeKm: 60000, avgCostCOP: 1400000 },
          { name: 'Amortiguador pesado (par)', category: 'suspension', lifeKm: 100000, avgCostCOP: 980000 },
        ],
      },
    ],
  },
  {
    name: 'Kenworth',
    countryOrigin: 'Estados Unidos',
    models: [
      {
        make: 'Kenworth', model: 'T800', type: 'tractomula',
        yearsAvailable: [2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 15000, powerHP: 600, payloadKg: 35000,
        soatDefaultCOP: 2900000, tecnoManualCOP: 620000,
        revisionPeriodKm: 15000, oilChangeKm: 15000, tireRotationKm: 20000,
        commonParts: [
          { name: 'Filtro de aceite pesado', category: 'filtro', lifeKm: 15000, avgCostCOP: 88000 },
          { name: 'Aceite 15W-40 pesado', category: 'liquido', lifeKm: 15000, avgCostCOP: 360000 },
          { name: 'Pastillas freno tractomula', category: 'frenos', lifeKm: 40000, avgCostCOP: 820000 },
          { name: 'Llantas tractomula (6u)', category: 'llantas', lifeKm: 80000, avgCostCOP: 6500000 },
        ],
      },
      {
        make: 'Kenworth', model: 'T800 Volqueta', type: 'volqueta',
        yearsAvailable: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 12900, powerHP: 450, payloadKg: 20000,
        soatDefaultCOP: 2700000, tecnoManualCOP: 600000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 20000,
        commonParts: [
          { name: 'Filtro de aceite pesado', category: 'filtro', lifeKm: 10000, avgCostCOP: 88000 },
          { name: 'Aceite 15W-40 pesado', category: 'liquido', lifeKm: 10000, avgCostCOP: 360000 },
          { name: 'Filtro de combustible pesado', category: 'filtro', lifeKm: 20000, avgCostCOP: 130000 },
          { name: 'Filtro de aire pesado', category: 'filtro', lifeKm: 30000, avgCostCOP: 280000 },
          { name: 'Bandas freno delanteras', category: 'frenos', lifeKm: 35000, avgCostCOP: 820000 },
          { name: 'Bandas freno traseras', category: 'frenos', lifeKm: 30000, avgCostCOP: 1500000 },
          { name: 'Llantas traseras volqueta (8u)', category: 'llantas', lifeKm: 60000, avgCostCOP: 9600000 },
          { name: 'Sellos del cilindro de volteo', category: 'hidraulico', lifeKm: 60000, avgCostCOP: 980000 },
          { name: 'Baterias 12V pesadas (2u)', category: 'electrico', lifeKm: 60000, avgCostCOP: 1300000 },
        ],
      },
    ],
  },
  {
    name: 'Scania',
    countryOrigin: 'Suecia',
    models: [
      {
        make: 'Scania', model: 'R450', type: 'tractomula',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 13000, powerHP: 450, payloadKg: 40000,
        soatDefaultCOP: 3100000, tecnoManualCOP: 650000,
        revisionPeriodKm: 15000, oilChangeKm: 15000, tireRotationKm: 20000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 15000, avgCostCOP: 92000 },
          { name: 'Aceite Scania', category: 'liquido', lifeKm: 15000, avgCostCOP: 390000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 880000 },
          { name: 'Llantas tractomula (6u)', category: 'llantas', lifeKm: 80000, avgCostCOP: 7000000 },
        ],
      },
    ],
  },
  {
    name: 'DAF',
    countryOrigin: 'Países Bajos',
    models: [
      {
        make: 'DAF', model: 'XF', type: 'tractomula',
        yearsAvailable: [2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 13000, powerHP: 530, payloadKg: 42000,
        soatDefaultCOP: 3300000, tecnoManualCOP: 700000,
        revisionPeriodKm: 15000, oilChangeKm: 15000, tireRotationKm: 20000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 15000, avgCostCOP: 95000 },
          { name: 'Aceite DAF', category: 'liquido', lifeKm: 15000, avgCostCOP: 400000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 40000, avgCostCOP: 900000 },
        ],
      },
    ],
  },
  {
    name: 'Yamaha',
    countryOrigin: 'Japón',
    models: [
      {
        make: 'Yamaha', model: 'FZ16', type: 'moto',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 150, powerHP: 14,
        soatDefaultCOP: 220000, tecnoManualCOP: 95000,
        revisionPeriodKm: 4000, oilChangeKm: 4000, tireRotationKm: 8000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 4000, avgCostCOP: 18000 },
          { name: 'Aceite 10W-40 moto', category: 'liquido', lifeKm: 4000, avgCostCOP: 38000 },
          { name: 'Bujía', category: 'motor', lifeKm: 12000, avgCostCOP: 25000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 15000, avgCostCOP: 85000 },
          { name: 'Llantas (2u)', category: 'llantas', lifeKm: 25000, avgCostCOP: 320000 },
          { name: 'Cadena + sprocket', category: 'transmision', lifeKm: 30000, avgCostCOP: 180000 },
        ],
      },
      {
        make: 'Yamaha', model: 'NMAX', type: 'moto',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 155, powerHP: 15,
        soatDefaultCOP: 180000, tecnoManualCOP: 85000,
        revisionPeriodKm: 4000, oilChangeKm: 4000, tireRotationKm: 8000,
        commonParts: [
          { name: 'Aceite moto', category: 'liquido', lifeKm: 4000, avgCostCOP: 38000 },
          { name: 'Bujía', category: 'motor', lifeKm: 12000, avgCostCOP: 22000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 12000, avgCostCOP: 75000 },
        ],
      },
    ],
  },
  {
    name: 'Honda',
    countryOrigin: 'Japón',
    models: [
      {
        make: 'Honda', model: 'CB 160F', type: 'moto',
        yearsAvailable: [2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'gasoline', engineCC: 160, powerHP: 15,
        soatDefaultCOP: 200000, tecnoManualCOP: 90000,
        revisionPeriodKm: 4000, oilChangeKm: 4000, tireRotationKm: 8000,
        commonParts: [
          { name: 'Aceite 10W-40', category: 'liquido', lifeKm: 4000, avgCostCOP: 38000 },
          { name: 'Bujía', category: 'motor', lifeKm: 12000, avgCostCOP: 22000 },
          { name: 'Pastillas freno', category: 'frenos', lifeKm: 15000, avgCostCOP: 85000 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Camiones de obra y maquinaria amarilla.
  //
  // Los intervalos de la maquinaria (usageUnit 'h') son los tipicos de los manuales de
  // operacion y mantenimiento de cada clase (aceite y filtros de motor cada 500 h, filtro
  // hidraulico cada 1 000 h, aceite hidraulico cada 3 000 h...). Cada equipo debe
  // ajustarse a SU manual; los costos son promedios aproximados (repuesto + mano
  // de obra), como en el resto del catalogo.
  // ---------------------------------------------------------------------------
  {
    name: 'International',
    countryOrigin: 'Estados Unidos',
    models: [
      {
        make: 'International', model: '7600 Volqueta', type: 'volqueta',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 12400, powerHP: 410, payloadKg: 18000,
        soatDefaultCOP: 2600000, tecnoManualCOP: 580000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 20000,
        commonParts: [
          { name: 'Filtro de aceite pesado', category: 'filtro', lifeKm: 10000, avgCostCOP: 85000 },
          { name: 'Aceite 15W-40 pesado', category: 'liquido', lifeKm: 10000, avgCostCOP: 340000 },
          { name: 'Filtro de combustible pesado', category: 'filtro', lifeKm: 20000, avgCostCOP: 120000 },
          { name: 'Filtro de aire pesado', category: 'filtro', lifeKm: 30000, avgCostCOP: 260000 },
          { name: 'Bandas freno delanteras', category: 'frenos', lifeKm: 35000, avgCostCOP: 780000 },
          { name: 'Bandas freno traseras', category: 'frenos', lifeKm: 30000, avgCostCOP: 1400000 },
          { name: 'Llantas traseras volqueta (8u)', category: 'llantas', lifeKm: 60000, avgCostCOP: 9200000 },
          { name: 'Sellos del cilindro de volteo', category: 'hidraulico', lifeKm: 60000, avgCostCOP: 950000 },
          { name: 'Baterias 12V pesadas (2u)', category: 'electrico', lifeKm: 60000, avgCostCOP: 1300000 },
        ],
      },
    ],
  },
  {
    name: 'Hino',
    countryOrigin: 'Japon',
    models: [
      {
        make: 'Hino', model: 'Serie 500 Estacas', type: 'estacas',
        yearsAvailable: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 7700, powerHP: 260, payloadKg: 10000,
        soatDefaultCOP: 1900000, tecnoManualCOP: 480000,
        revisionPeriodKm: 10000, oilChangeKm: 10000, tireRotationKm: 15000,
        commonParts: [
          { name: 'Filtro de aceite', category: 'filtro', lifeKm: 10000, avgCostCOP: 65000 },
          { name: 'Aceite 15W-40', category: 'liquido', lifeKm: 10000, avgCostCOP: 260000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 20000, avgCostCOP: 90000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 30000, avgCostCOP: 180000 },
          { name: 'Bandas freno delanteras', category: 'frenos', lifeKm: 40000, avgCostCOP: 520000 },
          { name: 'Llantas traseras (4u)', category: 'llantas', lifeKm: 60000, avgCostCOP: 3800000 },
          { name: 'Bateria 12V', category: 'electrico', lifeKm: 50000, avgCostCOP: 520000 },
        ],
      },
    ],
  },
  {
    name: 'Caterpillar',
    countryOrigin: 'Estados Unidos',
    models: [
      {
        make: 'Caterpillar', model: '320', type: 'excavadora', usageUnit: 'h',
        yearsAvailable: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 7010, powerHP: 162,
        soatDefaultCOP: 0, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 620000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 160000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 240000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 420000 },
          { name: 'Filtro hidraulico de retorno', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 380000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 3000, avgCostCOP: 4200000 },
          { name: 'Dientes del balde (juego)', category: 'implemento', lifeKm: 800, avgCostCOP: 1600000 },
          { name: 'Pasadores y bujes de la pluma', category: 'implemento', lifeKm: 4000, avgCostCOP: 3500000 },
          { name: 'Zapatas y cadena de oruga', category: 'rodaje', lifeKm: 5000, avgCostCOP: 38000000 },
          { name: 'Aceite de mandos finales', category: 'transmision', lifeKm: 2000, avgCostCOP: 520000 },
          { name: 'Baterias 12V (2u)', category: 'electrico', lifeKm: 4000, avgCostCOP: 1300000 },
        ],
      },
      {
        make: 'Caterpillar', model: '416', type: 'retroexcavadora', usageUnit: 'h',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 4400, powerHP: 87,
        soatDefaultCOP: 950000, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 380000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 110000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 160000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 260000 },
          { name: 'Filtro hidraulico', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 260000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 2000, avgCostCOP: 2100000 },
          { name: 'Dientes del balde de la retro', category: 'implemento', lifeKm: 600, avgCostCOP: 650000 },
          { name: 'Pasadores y bujes', category: 'implemento', lifeKm: 2000, avgCostCOP: 1900000 },
          { name: 'Llantas delanteras (2u)', category: 'llantas', lifeKm: 3000, avgCostCOP: 2600000 },
          { name: 'Llantas traseras (2u)', category: 'llantas', lifeKm: 4000, avgCostCOP: 6200000 },
          { name: 'Bateria 12V', category: 'electrico', lifeKm: 3000, avgCostCOP: 650000 },
        ],
      },
      {
        make: 'Caterpillar', model: '950', type: 'cargador', usageUnit: 'h',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 9300, powerHP: 225,
        soatDefaultCOP: 0, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 760000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 180000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 260000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 480000 },
          { name: 'Filtro hidraulico', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 420000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 3000, avgCostCOP: 4800000 },
          { name: 'Cuchilla y cantoneras del balde', category: 'implemento', lifeKm: 1000, avgCostCOP: 4600000 },
          { name: 'Pasadores y bujes de los brazos', category: 'implemento', lifeKm: 4000, avgCostCOP: 4200000 },
          { name: 'Llantas 23.5R25 (4u)', category: 'llantas', lifeKm: 4000, avgCostCOP: 36000000 },
          { name: 'Aceite de transmision', category: 'transmision', lifeKm: 2000, avgCostCOP: 1200000 },
          { name: 'Baterias 12V (2u)', category: 'electrico', lifeKm: 4000, avgCostCOP: 1300000 },
        ],
      },
      {
        make: 'Caterpillar', model: 'D6', type: 'bulldozer', usageUnit: 'h',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 9300, powerHP: 215,
        soatDefaultCOP: 0, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 760000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 180000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 260000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 480000 },
          { name: 'Filtro hidraulico', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 420000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 4000, avgCostCOP: 3900000 },
          { name: 'Cuchillas y esquineros de la hoja', category: 'implemento', lifeKm: 1200, avgCostCOP: 7800000 },
          { name: 'Punta del escarificador', category: 'implemento', lifeKm: 400, avgCostCOP: 950000 },
          { name: 'Zapatas y cadena de oruga', category: 'rodaje', lifeKm: 4500, avgCostCOP: 52000000 },
          { name: 'Aceite de mandos finales', category: 'transmision', lifeKm: 2000, avgCostCOP: 900000 },
          { name: 'Baterias 12V (2u)', category: 'electrico', lifeKm: 4000, avgCostCOP: 1300000 },
        ],
      },
      {
        make: 'Caterpillar', model: '140', type: 'motoniveladora', usageUnit: 'h',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 9300, powerHP: 200,
        soatDefaultCOP: 950000, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 760000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 180000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 260000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 480000 },
          { name: 'Filtro hidraulico', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 380000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 4000, avgCostCOP: 3200000 },
          { name: 'Cuchillas de la vertedera', category: 'implemento', lifeKm: 600, avgCostCOP: 3600000 },
          { name: 'Llantas 14.00R24 (6u)', category: 'llantas', lifeKm: 4000, avgCostCOP: 30000000 },
          { name: 'Aceite del tandem', category: 'transmision', lifeKm: 2000, avgCostCOP: 1100000 },
          { name: 'Baterias 12V (2u)', category: 'electrico', lifeKm: 4000, avgCostCOP: 1300000 },
        ],
      },
    ],
  },
  {
    name: 'Komatsu',
    countryOrigin: 'Japon',
    models: [
      {
        make: 'Komatsu', model: 'PC200', type: 'excavadora', usageUnit: 'h',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 6690, powerHP: 155,
        soatDefaultCOP: 0, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 600000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 150000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 230000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 400000 },
          { name: 'Filtro hidraulico', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 360000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 5000, avgCostCOP: 4100000 },
          { name: 'Dientes del balde (juego)', category: 'implemento', lifeKm: 800, avgCostCOP: 1500000 },
          { name: 'Zapatas y cadena de oruga', category: 'rodaje', lifeKm: 5000, avgCostCOP: 36000000 },
          { name: 'Baterias 12V (2u)', category: 'electrico', lifeKm: 4000, avgCostCOP: 1300000 },
        ],
      },
    ],
  },
  {
    name: 'JCB',
    countryOrigin: 'Reino Unido',
    models: [
      {
        make: 'JCB', model: '3CX', type: 'retroexcavadora', usageUnit: 'h',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
        fuelType: 'diesel', engineCC: 4400, powerHP: 92,
        soatDefaultCOP: 950000, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 360000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 100000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 150000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 240000 },
          { name: 'Filtro hidraulico', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 240000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 2000, avgCostCOP: 2000000 },
          { name: 'Dientes del balde de la retro', category: 'implemento', lifeKm: 600, avgCostCOP: 600000 },
          { name: 'Pasadores y bujes', category: 'implemento', lifeKm: 2000, avgCostCOP: 1800000 },
          { name: 'Llantas delanteras (2u)', category: 'llantas', lifeKm: 3000, avgCostCOP: 2500000 },
          { name: 'Llantas traseras (2u)', category: 'llantas', lifeKm: 4000, avgCostCOP: 6000000 },
          { name: 'Bateria 12V', category: 'electrico', lifeKm: 3000, avgCostCOP: 650000 },
        ],
      },
    ],
  },
  {
    name: 'Dynapac',
    countryOrigin: 'Suecia',
    models: [
      {
        make: 'Dynapac', model: 'CA250', type: 'vibrocompactador', usageUnit: 'h',
        yearsAvailable: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        fuelType: 'diesel', engineCC: 4400, powerHP: 100,
        soatDefaultCOP: 0, tecnoManualCOP: 0,
        revisionPeriodKm: 500, oilChangeKm: 500, tireRotationKm: 0,
        commonParts: [
          { name: 'Aceite de motor 15W-40', category: 'liquido', lifeKm: 500, avgCostCOP: 340000 },
          { name: 'Filtro de aceite de motor', category: 'filtro', lifeKm: 500, avgCostCOP: 100000 },
          { name: 'Filtro de combustible', category: 'filtro', lifeKm: 500, avgCostCOP: 140000 },
          { name: 'Filtro de aire', category: 'filtro', lifeKm: 1000, avgCostCOP: 220000 },
          { name: 'Filtro hidraulico', category: 'hidraulico', lifeKm: 1000, avgCostCOP: 260000 },
          { name: 'Aceite hidraulico', category: 'hidraulico', lifeKm: 2000, avgCostCOP: 1800000 },
          { name: 'Aceite del tambor vibratorio', category: 'transmision', lifeKm: 1000, avgCostCOP: 420000 },
          { name: 'Raspadores del tambor', category: 'implemento', lifeKm: 1500, avgCostCOP: 480000 },
          { name: 'Llantas traseras (2u)', category: 'llantas', lifeKm: 4000, avgCostCOP: 9000000 },
          { name: 'Bateria 12V', category: 'electrico', lifeKm: 3000, avgCostCOP: 650000 },
        ],
      },
    ],
  },
];

// Helpers exportados

/**
 * Modelo del catalogo. Tolera mayusculas, tildes y la marca abreviada ("Mercedes" →
 * "Mercedes-Benz", "CAT" → "Caterpillar"): los datos viejos se escribieron a mano.
 */
export function findModel(make: string, model: string): VehicleModel | undefined {
  if (!make || !model) return undefined;
  const mk = fold(make);
  const md = fold(model);
  const alias: Record<string, string> = { cat: 'caterpillar', mercedes: 'mercedes-benz', kw: 'kenworth' };
  const target = alias[mk] ?? mk;
  const m =
    VEHICLE_CATALOG.find((x) => fold(x.name) === target) ??
    VEHICLE_CATALOG.find((x) => fold(x.name).startsWith(target) || target.startsWith(fold(x.name)));
  return m?.models.find((x) => fold(x.model) === md);
}

/** Unidad de uso de un modelo del catalogo (km si no lo declara). */
export function usageUnitOfModel(model: VehicleModel | undefined): UsageUnit {
  return model?.usageUnit ?? (model ? usageUnitOfType(model.type) : 'km');
}

export function getAllMakes(): string[] {
  return VEHICLE_CATALOG.map((m) => m.name).sort();
}

export function getModelsForMake(make: string): string[] {
  const m = VEHICLE_CATALOG.find((mk) => mk.name === make);
  return m ? m.models.map((md) => md.model) : [];
}

export function getYearsForModel(make: string, model: string): number[] {
  const md = findModel(make, model);
  return md?.yearsAvailable || [];
}

export function calculateNextService(
  currentKm: number,
  intervalKm: number,
): { nextKm: number; kmRemaining: number; overdue: boolean } {
  const nextKm = Math.ceil(currentKm / intervalKm) * intervalKm + intervalKm;
  const kmRemaining = nextKm - currentKm;
  return {
    nextKm,
    kmRemaining,
    overdue: kmRemaining < 0,
  };
}

/**
 * Monto del catálogo en la moneda del mercado activo (CLP en Chile, sin decimales).
 * @deprecated el nombre dice COP porque nació en Colombia; usa `formatMoney` de lib/market.ts.
 */
export function formatCOP(value: number, market: MarketConfig = MARKET): string {
  return formatMoney(value, market);
}