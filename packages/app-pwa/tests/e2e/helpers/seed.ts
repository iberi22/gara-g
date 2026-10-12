import { test, type APIRequestContext } from '@playwright/test';
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_SESSION_TOKEN, DEV_ADMIN_USER_ID } from './auth';

/**
 * helpers/seed.ts — Flota demo en el tenant de la SESION.
 *
 * Desde bf4e14a3 (fix(fleet): cada pagina mostraba la flota demo) las paginas y
 * APIs leen el tenant de la sesion (en dev: `gara-g-default-instance`), y la
 * semilla de src/lib/fleetSeed.ts solo se escribe para el tenant `demo-flota`,
 * al que la sesion admin de dev ya no llega. Los specs que asumen la flota demo
 * (3 flotas, 10 vehiculos, 5 conductores...) la crean aqui via la API publica,
 * con las mismas formas que la semilla. Idempotente: si ya hay 10 vehiculos no
 * escribe nada (el storage de dev en memoria se vacia al recargar Vite). Si otro
 * spec dejo filas extra (o borro alguna), las cuentas ya no son las de la demo y
 * se reconstruye desde cero.
 */

type Rec = Record<string, unknown> & { id?: string };

const CONCURRENCY = 8;

/** Como Promise.all(items.map(fn)) pero con a lo sumo CONCURRENCY en vuelo; conserva el orden. */
async function mapPool<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/**
 * Cerrojo entre workers: la semilla borra y recrea, y dos workers a la vez se pisan
 * (9 flotas en vez de 3). mkdir es atomico; un cerrojo de mas de 3 min es de un worker muerto.
 */
const LOCK_DIR = join(tmpdir(), 'gara-e2e-seed.lock');
async function withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      break;
    } catch {
      try {
        if (Date.now() - statSync(LOCK_DIR).mtimeMs > 180_000) rmdirSync(LOCK_DIR);
      } catch {
        /* otro worker lo libero justo ahora */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      rmdirSync(LOCK_DIR);
    } catch {
      /* ya no esta */
    }
  }
}

export function seedDemoFleet(
  request: APIRequestContext,
  opts: { exact?: boolean } = {},
): Promise<void> {
  return withSeedLock(() => seedDemoFleetLocked(request, opts));
}

async function seedDemoFleetLocked(
  request: APIRequestContext,
  { exact = true }: { exact?: boolean } = {},
): Promise<void> {
  const headers = {
    cookie: `session=${ADMIN_SESSION_TOKEN}; gara_onb=${DEV_ADMIN_USER_ID}`,
    'content-type': 'application/json',
  };
  const list = async (entity: string): Promise<Rec[]> => {
    const res = await request.get(`/api/fleet/${entity}`, { headers });
    return ((await res.json().catch(() => ({}))).data ?? []) as Rec[];
  };
  const create = async (entity: string, body: Rec): Promise<Rec> => {
    const res = await request.post(`/api/fleet/${entity}`, { headers, data: body });
    if (!res.ok()) throw new Error(`seed ${entity}: ${res.status()} ${await res.text()}`);
    return ((await res.json()).data ?? {}) as Rec;
  };

  const DEMO_COUNTS: Record<string, number> = {
    fleet: 3, vehicle: 10, driver: 5, maintenance: 20, fuelLog: 30, document: 8, geofence: 4, alert: 12,
  };
  let isDemo = true;
  for (const [entity, n] of Object.entries(DEMO_COUNTS)) {
    // exact:false (specs que crean filas): basta con que haya algo de cada entidad.
    const have = (await list(entity)).length;
    if (exact ? have !== n : have === 0) { isDemo = false; break; }
  }
  if (isDemo) return;

  // Reconstruir son ~130 escrituras contra el dev server: con la maquina cargada pasa de los 90 s del hook.
  test.setTimeout(300_000);

  // Estado limpio: el seed es la fuente de verdad de las cuentas del dashboard.
  for (const entity of ['fleet', 'vehicle', 'driver', 'maintenance', 'fuelLog', 'document', 'geofence', 'alert']) {
    await mapPool(await list(entity), (row) => request.delete(`/api/fleet/${entity}/${row.id}`, { headers }));
  }

  const fleets = await mapPool(
    [['Bogotá Norte', 'Bogotá D.C.'], ['Medellín Sur', 'Antioquia'], ['Cali Logística', 'Valle del Cauca']],
    ([name, region]) => create('fleet', { name, organizationId: 'org-demo', region, tags: ['demo'], managerId: 'mgr-1' }),
  );

  const specs: Array<[string, string, string, string, number, string, string, number, number]> = [
    ['ABC-001', '1HGCM82633A004352', 'Toyota', 'Hilux', 2022, 'active', 'camioneta', 45200, 0],
    ['ABC-002', '1HGCM82633A004353', 'Chevrolet', 'NPR', 2021, 'active', 'camión', 78200, 0],
    ['ABC-003', '1HGCM82633A004354', 'Renault', 'Logan', 2023, 'active', 'sedán', 22100, 0],
    ['DEF-101', '1HGCM82633A004355', 'Ford', 'Transit', 2022, 'maintenance', 'van', 65100, 1],
    ['DEF-102', '1HGCM82633A004356', 'Nissan', 'Frontier', 2020, 'active', 'pickup', 102300, 1],
    ['DEF-103', '1HGCM82633A004357', 'Mercedes', 'Sprinter', 2024, 'active', 'van', 8500, 1],
    ['GHI-201', '1HGCM82633A004358', 'Volvo', 'FH16', 2019, 'active', 'tractomula', 412800, 2],
    ['GHI-202', '1HGCM82633A004359', 'Kenworth', 'T800', 2020, 'active', 'tractomula', 389200, 2],
    ['GHI-203', '1HGCM82633A004360', 'Scania', 'R450', 2023, 'decommissioned', 'tractomula', 52100, 2],
    ['GHI-204', '1HGCM82633A004361', 'DAF', 'XF', 2024, 'active', 'tractomula', 5400, 2],
  ];
  const vehicles = await mapPool(specs, ([plate, vin, make, model, year, status, type, mileage, f]) =>
    create('vehicle', {
      plate, vin, make, model, year, status, type, capacity: '5 Pax', mileage,
      fleetId: fleets[f].id, soatExpiry: '2027-06-30', tecnoExpiry: '2027-03-15',
      photoUrl: '/img/vehicles/placeholder.png',
    }),
  );

  // Del resto, ninguna fila depende de otra: se escriben todas juntas.
  const writes: Array<() => Promise<unknown>> = [];

  const drivers: Array<[string, string, string, string, number]> = [
    ['Carlos Méndez', '79.456.123', 'C1', 'active', 0],
    ['Lucía Ramírez', '52.847.612', 'B1', 'active', 2],
    ['Andrés Quintero', '71.245.891', 'C2', 'suspended', 3],
    ['María López', '43.621.547', 'C1', 'active', 5],
    ['Pedro Salazar', '16.789.234', 'C3', 'active', 6],
  ];
  for (const [name, cedula, licenseCategory, status, v] of drivers) {
    writes.push(() =>
      create('driver', {
        name, cedula, licenseCategory, licenseExpiry: '2027-08-15', phone: '+57 310 4567890',
        status, fleetId: vehicles[v].fleetId, vehicleId: vehicles[v].id,
      }),
    );
  }

  const day = 24 * 60 * 60 * 1000;
  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().split('T')[0];
  const types = ['preventivo', 'correctivo', 'predictivo', 'inspección'];
  for (let i = 0; i < 20; i++) {
    const veh = vehicles[i % vehicles.length];
    writes.push(() =>
      create('maintenance', {
      vehicleId: veh.id, type: types[i % 4], km: 10000 + i * 2500, date: iso(-i * 7),
      cost: 150000 + i * 20000, workshop: ['Talleres Andinos', 'Auto Servicio Sur', 'Frenos y Más'][i % 3],
      nextKm: Number(veh.mileage ?? 0) + 5000, nextDate: iso(90 - i * 3),
      status: i < 15 ? 'completed' : 'scheduled', notes: 'Servicio rutinario',
      }),
    );
  }
  for (let i = 0; i < 30; i++) {
    const veh = vehicles[i % vehicles.length];
    const gallons = 10 + (i % 30);
    writes.push(() =>
      create('fuelLog', {
      vehicleId: veh.id, driverId: drivers[i % drivers.length][1], date: iso(-i * 2),
      km: Math.floor(Number(veh.mileage ?? 0) * 0.6) + i * 100, gallons, cost: gallons * 14500,
      station: ['Terpel', 'Primax', 'Mobil'][i % 3], kmPerGallon: 25 + (i % 30),
      }),
    );
  }
  const kinds = ['SOAT', 'Tecnomecánica', 'Tarjeta de propiedad', 'Póliza todo riesgo'];
  for (let i = 0; i < 8; i++) {
    const veh = vehicles[i % vehicles.length];
    writes.push(() =>
      create('document', {
      vehicleId: veh.id, kind: kinds[i % 4], fileHash: `sha256:seed${i}`,
      r2Key: `documents/${veh.plate}/${kinds[i % 4]}.pdf`, expiry: iso((i % 5) * 365 + 30),
      status: i < 6 ? 'valid' : 'expiring',
      }),
    );
  }
  const fences: Array<[string, string, string, number]> = [
    ['Centro de Distribución Bogotá', '4.7110,-74.0721 4.6510,-74.0721 4.6510,-74.1421 4.7110,-74.1421', 'depot', 0],
    ['Cliente Norte - Centro Comercial', '4.7350,-74.0500 4.7250,-74.0500 4.7250,-74.0400 4.7350,-74.0400', 'client', 0],
    ['Taller Autorizado Medellín', '6.2476,-75.5658 6.2376,-75.5658 6.2376,-75.5758 6.2476,-75.5758', 'service', 1],
    ['Puerto de Buenaventura', '3.8801,-77.0311 3.8601,-77.0311 3.8601,-77.0511 3.8801,-77.0511', 'port', 2],
  ];
  for (const [name, polygon, type, f] of fences) {
    writes.push(() =>
      create('geofence', { name, polygon, type, fleetId: fleets[f].id, alertOnEnter: true, alertOnExit: true }),
    );
  }
  const alerts: Array<[string, string, string]> = [
    ['speed', 'high', 'Exceso de velocidad: 130 km/h en zona 80'],
    ['geofence', 'medium', 'Salida no autorizada de geocerca Centro de Distribución'],
    ['maintenance', 'low', 'Mantenimiento programado vence en 5 días'],
    ['document', 'high', 'SOAT próximo a vencer - ABC-001'],
    ['fuel', 'low', 'Nivel de combustible bajo (15%)'],
    ['engine', 'critical', 'Código DTC P0420 - Catalizador ineficiente'],
    ['driver', 'medium', 'Conductor sin licencia vigente detectado'],
    ['speed', 'medium', 'Velocidad sostenida sobre límite por 5 min'],
    ['geofence', 'low', 'Entrada a zona restringida fuera de horario'],
    ['maintenance', 'medium', 'Frenos - Pastillas desgastadas (>80%)'],
    ['document', 'low', 'Tecnomecánica vence en 30 días - DEF-102'],
    ['engine', 'high', 'Temperatura refrigerante elevada (105°C)'],
  ];
  for (let i = 0; i < alerts.length; i++) {
    const [kind, severity, message] = alerts[i];
    writes.push(() =>
      create('alert', {
        kind, severity, message, vehicleId: vehicles[i % 10].id, fleetId: vehicles[i % 10].fleetId,
        acknowledged: i < 4,
      }),
    );
  }
  await mapPool(writes, (write) => write());
}
