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
 *   - RUT con digito verificador valido (modulo 11, lib/rut.ts) pero en el rango
 *     30.000.000+, por encima de los RUN emitidos a personas; los nombres llevan el apellido
 *     "Ejemplo".
 *   - VINs de 17 caracteres con WMI `ZZZ` (serie ficticia) y DIGITO VERIFICADOR ISO 3779
 *     correcto: sin I, O ni Q, que es lo que exige `isValidVin` (garage/telemetry/ingest.ts).
 *     Antes se escribian a mano (`DEMOCL0IV18T41005` traia I y O) y la API de telemetria
 *     respondia 400 al monitorear el camion. Ahora se calculan con `withVinCheckDigit`.
 *   - Empresas, faenas y talleres con nombres genericos marcados como demo.
 *
 * Ids deterministas (`cl-<entidad>-NN`): volver a sembrar actualiza las mismas filas en vez
 * de duplicarlas. Las fechas se calculan contra `today`, para que la demo siempre tenga
 * documentos por vencer.
 *
 * El unico import de datos es `./rut.ts` (extension explicita: el script de semilla lo carga con
 * Node a pelo, sin Vite); `./notifications.ts` se usa solo para el titulo canonico de las
 * notificaciones de alerta, que es puro y no arrastra dependencias.
 */
import { computeRutDv, formatRutBody } from './rut.ts';
import { alertNotificationTitle } from './notifications.ts';

export const CHILE_DEMO_INSTANCE_ID = 'flota-demo-chile';
export const CHILE_DEMO_FLEET_PATH = '/fleet/garage/flota-demo-chile';

export interface DemoRow {
  entity: 'fleet' | 'vehicle' | 'driver' | 'maintenance' | 'fuelLog' | 'document' | 'geofence' | 'alert' | 'notification';
  id: string;
  data: Record<string, unknown>;
}

const DAY = 86_400_000;
const LITERS_PER_GALLON = 3.785;
/** Precio de referencia del diesel en la demo (CLP por litro). Inventado, redondo. */
const DIESEL_CLP_PER_LITER = 1_050;

/** Digito verificador de un RUT chileno (modulo 11). Ver lib/rut.ts. */
export function rutDv(body: number): string {
  return computeRutDv(body);
}

/** `30123456` -> `30.123.456-7`. Ver lib/rut.ts. */
export function formatRut(body: number): string {
  return formatRutBody(body);
}

// ── VINs de la demo (ISO 3779) ────────────────────────────────────────────────

/** Transliteracion del VIN (49 CFR 565): las letras valen su numero; I, O y Q no existen. */
const VIN_TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
/** Pesos por posicion. El 0 de la posicion 9 es el digito verificador: no pesa. */
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Digito verificador de un VIN de 17 caracteres (posicion 9). `''` si el VIN no es valido:
 * largo distinto de 17, caracteres fuera de A-Z0-9 o alguna de las letras vetadas I, O, Q.
 */
export function vinCheckDigit(vin: string): string {
  if (vin.length !== 17 || /[^A-HJ-NPR-Z0-9]/.test(vin)) return '';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const value = ch >= '0' && ch <= '9' ? Number(ch) : VIN_TRANSLIT[ch];
    if (value === undefined) return '';
    sum += value * VIN_WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

/**
 * Rellena el digito verificador (posicion 9) de una plantilla de 17 caracteres que trae un
 * `?` en ese lugar: `ZZZKW19T?KA000001` -> `ZZZKW19T7KA000001`.
 */
export function withVinCheckDigit(template: string): string {
  const body = `${template.slice(0, 8)}0${template.slice(9)}`;
  return `${body.slice(0, 8)}${vinCheckDigit(body)}${body.slice(9)}`;
}

interface TruckSpec {
  plate: string;
  make: string;
  model: string;
  year: number;
  mileage: number;
  color: string;
  capacity: string;
  status: 'active' | 'maintenance' | 'inactive';
  /** Plantilla de VIN de 17 caracteres; el `?` de la posicion 9 se reemplaza por el DV. */
  vinTemplate: string;
  /** km por litro de diesel, para los registros de combustible (unidad de Chile). */
  kmpl: number;
  /** Dias hasta el vencimiento del SOAP / revision tecnica / permiso de circulacion. */
  soap: number;
  rt: number;
  permiso: number;
}

/**
 * Diez camiones tolva de marcas habituales en faenas chilenas. Patentes ficticias (serie ZZ).
 * El VIN se arma con WMI `ZZZ` (serie que no emite ningun fabricante), la version/marca en el
 * VDS, el codigo de ano ISO 3779 y un serial correlativo; el digito verificador se calcula.
 */
const TRUCKS: TruckSpec[] = [
  { plate: 'ZZBC-11', make: 'Kenworth', model: 'T800 Volqueta', year: 2019, vinTemplate: 'ZZZKW19T?KA000001', mileage: 186_400, color: '#b3261e', capacity: '20 m³', status: 'active', kmpl: 2.6, soap: 140, rt: 9, permiso: 170 },
  { plate: 'ZZBD-12', make: 'Mercedes-Benz', model: 'Actros 3344 K', year: 2021, vinTemplate: 'ZZZMB21A?MA000002', mileage: 142_300, color: '#eceeef', capacity: '18 m³', status: 'active', kmpl: 2.9, soap: 140, rt: 64, permiso: 170 },
  { plate: 'ZZBF-13', make: 'Volvo', model: 'FMX 500 8x4', year: 2020, vinTemplate: 'ZZZVL20F?LA000003', mileage: 231_900, color: '#1f3a5f', capacity: '22 m³', status: 'active', kmpl: 2.4, soap: 140, rt: 21, permiso: 170 },
  { plate: 'ZZBG-14', make: 'Scania', model: 'G 460 XT 8x4', year: 2022, vinTemplate: 'ZZZSC22G?NA000004', mileage: 98_750, color: '#f2c200', capacity: '20 m³', status: 'active', kmpl: 2.8, soap: 140, rt: 120, permiso: 170 },
  { plate: 'ZZBH-15', make: 'Iveco', model: 'Trakker 410 6x4', year: 2018, vinTemplate: 'ZZZEV18T?JA000005', mileage: 287_100, color: '#2e6b3f', capacity: '14 m³', status: 'maintenance', kmpl: 2.5, soap: -4, rt: 33, permiso: 170 },
  { plate: 'ZZBJ-16', make: 'Mack', model: 'Granite GU813', year: 2019, vinTemplate: 'ZZZMK19G?KA000006', mileage: 204_600, color: '#7a7d80', capacity: '16 m³', status: 'active', kmpl: 2.4, soap: 140, rt: 88, permiso: 170 },
  { plate: 'ZZBK-17', make: 'International', model: '7600 Volqueta', year: 2021, vinTemplate: 'ZZZNT21V?MA000007', mileage: 121_250, color: '#eceeef', capacity: '16 m³', status: 'active', kmpl: 2.7, soap: 140, rt: 150, permiso: 170 },
  { plate: 'ZZBL-18', make: 'Freightliner', model: '114SD 8x4', year: 2020, vinTemplate: 'ZZZFL20S?LA000008', mileage: 176_800, color: '#c45a12', capacity: '20 m³', status: 'active', kmpl: 2.5, soap: 140, rt: 14, permiso: 170 },
  { plate: 'ZZBP-19', make: 'Volvo', model: 'FMX 460 6x4', year: 2023, vinTemplate: 'ZZZVL23F?PA000009', mileage: 54_300, color: '#1f3a5f', capacity: '14 m³', status: 'active', kmpl: 3.0, soap: 140, rt: 175, permiso: 170 },
  { plate: 'ZZBR-20', make: 'Scania', model: 'P 410 XT 6x4', year: 2017, vinTemplate: 'ZZZSC17P?HA000010', mileage: 312_400, color: '#f2c200', capacity: '14 m³', status: 'inactive', kmpl: 2.4, soap: 140, rt: 40, permiso: 170 },
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

/** Ocho conductores ficticios (apellido "Ejemplo"). Licencia profesional clase A5 (camiones). */
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
  /** Fecha y hora ISO determinista (la usan las notificaciones, que llevan createdAt). */
  const iso = (offsetDays: number) => new Date(day0 + offsetDays * DAY).toISOString();
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
        vin: withVinCheckDigit(t.vinTemplate),
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
        // La app guarda SOAT/tecnomecanica en estos dos campos; en Chile son SOAP y revision
        // tecnica (PRT). El nombre del campo NO cambia: renombrarlo rompe las filas guardadas.
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
        licenseCategory: 'A5',
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

  // --- Combustible: 3 cargas por camion activo. El modelo guarda `gallons` (asi nacio la app)
  // y la semilla chilena escribe ademas `liters`, que es lo que muestra la interfaz en Chile. ---
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
          kmPerLiter: t.kmpl,
          kmPerGallon: Math.round((t.kmpl * LITERS_PER_GALLON) * 10) / 10,
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
        kind: 'Licencia profesional clase A5',
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
    { v: 1, kind: 'driver', severity: 'warning', message: 'Licencia A5 de Carolina Ejemplo Soto vence en 25 días' },
    { v: 5, kind: 'maintenance', severity: 'low', message: 'ZZBJ-16: cambio de aceite a los 15.000 km se acerca' },
  ];
  ALERTS.forEach((a, i) => {
    rows.push({
      entity: 'alert',
      id: `cl-alr-${pad(i + 1)}`,
      data: { vehicleId: vehId(a.v), fleetId, kind: a.kind, severity: a.severity, message: a.message, acknowledged: false, demo: true },
    });
    // Espejo en el centro de notificaciones: la demo sembraba 6 alertas y `notification = 0`, asi
    // que el panel anunciaba "6 ALERTAS SIN RECONOCER" y /fleet/notifications decia
    // "Sin notificaciones". Las no leidas (readAt: null) cuadran con las alertas sin reconocer.
    // El titulo usa el formato canonico que `notificationTitleLabel` sabe traducir.
    rows.push({
      entity: 'notification',
      id: `cl-not-${pad(i + 1)}`,
      data: {
        userId: null,
        kind: 'alert',
        title: alertNotificationTitle(a.kind, a.severity),
        body: a.message,
        severity: a.severity,
        readAt: null,
        createdAt: iso(-i),
        demo: true,
      },
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
