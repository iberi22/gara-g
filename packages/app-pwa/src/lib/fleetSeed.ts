/**
 * fleetSeed.ts — Datos demo persistentes para "Empresa de Flotas" demo-flota.
 *
 * 10 vehículos, 3 flotas, 5 conductores, 20 mantenimientos, 30 fuel-logs,
 * 8 documentos, 4 geocercas, 12 alertas, 50 telemetrías.
 *
 * Se inyecta en el storage adapter (memory) al boot del primer request.
 * Idempotente: si ya hay datos para la instance demo-flota, no duplica.
 *
 * NOTA: Cloudflare workerd no comparte `globalThis` entre requests.
 * Usamos un Map<instanceId, boolean> a nivel de módulo.
 */

import { domainConfig } from './domain.config.js';
import { createEntity, listEntities } from './domain.js';

/**
 * Tenant de los DATOS DEMO. No es el tenant de la app: es donde vive el seed
 * que se inyecta al arrancar. Cualquier código de producción que lo use como
 * "tenant por defecto" escribe en el sitio equivocado y separa los datos del
 * cliente de los de ejemplo.
 *
 * El tenant real es `DEFAULT_INSTANCE_ID` (lib/xavier.ts) o el que trae la
 * sesión; nunca esta constante.
 */
export const DEMO_INSTANCE_ID = 'demo-flota';

const seededInstances = new Set<string>();

function seedLoaded(instanceId: string): boolean {
  return seededInstances.has(instanceId);
}
function markLoaded(instanceId: string): void {
  seededInstances.add(instanceId);
}

/** Convierte un objeto cualquiera a DomainRecord (lo que espera domain.ts). */
function rec<T extends Record<string, unknown>>(data: T): T & { id: string } {
  return { ...data, id: '' };
}

export async function ensureSeedData(instanceId: string = DEMO_INSTANCE_ID): Promise<void> {
  if (seedLoaded(instanceId)) return;

  // Verify no existe ya data para esta instance
  const existing = await listEntities('fleet', instanceId);
  if (existing.length > 0) {
    markLoaded(instanceId);
    return;
  }

  // === FLOTAS (3) ===
  const fleet1 = await createEntity(
    'fleet',
    rec({
      name: 'Bogotá Norte',
      organizationId: 'org-demo',
      region: 'Bogotá D.C.',
      tags: ['urbano', 'livianos'],
      managerId: 'mgr-1',
    }) as any,
    DEMO_INSTANCE_ID,
  );

  const fleet2 = await createEntity(
    'fleet',
    rec({
      name: 'Medellín Sur',
      organizationId: 'org-demo',
      region: 'Antioquia',
      tags: ['mixto', 'reparto'],
      managerId: 'mgr-2',
    }) as any,
    DEMO_INSTANCE_ID,
  );

  const fleet3 = await createEntity(
    'fleet',
    rec({
      name: 'Cali Logística',
      organizationId: 'org-demo',
      region: 'Valle del Cauca',
      tags: ['pesados', 'larga-distancia'],
      managerId: 'mgr-3',
    }) as any,
    DEMO_INSTANCE_ID,
  );

  // === VEHÍCULOS (10) ===
  const vehiclesSpec = [
    {
      plate: 'ABC-001',
      vin: '1HGCM82633A004352',
      make: 'Toyota',
      model: 'Hilux',
      year: 2022,
      status: 'active' as const,
      type: 'camioneta',
      capacity: '5 Pax',
      mileage: 45200,
      fleetId: fleet1.id,
    },
    {
      plate: 'ABC-002',
      vin: '1HGCM82633A004353',
      make: 'Chevrolet',
      model: 'NPR',
      year: 2021,
      status: 'active' as const,
      type: 'camión',
      capacity: '3.5 ton',
      mileage: 78200,
      fleetId: fleet1.id,
    },
    {
      plate: 'ABC-003',
      vin: '1HGCM82633A004354',
      make: 'Renault',
      model: 'Logan',
      year: 2023,
      status: 'active' as const,
      type: 'sedán',
      capacity: '5 Pax',
      mileage: 22100,
      fleetId: fleet1.id,
    },
    {
      plate: 'DEF-101',
      vin: '1HGCM82633A004355',
      make: 'Ford',
      model: 'Transit',
      year: 2022,
      status: 'maintenance' as const,
      type: 'van',
      capacity: '12 Pax',
      mileage: 65100,
      fleetId: fleet2.id,
    },
    {
      plate: 'DEF-102',
      vin: '1HGCM82633A004356',
      make: 'Nissan',
      model: 'Frontier',
      year: 2020,
      status: 'active' as const,
      type: 'pickup',
      capacity: '1 ton',
      mileage: 102300,
      fleetId: fleet2.id,
    },
    {
      plate: 'DEF-103',
      vin: '1HGCM82633A004357',
      make: 'Mercedes',
      model: 'Sprinter',
      year: 2024,
      status: 'active' as const,
      type: 'van',
      capacity: '15 Pax',
      mileage: 8500,
      fleetId: fleet2.id,
    },
    {
      plate: 'GHI-201',
      vin: '1HGCM82633A004358',
      make: 'Volvo',
      model: 'FH16',
      year: 2019,
      status: 'active' as const,
      type: 'tractomula',
      capacity: '40 ton',
      mileage: 412800,
      fleetId: fleet3.id,
    },
    {
      plate: 'GHI-202',
      vin: '1HGCM82633A004359',
      make: 'Kenworth',
      model: 'T800',
      year: 2020,
      status: 'active' as const,
      type: 'tractomula',
      capacity: '35 ton',
      mileage: 389200,
      fleetId: fleet3.id,
    },
    {
      plate: 'GHI-203',
      vin: '1HGCM82633A004360',
      make: 'Scania',
      model: 'R450',
      year: 2023,
      status: 'decommissioned' as const,
      type: 'tractomula',
      capacity: '40 ton',
      mileage: 52100,
      fleetId: fleet3.id,
    },
    {
      plate: 'GHI-204',
      vin: '1HGCM82633A004361',
      make: 'DAF',
      model: 'XF',
      year: 2024,
      status: 'active' as const,
      type: 'tractomula',
      capacity: '42 ton',
      mileage: 5400,
      fleetId: fleet3.id,
    },
  ];

  const vehicles = [];
  for (const v of vehiclesSpec) {
    const veh = await createEntity(
      'vehicle',
      rec({
        ...v,
        soatExpiry: '2027-06-30',
        tecnoExpiry: '2027-03-15',
        photoUrl: '/img/vehicles/placeholder.png',
      }) as any,
      DEMO_INSTANCE_ID,
    );
    vehicles.push(veh);
  }

  // === CONDUCTORES (5) ===
  const driversSpec = [
    {
      name: 'Carlos Méndez',
      cedula: '79.456.123',
      licenseCategory: 'C1',
      licenseExpiry: '2027-08-15',
      phone: '+57 310 4567890',
      status: 'active',
      fleetId: fleet1.id,
      vehicleId: vehicles[0].id,
    },
    {
      name: 'Lucía Ramírez',
      cedula: '52.847.612',
      licenseCategory: 'B1',
      licenseExpiry: '2026-12-01',
      phone: '+57 311 2345678',
      status: 'active',
      fleetId: fleet1.id,
      vehicleId: vehicles[2].id,
    },
    {
      name: 'Andrés Quintero',
      cedula: '71.245.891',
      licenseCategory: 'C2',
      licenseExpiry: '2025-11-20',
      phone: '+57 312 8765432',
      status: 'suspended',
      fleetId: fleet2.id,
      vehicleId: vehicles[3].id,
    },
    {
      name: 'María López',
      cedula: '43.621.547',
      licenseCategory: 'C1',
      licenseExpiry: '2027-02-28',
      phone: '+57 313 1122334',
      status: 'active',
      fleetId: fleet2.id,
      vehicleId: vehicles[5].id,
    },
    {
      name: 'Pedro Salazar',
      cedula: '16.789.234',
      licenseCategory: 'C3',
      licenseExpiry: '2028-05-10',
      phone: '+57 314 9988776',
      status: 'active',
      fleetId: fleet3.id,
      vehicleId: vehicles[6].id,
    },
  ];
  for (const d of driversSpec) {
    await createEntity('driver', rec(d) as any, DEMO_INSTANCE_ID);
  }

  // === MANTENIMIENTOS (20) ===
  const maintenanceTypes = ['preventivo', 'correctivo', 'predictivo', 'inspección'];
  for (let i = 0; i < 20; i++) {
    const veh = vehicles[i % vehicles.length];
    const type = maintenanceTypes[i % maintenanceTypes.length];
    await createEntity(
      'maintenance',
      rec({
        vehicleId: veh.id,
        type,
        km: 10000 + i * 2500,
        date: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        cost: 150000 + Math.floor(Math.random() * 800000),
        workshop: ['Talleres Andinos', 'Auto Servicio Sur', 'Frenos y Más'][i % 3],
        nextKm: (veh.mileage || 0) + 5000,
        nextDate: new Date(Date.now() + (90 - i * 3) * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
        status: i < 15 ? 'completed' : 'scheduled',
        notes:
          type === 'correctivo' ? 'Falla detectada en ruta, reparación OK' : 'Servicio rutinario',
      }) as any,
      DEMO_INSTANCE_ID,
    );
  }

  // === FUEL LOGS (30) ===
  for (let i = 0; i < 30; i++) {
    const veh = vehicles[i % vehicles.length];
    const gallons = 10 + Math.floor(Math.random() * 30);
    const km = veh.mileage ? Math.floor(veh.mileage * 0.6) + i * 100 : i * 100;
    await createEntity(
      'fuelLog',
      rec({
        vehicleId: veh.id,
        driverId: driversSpec[i % driversSpec.length].cedula,
        date: new Date(Date.now() - i * 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        km,
        gallons,
        cost: gallons * 14500,
        station: ['Terpel', 'Primax', 'Mobil'][i % 3],
        kmPerGallon: 25 + Math.random() * 30,
      }) as any,
      DEMO_INSTANCE_ID,
    );
  }

  // === DOCUMENTOS (8) ===
  const docKinds = ['SOAT', 'Tecnomecánica', 'Tarjeta de propiedad', 'Póliza todo riesgo'];
  for (let i = 0; i < 8; i++) {
    const veh = vehicles[i % vehicles.length];
    await createEntity(
      'document',
      rec({
        vehicleId: veh.id,
        kind: docKinds[i % docKinds.length],
        fileHash: `sha256:${Math.random().toString(36).slice(2)}`,
        r2Key: `documents/${veh.plate}/${docKinds[i % docKinds.length]}.pdf`,
        expiry: new Date(Date.now() + (i % 5) * 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
        status: i < 6 ? 'valid' : 'expiring',
      }) as any,
      DEMO_INSTANCE_ID,
    );
  }

  // === GEOCERCAS (4) ===
  const geofenceSpec = [
    {
      name: 'Centro de Distribución Bogotá',
      fleetId: fleet1.id,
      polygon: '4.7110,-74.0721 4.6510,-74.0721 4.6510,-74.1421 4.7110,-74.1421',
      type: 'depot',
      alertOnEnter: false,
      alertOnExit: true,
    },
    {
      name: 'Cliente Norte - Centro Comercial',
      fleetId: fleet1.id,
      polygon: '4.7350,-74.0500 4.7250,-74.0500 4.7250,-74.0400 4.7350,-74.0400',
      type: 'client',
      alertOnEnter: true,
      alertOnExit: false,
    },
    {
      name: 'Taller Autorizado Medellín',
      fleetId: fleet2.id,
      polygon: '6.2476,-75.5658 6.2376,-75.5658 6.2376,-75.5758 6.2476,-75.5758',
      type: 'service',
      alertOnEnter: true,
      alertOnExit: false,
    },
    {
      name: 'Puerto de Buenaventura',
      fleetId: fleet3.id,
      polygon: '3.8801,-77.0311 3.8601,-77.0311 3.8601,-77.0511 3.8801,-77.0511',
      type: 'port',
      alertOnEnter: true,
      alertOnExit: true,
    },
  ];
  for (const g of geofenceSpec) {
    await createEntity('geofence', rec(g) as any, DEMO_INSTANCE_ID);
  }

  // === ALERTAS (12) ===
  const alertSpec = [
    { kind: 'speed', severity: 'high', message: 'Exceso de velocidad: 130 km/h en zona 80' },
    {
      kind: 'geofence',
      severity: 'medium',
      message: 'Salida no autorizada de geocerca Centro de Distribución',
    },
    { kind: 'maintenance', severity: 'low', message: 'Mantenimiento programado vence en 5 días' },
    { kind: 'document', severity: 'high', message: 'SOAT próximo a vencer - ABC-001' },
    { kind: 'fuel', severity: 'low', message: 'Nivel de combustible bajo (15%)' },
    { kind: 'engine', severity: 'critical', message: 'Código DTC P0420 - Catalizador ineficiente' },
    { kind: 'driver', severity: 'medium', message: 'Conductor sin licencia vigente detectado' },
    { kind: 'speed', severity: 'medium', message: 'Velocidad sostenida sobre límite por 5 min' },
    { kind: 'geofence', severity: 'low', message: 'Entrada a zona restringida fuera de horario' },
    { kind: 'maintenance', severity: 'medium', message: 'Frenos - Pastillas desgastadas (>80%)' },
    { kind: 'document', severity: 'low', message: 'Tecnomecánica vence en 30 días - DEF-102' },
    { kind: 'engine', severity: 'high', message: 'Temperatura refrigerante elevada (105°C)' },
  ];
  for (let i = 0; i < 12; i++) {
    const a = alertSpec[i];
    await createEntity(
      'alert',
      rec({
        ...a,
        vehicleId: vehicles[i % vehicles.length].id,
        fleetId: vehicles[i % vehicles.length].fleetId,
        acknowledged: i < 4,
      }) as any,
      DEMO_INSTANCE_ID,
    );
  }

  // === TELEMETRÍA (50 muestras — últimas 24h) ===
  for (let i = 0; i < 50; i++) {
    const veh = vehicles[i % vehicles.length];
    await createEntity(
      'telemetry',
      rec({
        vin: veh.vin,
        timestamp: Date.now() - i * 30 * 60 * 1000,
        speed: 40 + Math.floor(Math.random() * 80),
        rpm: 1500 + Math.floor(Math.random() * 1500),
        coolantTemp: 80 + Math.floor(Math.random() * 25),
        fuelLevel: 30 + Math.floor(Math.random() * 70),
        latitude: 4.7 + (Math.random() - 0.5) * 0.2,
        longitude: -74.1 + (Math.random() - 0.5) * 0.2,
        troubleCodes: i % 10 === 0 ? ['P0420'] : [],
        odometer: (veh.mileage || 0) + i * 5,
        hours: 1000 + i * 50,
      }) as any,
      DEMO_INSTANCE_ID,
    );
  }

  markLoaded(instanceId);
}

/**
 * Cuenta total de entidades — usado en dashboard KPIs.
 *
 * El tenant es OBLIGATORIO y lo recibe el endpoint, nunca se deduce aqui. Esta
 * funcion vivia cableada a DEMO_INSTANCE_ID en sus ocho llamadas, de modo que
 * `/api/fleet/stats` resolvia el tenant de la sesion, lo devolvia en el JSON
 * para dar la impresion de estar filtrado, y en realidad contaba los KPIs del
 * tenant de los datos de ejemplo: los numeros del panel eran los mismos para
 * todos los clientes.
 */
export async function getFleetStats(instanceId: string) {
  if (!instanceId) {
    throw new Error('getFleetStats necesita un tenant; no hay dato global que mostrar');
  }
  const [fleets, vehicles, drivers, maintenance, fuelLogs, docs, geofences, alerts] =
    await Promise.all([
      listEntities('fleet', instanceId),
      listEntities('vehicle', instanceId),
      listEntities('driver', instanceId),
      listEntities('maintenance', instanceId),
      listEntities('fuelLog', instanceId),
      listEntities('document', instanceId),
      listEntities('geofence', instanceId),
      listEntities('alert', instanceId),
    ]);

  const activeVehicles = vehicles.filter((v: any) => v.status === 'active').length;
  const maintenanceVehicles = vehicles.filter((v: any) => v.status === 'maintenance').length;
  const decommissioned = vehicles.filter((v: any) => v.status === 'decommissioned').length;
  const totalMileage = vehicles.reduce((acc: number, v: any) => acc + (v.mileage || 0), 0);

  const unackAlerts = alerts.filter((a: any) => !a.acknowledged).length;
  const criticalAlerts = alerts.filter(
    (a: any) => a.severity === 'critical' && !a.acknowledged,
  ).length;

  const totalFuelCost = fuelLogs.reduce((acc: number, f: any) => acc + (f.cost || 0), 0);
  const totalMaintCost = maintenance.reduce((acc: number, m: any) => acc + (m.cost || 0), 0);

  return {
    fleets: fleets.length,
    vehicles: vehicles.length,
    activeVehicles,
    maintenanceVehicles,
    decommissioned,
    totalMileage,
    drivers: drivers.length,
    maintenance: maintenance.length,
    fuelLogs: fuelLogs.length,
    documents: docs.length,
    geofences: geofences.length,
    alerts: alerts.length,
    unackAlerts,
    criticalAlerts,
    totalFuelCost,
    totalMaintCost,
  };
}
