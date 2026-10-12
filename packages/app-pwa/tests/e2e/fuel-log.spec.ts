import { test, expect } from './fixtures';
import { createEntity, listEntities, deleteEntity } from '../../src/lib/domain.js';
import { computeKmPerGallon, type FuelLogData } from '../../src/lib/fuelLog.js';

test.describe('PWA Fuel Consumption Log Table & kmPerGallon E2E / Domain Integration', () => {
  const instanceId = 'e2e-fuel-test-instance';

  test('should create fuel logs in domain store and compute kmPerGallon correctly', async () => {
    // 1. Initial log entry (10,000 km, 10 gallons)
    const log1 = await createEntity<FuelLogData>(
      'fuelLog',
      {
        vehicleId: 'VEH-E2E-01',
        driverId: 'DRV-E2E-01',
        date: '2026-09-01',
        km: 10000,
        gallons: 10,
        cost: 150000,
        station: 'Terpel El Dorado',
        kmPerGallon: 0,
      },
      instanceId
    );

    expect(log1.id).toBeDefined();
    expect(log1.vehicleId).toBe('VEH-E2E-01');

    // 2. Second log entry (10,350 km, 10 gallons -> 35.00 km/gal)
    const log2 = await createEntity<FuelLogData>(
      'fuelLog',
      {
        vehicleId: 'VEH-E2E-01',
        driverId: 'DRV-E2E-01',
        date: '2026-09-05',
        km: 10350,
        gallons: 10,
        cost: 155000,
        station: 'Terpel Calle 80',
        kmPerGallon: 0,
      },
      instanceId
    );

    expect(log2.id).toBeDefined();

    // 3. Retrieve logs from store and compute kmPerGallon
    const rawLogs = await listEntities<FuelLogData>('fuelLog', instanceId);
    expect(rawLogs.length).toBe(2);

    const computed = computeKmPerGallon(rawLogs);
    const sortedDesc = computed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Most recent log should be first in DESC order
    expect(sortedDesc[0].date).toBe('2026-09-05');
    expect(sortedDesc[0].kmPerGallon).toBe(35);

    // Initial log has no previous entry -> 0 km/gal
    expect(sortedDesc[1].date).toBe('2026-09-01');
    expect(sortedDesc[1].kmPerGallon).toBe(0);
  });

  test('should filter fuel logs by vehicleId and perform deletions', async () => {
    await createEntity<FuelLogData>(
      'fuelLog',
      {
        vehicleId: 'TRUCK-100',
        driverId: 'DRV-1',
        date: '2026-09-01',
        km: 50000,
        gallons: 20,
        cost: 300000,
        station: 'Texaco',
        kmPerGallon: 0,
      },
      instanceId
    );

    const vanLog = await createEntity<FuelLogData>(
      'fuelLog',
      {
        vehicleId: 'VAN-200',
        driverId: 'DRV-2',
        date: '2026-09-02',
        km: 12000,
        gallons: 8,
        cost: 120000,
        station: 'Shell',
        kmPerGallon: 0,
      },
      instanceId
    );

    const allLogs = await listEntities<FuelLogData>('fuelLog', instanceId);
    const truckLogs = allLogs.filter((l) => l.vehicleId === 'TRUCK-100');
    expect(truckLogs.length).toBe(1);
    expect(truckLogs[0].station).toBe('Texaco');

    // Delete VAN-200 log
    const deleted = await deleteEntity('fuelLog', vanLog.id, instanceId);
    expect(deleted).toBe(true);

    const remainingLogs = await listEntities<FuelLogData>('fuelLog', instanceId);
    const vanLogsRemaining = remainingLogs.filter((l) => l.vehicleId === 'VAN-200');
    expect(vanLogsRemaining.length).toBe(0);
  });
});
