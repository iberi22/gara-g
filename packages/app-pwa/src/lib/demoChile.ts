/**
 * demoChile.ts — Datos demo FICTICIOS de una flota chilena de camiones tolva (minería y
 * construcción, Región de Antofagasta). Tenant `flota-demo-chile`.
 *
 * Una sola fuente para tres consumidores:
 *   - scripts/seed-demo-chile.mjs: genera el SQL idempotente para D1 (staging / local).
 *   - /fleet/garage/flota-demo-chile: vista de solo lectura (si D1 no tiene el tenant,
 *     se pinta desde aqui mismo, sin escribir nada).
 *   - el garage en modo invitado: su vehiculo de ejemplo es el primer camion de esta flota.
 *
 * Todo es inventado a proposito: el cliente cargara sus datos reales despues.
 *   - Patentes en formato chileno `ABCD-12` con prefijo `ZZ`, una serie que el Registro
 *     Civil aun no emite, para no coincidir con un camion real.
 *   - RUT con digito verificador valido (modulo 11) pero en el rango 30.000.000+, por
 *     encima de los RUN emitidos a personas; los nombres llevan el apellido "Ejemplo".
 *   - Empresas, faenas y talleres con nombres genericos marcados como demo.
 *
 * Ids deterministas (`cl-<entidad>-NN`): volver a sembrar actualiza las mismas filas en vez
 * de duplicarlas. Las fechas se calculan contra `today`, para que la demo siempre tenga
 * documentos por vencer.
 *
 * Sin imports a proposito: el script de semilla lo carga con Node (type stripping) y no
 * pasa por Vite.
 */

export const CHILE_DEMO_INSTANCE_ID = 'flota-demo-chile';
export const CHILE_DEMO_FLEET_PATH = '/fleet/garage/flota-demo-chile';

export interface DemoRow {
  entity: 'fleet' | 'vehicle' | 'driver' | 'maintenance' | 'fuelLog' | 'document' | 'geofence' | 'alert';
  id: string;
  data: Record<string, unknown>;
}

const DAY = 86_400_000;
const LITERS_PER_GALLON = 3.785;
/** Precio de referencia del diesel en la demo (CLP por litro). Inventado, redondo. */
const DIESEL_CLP_PER_LITER = 1_050;

/** Digito verificador de un RUT chileno (modulo 11). */
export function rutDv(body: number): string {
  let sum = 0;
  let mul = 2;
  for (let n = body; n > 0; n = Math.floor(n / 10)) {
    sum += (n % 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

/** `30123456` -> `30.123.456-7`. */
export function formatRut(body: number): string {
  const s = String(body).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${s}-${rutDv(body)}`;
}

interface TruckSpec {
  plate: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  mileage: number;
  color: string;
  capacity: string;
  status: 'active' | 'maintenance' | 'inactive';
  /** km por galon, para los registros de combustible. */
  kmpg: number;
  /** Dias hasta el vencimiento del SOAP / revision tecnica / permiso de circulacion. */
  soap: number;
  rt: number;
  permiso: number;
}

/** Diez camiones tolva de marcas habituales en faenas chilenas. Patentes ficticias (serie ZZ). */
const TRUCKS: TruckSpec[] = [
  { plate: 'ZZBC-11', make: 'Kenworth', model: 'T800 Volqueta', year: 2019, vin: 'DEMOCL0KW19T80001', mileage: 186_400, color: '#b3261e', capacity: '20 m³', status: 'active', kmpg: 6.2, soap: 140, rt: 9, permiso: 170 },
  { plate: 'ZZBD-12', make: 'Mercedes-Benz', model: 'Actros 3344 K', year: 2021, vin: 'DEMOCL0MB21A33402', mileage: 142_300, color: '#eceeef', capacity: '18 m³', status: 'active', kmpg: 6.8, soap: 140, rt: 64, permiso: 170 },
  { plate: 'ZZBF-13', make: 'Volvo', model: 'FMX 500 8x4', year: 2020, vin: 'DEMOCL0VO20FMX503', mileage: 231_900, color: '#1f3a5f', capacity: '22 m³', status: 'active', kmpg: 5.9, soap: 140, rt: 21, permiso: 170 },
  { plate: 'ZZBG-14', make: 'Scania', model: 'G 460 XT 8x4', year: 2022, vin: 'DEMOCL0SC22G46004', mileage: 98_750, color: '#f2c200', capacity: '20 m³', status: 'active', kmpg: 6.6, soap: 140, rt: 120, permiso: 170 },
  { plate: 'ZZBH-15', make: 'Iveco', model: 'Trakker 410 6x4', year: 2018, vin: 'DEMOCL0IV18T41005', mileage: 287_100, color: '#2e6b3f', capacity: '14 m³', status: 'maintenance', kmpg: 6.0, soap: -4, rt: 33, permiso: 170 },
  { plate: 'ZZBJ-16', make: 'Mack', model: 'Granite GU813', year: 2019, vin: 'DEMOCL0MK19G81306', mileage: 204_600, color: '#7a7d80', capacity: '16 m³', status: 'active', kmpg: 5.7, soap: 140, rt: 88, permiso: 170 },
  { plate: 'ZZBK-17', make: 'International', model: '7600 Volqueta', year: 2021, vin: 'DEMOCL0IN21760007', mileage: 121_250, color: '#eceeef', capacity: '16 m³', status: 'active', kmpg: 6.4, soap: 140, rt: 150, permiso: 170 },
  { plate: 'ZZBL-18', make: 'Freightliner', model: '114SD 8x4', year: 2020, vin: 'DEMOCL0FL20S11408', mileage: 176_800, color: '#c45a12', capacity: '20 m³', status: 'active', kmpg: 6.1, soap: 140, rt: 14, permiso: 170 },
  { plate: 'ZZBP-19', make: 'Volvo', model: 'FMX 460 6x4', year: 2023, vin: 'DEMOCL0VO23FMX409', mileage: 54_300, color: '#1f3a5f', capacity: '14 m³', status: 'active', kmpg: 7.0, soap: 140, rt: 175, permiso: 170 },
  { plate: 'ZZBR-20', make: 'Scania', model: 'P 410 XT 6x4', year: 2017, vin: 'DEMOCL0SC17P41010', mileage: 312_400, color: '#f2c200', capacity: '14 m³', status: 'inactive', kmpg: 5.8, soap: 140, rt: 40, permiso: 170 },
];

/** Vehiculo de ejemplo del garage en modo invitado: el primer camion de la flota demo. */
export const CHILE_DEMO_SAMPLE_VEHICLE = {
  make: TRUCKS[0].make,
  model: TRUCKS[0].model,
  type: 'volqueta' as const,
  plate: TRUCKS[0].plate,
  year: TRUCKS[0].year,
  usage: TRUCKS[0].mileage,
};

/** Ocho conductores ficticios (apellido "Ejemplo"). Licencia profesional clase A4. */
const DRIVERS: Array<{ name: string; rut: number; licenseDays: number; truck: number | null; phone: string }> = [
  { name: 'Rodrigo Ejemplo Muñoz', rut: 30_111_201, licenseDays: 410, truck: 0, phone: '+56 9 0000 0101' },
  { name: 'Carolina Ejemplo Soto', rut: 30_111_202, licenseDays: 25, truck: 1, phone: '+56 9 0000 0102' },
  { name: 'Patricio Ejemplo Rojas', rut: 30_111_203, licenseDays: 600, truck: 2, phone: '+56 9 0000 0103' },
  { name: 'Javiera Ejemplo Díaz', rut: 30_111_204, licenseDays: 300, truck: 3, phone: '+56 9 0000 0104' },
  { name: 'Manuel Ejemplo Contreras', rut: 30_111_205, licenseDays: -10, truck: null, phone: '+56 9 0000 0105' },
  { name: 'Francisca Ejemplo Silva', rut: 30_111_206, licenseDays: 520, truck: 5, phone: '+56 9 0000 0106' },
  { name: 'Cristián Ejemplo Morales', rut: 30_111_207, licenseDays: 230, truck: 6, phone: '+56 9 0000 0107' },
  { name: 'Valentina Ejemplo Fuentes', rut: 30_111_208, licenseDays: 700, truck: 7, phone: '+56 9 0000 0108' },
];

/** Tres zonas de la Region de Antofagasta. Poligonos "lat,lng lat,lng ..." (formato de geofence). */
const GEOFENCES = [
  {
    name: 'Faena Demo Cerro Norte (sector Calama)',
    polygon: '-22.2900,-68.9300 -22.2900,-68.8900 -22.3200,-68.8900 -22.3200,-68.9300',
    type: 'faena',
    alertOnEnter: true,
    alertOnExit: true,
  },
  {
    name: 'Patio de camiones La Negra (Antofagasta)',
    polygon: '-23.7400,-70.3200 -23.7400,-70.2900 -23.7650,-70.2900 -23.7650,-70.3200',
    type: 'depot',
    alertOnEnter: false,
    alertOnExit: true,
  },
  {
    name: 'Planta de áridos Demo Sierra Gorda',
    polygon: '-22.8700,-69.3400 -22.8700,-69.3000 -22.9000,-69.3000 -22.9000,-69.3400',
    type: 'planta',
    alertOnEnter: true,
    alertOnExit: false,
  },
];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Todas las filas de la flota demo, con ids deterministas. `today` fija el "hoy" de las fechas.
 */
export function buildChileDemo(today: Date = new Date()): DemoRow[] {
  const day0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const date = (offsetDays: number) => new Date(day0 + offsetDays * DAY).toISOString().slice(0, 10);
  const rows: DemoRow[] = [];
  const fleetId = 'cl-fleet-01';
  const vehId = (i: number) => `cl-veh-${pad(i + 1)}`;
  const drvId = (i: number) => `cl-drv-${pad(i + 1)}`;

  rows.push({
    entity: 'fleet',
    id: fleetId,
    data: {
      name: 'Camiones tolva · Región de Antofagasta',
      organizationId: 'org-demo-chile',
      region: 'Antofagasta',
      country: 'CL',
      currency: 'CLP',
      tags: ['tolva', 'minería', 'construcción', 'demo'],
      managerId: 'mgr-demo-chile',
      demo: true,
    },
  });

  TRUCKS.forEach((t, i) => {
    rows.push({
      entity: 'vehicle',
      id: vehId(i),
      data: {
        plate: t.plate,
        vin: t.vin,
        make: t.make,
        model: t.model,
        year: t.year,
        status: t.status,
        fleetId,
        type: 'volqueta',
        typeLabel: 'Camión tolva',
        capacity: t.capacity,
        mileage: t.mileage,
        color: t.color,
        // La app guarda SOAT/tecnomecanica en estos dos campos; en Chile son SOAP y revision tecnica.
        soatExpiry: date(t.soap),
        tecnoExpiry: date(t.rt),
        demo: true,
      },
    });
  });

  DRIVERS.forEach((d, i) => {
    rows.push({
      entity: 'driver',
      id: drvId(i),
      data: {
        name: d.name,
        // El esquema llama `cedula` al documento de identidad; en Chile es el RUT.
        cedula: formatRut(d.rut),
        rut: formatRut(d.rut),
        licenseCategory: 'A4',
        licenseExpiry: date(d.licenseDays),
        phone: d.phone,
        status: d.licenseDays < 0 ? 'inactive' : 'active',
        fleetId,
        vehicleId: d.truck === null ? null : vehId(d.truck),
        demo: true,
      },
    });
  });

  // --- Mantenimiento: 3 completados por camion + 1 programado en los que lo necesitan ---
  const SERVICES = [
    { type: 'Cambio de aceite 15W-40 y filtros', every: 15_000, cost: 420_000 },
    { type: 'Revisión de frenos y ajuste de balatas', every: 40_000, cost: 680_000 },
    { type: 'Sellos del cilindro de levante de la tolva', every: 80_000, cost: 1_150_000 },
  ];
  let m = 0;
  TRUCKS.forEach((t, i) => {
    SERVICES.forEach((s, k) => {
      const km = Math.max(0, t.mileage - (k + 1) * Math.round(s.every / 3));
      rows.push({
        entity: 'maintenance',
        id: `cl-mnt-${pad(++m)}`,
        data: {
          vehicleId: vehId(i),
          type: s.type,
          km,
          date: date(-(20 + k * 45 + i * 3)),
          cost: s.cost,
          currency: 'CLP',
          workshop: k === 2 ? 'Taller Demo Hidráulica Calama' : 'Servicentro Demo La Negra',
          status: 'completed',
          demo: true,
        },
      });
    });
    if (i % 3 === 0 || t.status === 'maintenance') {
      rows.push({
        entity: 'maintenance',
        id: `cl-mnt-${pad(++m)}`,
        data: {
          vehicleId: vehId(i),
          type: t.status === 'maintenance' ? 'Reparación de bomba hidráulica de la tolva' : 'Mantención preventiva 250 horas',
          km: t.mileage,
          nextKm: t.mileage + 5_000,
          date: date(-2),
          nextDate: date(t.status === 'maintenance' ? 3 : 12 + i),
          cost: t.status === 'maintenance' ? 2_300_000 : 950_000,
          currency: 'CLP',
          workshop: 'Servicentro Demo La Negra',
          status: t.status === 'maintenance' ? 'in_progress' : 'scheduled',
          demo: true,
        },
      });
    }
  });

  // --- Combustible: 3 cargas por camion activo, en litros (y galones, que es lo que usa la app) ---
  let f = 0;
  TRUCKS.forEach((t, i) => {
    if (t.status === 'inactive') return;
    [12, 6, 1].forEach((ago, k) => {
      const liters = 280 + ((i * 37 + k * 53) % 140);
      rows.push({
        entity: 'fuelLog',
        id: `cl-fuel-${pad(++f)}`,
        data: {
          vehicleId: vehId(i),
          driverId: DRIVERS.findIndex((d) => d.truck === i) >= 0 ? drvId(DRIVERS.findIndex((d) => d.truck === i)) : null,
          date: date(-ago - (i % 3)),
          km: t.mileage - (2 - k) * 650,
          liters,
          gallons: Math.round((liters / LITERS_PER_GALLON) * 10) / 10,
          cost: liters * DIESEL_CLP_PER_LITER,
          currency: 'CLP',
          station: k === 1 ? 'Estación Demo Ruta 25 (Calama)' : 'Estación Demo La Negra',
          kmPerGallon: t.kmpg,
          demo: true,
        },
      });
    });
  });

  // --- Documentos: SOAP, revision tecnica y permiso de circulacion por camion ---
  const status = (days: number) => (days < 0 ? 'expired' : days <= 30 ? 'expiring' : 'valid');
  let d = 0;
  TRUCKS.forEach((t, i) => {
    for (const [kind, days] of [
      ['SOAP', t.soap],
      ['Revisión técnica', t.rt],
      ['Permiso de circulación', t.permiso],
    ] as const) {
      rows.push({
        entity: 'document',
        id: `cl-doc-${pad(++d)}`,
        data: {
          vehicleId: vehId(i),
          kind,
          expiry: date(days),
          status: status(days),
          r2Key: null,
          fileHash: null,
          demo: true,
        },
      });
    }
  });
  DRIVERS.forEach((dr, i) => {
    rows.push({
      entity: 'document',
      id: `cl-doc-${pad(++d)}`,
      data: {
        driverId: drvId(i),
        kind: 'Licencia profesional clase A4',
        expiry: date(dr.licenseDays),
        status: status(dr.licenseDays),
        r2Key: null,
        fileHash: null,
        demo: true,
      },
    });
  });

  GEOFENCES.forEach((g, i) => {
    rows.push({ entity: 'geofence', id: `cl-geo-${pad(i + 1)}`, data: { ...g, fleetId, demo: true } });
  });

  const ALERTS = [
    { v: 4, kind: 'document', severity: 'critical', message: 'SOAP vencido: el camión ZZBH-15 no puede circular' },
    { v: 0, kind: 'document', severity: 'warning', message: 'Revisión técnica de ZZBC-11 vence en 9 días' },
    { v: 7, kind: 'document', severity: 'warning', message: 'Revisión técnica de ZZBL-18 vence en 14 días' },
    { v: 2, kind: 'geofence', severity: 'medium', message: 'ZZBF-13 salió de la Faena Demo Cerro Norte fuera de turno' },
    { v: 1, kind: 'driver', severity: 'warning', message: 'Licencia A4 de Carolina Ejemplo Soto vence en 25 días' },
    { v: 5, kind: 'maintenance', severity: 'low', message: 'ZZBJ-16: cambio de aceite a los 15.000 km se acerca' },
  ];
  ALERTS.forEach((a, i) => {
    rows.push({
      entity: 'alert',
      id: `cl-alr-${pad(i + 1)}`,
      data: { vehicleId: vehId(a.v), fleetId, kind: a.kind, severity: a.severity, message: a.message, acknowledged: false, demo: true },
    });
  });

  return rows;
}

/** Cuenta de filas por entidad (para el script y los tests). */
export function countByEntity(rows: Pick<DemoRow, 'entity'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.entity] = (out[r.entity] ?? 0) + 1;
  return out;
}
