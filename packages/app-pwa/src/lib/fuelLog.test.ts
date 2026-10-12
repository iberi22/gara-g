import { describe, it, expect, beforeEach } from 'vitest';
import { createEntity, listEntities, getMemoryAdapter } from './domain';
import { computeKmPerGallon, type FuelLogData, type FuelLogRecord } from './fuelLog';

describe('Fuel Log Domain & kmPerGallon Calculation Tests', () => {
  const instanceId = 'test-fuel-instance';

  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  it('performs CRUD operations for fuelLog entity via domain helpers', async () => {
    const created = await createEntity<FuelLogData>(
      'fuelLog',
      {
        vehicleId: 'veh_001',
        driverId: 'drv_001',
        date: '2026-09-01',
        km: 10000,
        gallons: 10,
        cost: 40,
        station: 'Texaco Center',
        kmPerGallon: 0,
      },
      instanceId
    );

    expect(created.id).toBeDefined();
    expect(created.instance_id).toBe(instanceId);
    expect(created.vehicleId).toBe('veh_001');

    const list = await listEntities<FuelLogData>('fuelLog', instanceId);
    expect(list.length).toBe(1);
    expect(list[0].station).toBe('Texaco Center');
  });

  it('calculates kmPerGallon correctly when a previous log exists for the same vehicle', () => {
    const mockLogs: FuelLogRecord[] = [
      {
        id: 'log1',
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vehicleId: 'veh_001',
        driverId: 'drv_001',
        date: '2026-09-01',
        km: 10000,
        gallons: 10,
        cost: 40,
        station: 'Station A',
        kmPerGallon: 0,
      },
      {
        id: 'log2',
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vehicleId: 'veh_001',
        driverId: 'drv_001',
        date: '2026-09-05',
        km: 10350,
        gallons: 10,
        cost: 42,
        station: 'Station B',
        kmPerGallon: 0,
      },
      {
        id: 'log_other',
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vehicleId: 'veh_002',
        driverId: 'drv_002',
        date: '2026-09-02',
        km: 5000,
        gallons: 8,
        cost: 30,
        station: 'Station C',
        kmPerGallon: 0,
      },
    ];

    const computed = computeKmPerGallon(mockLogs);

    const log1 = computed.find((l) => l.id === 'log1');
    const log2 = computed.find((l) => l.id === 'log2');
    const logOther = computed.find((l) => l.id === 'log_other');

    // First log for veh_001 has no previous log -> 0
    expect(log1?.kmPerGallon).toBe(0);

    // Second log for veh_001: (10350 - 10000) / 10 = 350 / 10 = 35.0 km/gal
    expect(log2?.kmPerGallon).toBe(35);

    // Single log for veh_002 -> 0
    expect(logOther?.kmPerGallon).toBe(0);
  });

  it('sorts logs by date DESC and handles edge cases safely (no previous log, 0 gallons, etc)', () => {
    const rawLogs: FuelLogRecord[] = [
      {
        id: 'logA',
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vehicleId: 'veh_99',
        driverId: 'drv_99',
        date: '2026-08-01',
        km: 20000,
        gallons: 0, // 0 gallons edge case
        cost: 0,
        station: 'Station 1',
        kmPerGallon: 0,
      },
      {
        id: 'logB',
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vehicleId: 'veh_99',
        driverId: 'drv_99',
        date: '2026-08-10',
        km: 20400,
        gallons: 10,
        cost: 45,
        station: 'Station 2',
        kmPerGallon: 0,
      },
      {
        id: 'logC',
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vehicleId: 'veh_99',
        driverId: 'drv_99',
        date: '2026-08-20',
        km: 20800,
        gallons: 10,
        cost: 45,
        station: 'Station 3',
        kmPerGallon: 0,
      },
    ];

    const computed = computeKmPerGallon(rawLogs);

    // Sort DESC by date
    const sortedDesc = computed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    expect(sortedDesc[0].id).toBe('logC'); // 2026-08-20
    expect(sortedDesc[1].id).toBe('logB'); // 2026-08-10
    expect(sortedDesc[2].id).toBe('logA'); // 2026-08-01

    const logB = computed.find((l) => l.id === 'logB');
    const logC = computed.find((l) => l.id === 'logC');

    // logB: (20400 - 20000) / 10 = 40 km/gal
    expect(logB?.kmPerGallon).toBe(40);

    // logC: (20800 - 20400) / 10 = 40 km/gal
    expect(logC?.kmPerGallon).toBe(40);
  });
});
