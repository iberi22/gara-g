/**
 * mock.ts — Snapshot de demostracion del garage. Lo usa la UI cuando no hay API
 * (dev, demo publica, primera carga sin red) y los tests de la UI. Los numeros son
 * coherentes entre si (salud ↔ km desde el ultimo cambio ↔ compromisos).
 */
import type { Commitment, GarageSnapshot, GarageVehicle, Indicator, PartState } from './contracts';
import { LITERS_PER_GALLON, MARKET, documentKindLabel, formatMoney } from '../lib/market';

/**
 * Consumo del mock en la unidad del mercado. El valor se escribe en km/L (unidad de Chile)
 * y se convierte si el mercado activo mide en galones.
 */
const eff = (kmPerLiter: number): string =>
  MARKET.volumeUnit === 'L'
    ? String(Math.round(kmPerLiter))
    : String(Math.round(kmPerLiter * LITERS_PER_GALLON));
/** Etiqueta del documento obligatorio en el vocabulario del mercado (SOAP / Revisión Técnica). */
const docLabel = (kind: string) => documentKindLabel(kind, MARKET);
/** Documentos de la demo del HUD, con su nombre chileno. */
const SOAP = docLabel('SOAT');
const RT = docLabel('Tecnomecánica');

const ind = (id: string, label: string, value: string, tone: Indicator['tone'], extra: Partial<Indicator> = {}): Indicator => ({
  id,
  label,
  value,
  tone,
  ...extra,
});

const part = (slotId: string, label: string, category: PartState['category'], healthPct: number | null, extra: Partial<PartState> = {}): PartState => ({
  slotId,
  label,
  category,
  healthPct,
  status: healthPct === null ? 'unknown' : healthPct <= 0 ? 'overdue' : healthPct < 15 ? 'critical' : healthPct < 35 ? 'warn' : 'ok',
  ...extra,
});

const commit = (vehicleId: string, n: number, title: string, urgency: Commitment['urgency'], extra: Partial<Commitment> = {}): Commitment => ({
  id: `${vehicleId}-c${n}`,
  vehicleId,
  kind: 'part_change',
  title,
  urgency,
  status: 'pending',
  source: 'catalog',
  ...extra,
});

const moto1: GarageVehicle = {
  id: 'mock-moto-1',
  plate: 'ABC12F',
  vin: 'ZZZMOCK0MOT000001',
  name: 'Yamaha FZ16',
  make: 'Yamaha',
  model: 'FZ16',
  year: 2021,
  status: 'active',
  usageUnit: 'km',
  odometerKm: 28450,
  overallHealthPct: 71,
  version: { key: 'yamaha-fz16-2018-2024', make: 'Yamaha', model: 'FZ16', yearFrom: 2018, yearTo: 2024, label: 'Yamaha FZ16 (2018–2024)' },
  spec: {
    family: 'moto',
    body: 'naked',
    dims: { lengthMm: 1990, widthMm: 770, heightMm: 1045, wheelbaseMm: 1330, seatHeightMm: 790 },
    tireFront: { widthMm: 100, aspectPct: 80, rimIn: 17 },
    tireRear: { widthMm: 140, aspectPct: 60, rimIn: 17 },
    paint: { baseColor: '#1f4fd1', finish: 'metallic', accentColor: '#d9dde2' },
  },
  indicators: {
    left: [
      ind('health', 'Salud general', '71', 'ok', { unit: '%', progress: 0.71 }),
      ind('odo', 'Odómetro', '28.450', 'neutral', { unit: 'km' }),
      ind('next', 'Próximo cambio', '−350', 'critical', { unit: 'km', hint: 'Aceite vencido' }),
      ind('docs', SOAP, '12', 'warn', { unit: 'días', progress: 12 / 365 }),
    ],
    right: [
      ind('eff', 'Consumo', eff(31), 'ok', { unit: MARKET.efficiencyUnit }),
      ind('cost', 'Gasto del mes', formatMoney(186000, MARKET), 'neutral'),
      ind('alerts', 'Alertas', '1', 'warn'),
      ind('link', 'APK', 'En línea', 'ok', { hint: 'Última señal hace 20 s' }),
    ],
  },
  parts: [
    part('engine_oil', 'Aceite moto 10W-40', 'liquido', 0, { lifeKm: 3000, kmSinceService: 3350, nextDueKm: 28100, estCostCOP: 45000 }),
    part('drive', 'Cadena + sprocket', 'transmision', 22, { lifeKm: 20000, kmSinceService: 15600, nextDueKm: 32850, estCostCOP: 180000 }),
    part('brake_front', 'Pastillas freno delantero', 'frenos', 31, { lifeKm: 12000, kmSinceService: 8280, estCostCOP: 60000 }),
    part('brake_rear', 'Bandas freno trasero', 'frenos', 64, { lifeKm: 15000, kmSinceService: 5400, estCostCOP: 40000 }),
    part('tire_front', 'Llanta delantera', 'llantas', 58, { lifeKm: 20000, kmSinceService: 8400, estCostCOP: 190000 }),
    part('tire_rear', 'Llanta trasera', 'llantas', 34, { lifeKm: 15000, kmSinceService: 9900, estCostCOP: 240000 }),
    part('spark_plugs', 'Bujía', 'motor', 80, { lifeKm: 10000, kmSinceService: 2000, estCostCOP: 25000 }),
    part('air_filter', 'Filtro de aire', 'filtro', 55, { lifeKm: 12000, kmSinceService: 5400, estCostCOP: 35000 }),
    part('battery', 'Batería', 'electrico', null),
    part('fork', 'Barras de suspensión', 'suspension', 90),
    part('shock_rear', 'Amortiguador trasero', 'suspension', 88),
  ],
  commitments: [
    commit('mock-moto-1', 1, 'Cambio de aceite 10W-40', 'overdue', { slotId: 'engine_oil', remainingKm: -350, dueKm: 28100, estCostCOP: 45000 }),
    commit('mock-moto-1', 2, `Renovar ${SOAP}`, 'soon', { kind: 'document', source: 'document', remainingDays: 12 }),
    commit('mock-moto-1', 3, 'Kit de arrastre', 'planned', { slotId: 'drive', remainingKm: 4400, dueKm: 32850, estCostCOP: 180000 }),
  ],
};

const moto2: GarageVehicle = {
  ...moto1,
  id: 'mock-moto-2',
  plate: 'XYZ34G',
  vin: 'ZZZMOCK0MOT000002',
  name: 'Yamaha NMAX 155',
  model: 'NMAX',
  year: 2023,
  odometerKm: 9100,
  overallHealthPct: 92,
  version: { key: 'yamaha-nmax-2021-2024', make: 'Yamaha', model: 'NMAX', yearFrom: 2021, yearTo: 2024, label: 'Yamaha NMAX (2021–2024)' },
  spec: {
    family: 'moto',
    body: 'scooter',
    dims: { lengthMm: 1935, widthMm: 740, heightMm: 1160, wheelbaseMm: 1340, seatHeightMm: 765 },
    tireFront: { widthMm: 110, aspectPct: 70, rimIn: 13 },
    tireRear: { widthMm: 130, aspectPct: 70, rimIn: 13 },
    paint: { baseColor: '#e9ecef', finish: 'pearl', accentColor: '#2b2d31' },
  },
  indicators: {
    left: [
      ind('health', 'Salud general', '92', 'ok', { unit: '%', progress: 0.92 }),
      ind('odo', 'Odómetro', '9.100', 'neutral', { unit: 'km' }),
      ind('next', 'Próximo cambio', '900', 'ok', { unit: 'km' }),
      ind('docs', SOAP, '210', 'ok', { unit: 'días', progress: 210 / 365 }),
    ],
    right: [
      ind('eff', 'Consumo', eff(33), 'ok', { unit: MARKET.efficiencyUnit }),
      ind('cost', 'Gasto del mes', formatMoney(62000, MARKET), 'neutral'),
      ind('alerts', 'Alertas', '0', 'ok'),
      ind('link', 'APK', 'Sin señal', 'neutral', { hint: 'Última señal hace 3 días' }),
    ],
  },
  parts: moto1.parts.map((p) => ({ ...p, healthPct: p.healthPct === null ? null : Math.min(100, p.healthPct + 40), status: 'ok' })),
  commitments: [commit('mock-moto-2', 1, 'Cambio de aceite', 'planned', { slotId: 'engine_oil', remainingKm: 900 })],
};

const car1: GarageVehicle = {
  id: 'mock-car-1',
  plate: 'GHK123',
  vin: 'ZZZMOCK0CAR000001',
  name: 'Toyota Corolla',
  make: 'Toyota',
  model: 'Corolla',
  year: 2020,
  status: 'active',
  usageUnit: 'km',
  odometerKm: 64210,
  overallHealthPct: 63,
  version: { key: 'toyota-corolla-2019-2024', make: 'Toyota', model: 'Corolla', yearFrom: 2019, yearTo: 2024, label: 'Toyota Corolla (2019–2024)' },
  spec: {
    family: 'car',
    body: 'sedan',
    dims: { lengthMm: 4630, widthMm: 1780, heightMm: 1435, wheelbaseMm: 2700, trackFrontMm: 1531, trackRearMm: 1544 },
    tireFront: { widthMm: 205, aspectPct: 55, rimIn: 16 },
    tireRear: { widthMm: 205, aspectPct: 55, rimIn: 16 },
    paint: { baseColor: '#8a1c22', finish: 'metallic' },
  },
  indicators: {
    left: [
      ind('health', 'Salud general', '63', 'warn', { unit: '%', progress: 0.63 }),
      ind('odo', 'Odómetro', '64.210', 'neutral', { unit: 'km' }),
      ind('next', 'Próximo cambio', '1.200', 'warn', { unit: 'km', hint: 'Pastillas delanteras' }),
      ind('docs', RT, '45', 'ok', { unit: 'días', progress: 45 / 365 }),
    ],
    right: [
      ind('eff', 'Consumo', eff(11), 'ok', { unit: MARKET.efficiencyUnit }),
      ind('cost', 'Gasto del mes', formatMoney(540000, MARKET), 'neutral'),
      ind('alerts', 'Alertas', '2', 'warn'),
      ind('link', 'OBD2', 'En línea', 'ok'),
    ],
  },
  parts: [
    part('brake_fl', 'Pastillas freno delantero', 'frenos', 12, { lifeKm: 40000, kmSinceService: 35200, nextDueKm: 65410, estCostCOP: 320000 }),
    part('brake_fr', 'Pastillas freno delantero', 'frenos', 12, { lifeKm: 40000, kmSinceService: 35200, nextDueKm: 65410, estCostCOP: 320000 }),
    part('brake_rl', 'Pastillas freno trasero', 'frenos', 48),
    part('brake_rr', 'Pastillas freno trasero', 'frenos', 48),
    part('engine_oil', 'Aceite 0W-20', 'liquido', 40, { lifeKm: 10000, kmSinceService: 6000 }),
    part('oil_filter', 'Filtro de aceite', 'filtro', 40),
    part('air_filter', 'Filtro de aire', 'filtro', 26),
    part('battery', 'Batería', 'electrico', 70),
    part('tire_fl', 'Llanta', 'llantas', 52),
    part('tire_fr', 'Llanta', 'llantas', 52),
    part('tire_rl', 'Llanta', 'llantas', 61),
    part('tire_rr', 'Llanta', 'llantas', 61),
  ],
  commitments: [
    commit('mock-car-1', 1, 'Pastillas freno delantero', 'soon', { slotId: 'brake_fl', remainingKm: 1200, estCostCOP: 320000 }),
    commit('mock-car-1', 2, 'Filtro de aire', 'soon', { slotId: 'air_filter', remainingKm: 3100 }),
    commit('mock-car-1', 3, RT, 'planned', { kind: 'inspection', source: 'document', remainingDays: 45 }),
  ],
};

const car2: GarageVehicle = {
  ...car1,
  id: 'mock-car-2',
  plate: 'JKL987',
  vin: 'ZZZMOCK0CAR000002',
  name: 'Toyota Hilux',
  model: 'Hilux',
  year: 2022,
  odometerKm: 41800,
  overallHealthPct: 84,
  version: { key: 'toyota-hilux-2016-2024', make: 'Toyota', model: 'Hilux', yearFrom: 2016, yearTo: 2024, label: 'Toyota Hilux (2016–2024)' },
  spec: {
    family: 'car',
    body: 'pickup',
    dims: { lengthMm: 5325, widthMm: 1855, heightMm: 1815, wheelbaseMm: 3085, trackFrontMm: 1540, trackRearMm: 1550 },
    tireFront: { widthMm: 265, aspectPct: 65, rimIn: 17 },
    tireRear: { widthMm: 265, aspectPct: 65, rimIn: 17 },
    paint: { baseColor: '#e8e8e6', finish: 'gloss', accentColor: '#2a2c30' },
  },
  parts: car1.parts.map((p) => ({ ...p, healthPct: p.healthPct === null ? null : Math.min(100, p.healthPct + 30), status: 'ok' })),
  commitments: [commit('mock-car-2', 1, 'Rotación de llantas', 'planned', { remainingKm: 2200 })],
};

export const MOCK_SNAPSHOT: GarageSnapshot = {
  vehicles: [moto1, car1, moto2, car2],
  generatedAt: '2026-10-01T12:00:00.000Z',
};
