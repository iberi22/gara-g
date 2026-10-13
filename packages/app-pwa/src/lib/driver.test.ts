import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEntity,
  listEntities,
  getEntity,
  updateEntity,
  deleteEntity,
  getMemoryAdapter,
  setStorageAdapter,
} from './domain.js';
import { computeDriverStatus, formatDriverId, isValidDriverId } from './driver.js';
import { MARKETS } from './market.js';

describe('driver domain and CRUD', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    setStorageAdapter(getMemoryAdapter());
  });

  it('Driver CRUD lifecycle: create -> list -> get -> update -> delete', async () => {
    const driverData = {
      name: 'Carlos Mendoza',
      cedula: '1098765432',
      licenseCategory: 'C2',
      licenseExpiry: '2028-12-31',
      phone: '+573001234567',
      status: 'active',
      fleetId: 'fleet-north',
      vehicleId: 'veh-101',
    };

    // 1. Create driver entity
    const created = await createEntity('driver', driverData, 'inst1');
    expect(created.id).toBeTruthy();
    expect(created.instance_id).toBe('inst1');
    expect(created.cedula).toBe('1098765432');

    // 2. List drivers for instance
    const list = await listEntities('driver', 'inst1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].name).toBe('Carlos Mendoza');

    // 3. Get driver by ID
    const retrieved = await getEntity('driver', created.id, 'inst1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('Carlos Mendoza');
    expect(retrieved?.vehicleId).toBe('veh-101');

    // 4. Update driver status and vehicle assignment
    const updated = await updateEntity('driver', created.id, { status: 'on_leave', vehicleId: 'veh-102' }, 'inst1');
    expect(updated?.status).toBe('on_leave');
    expect(updated?.vehicleId).toBe('veh-102');

    // 5. Delete driver
    const deleted = await deleteEntity('driver', created.id, 'inst1');
    expect(deleted).toBe(true);

    const postDelete = await getEntity('driver', created.id, 'inst1');
    expect(postDelete).toBeNull();
  });

  it('Driver isolation between instances (inst1 vs inst2)', async () => {
    const driverInst1 = await createEntity('driver', {
      name: 'Driver Instance 1',
      cedula: '11111111',
      licenseCategory: 'B1',
      licenseExpiry: '2027-01-01',
      phone: '+573000000001',
      status: 'active',
      fleetId: 'fleet-1',
      vehicleId: 'v-1',
    }, 'inst1');

    const driverInst2 = await createEntity('driver', {
      name: 'Driver Instance 2',
      cedula: '22222222',
      licenseCategory: 'C1',
      licenseExpiry: '2027-01-01',
      phone: '+573000000002',
      status: 'active',
      fleetId: 'fleet-2',
      vehicleId: 'v-2',
    }, 'inst2');

    expect(driverInst1.instance_id).toBe('inst1');
    expect(driverInst2.instance_id).toBe('inst2');

    const listInst1 = await listEntities('driver', 'inst1');
    const listInst2 = await listEntities('driver', 'inst2');

    expect(listInst1).toHaveLength(1);
    expect(listInst1[0].name).toBe('Driver Instance 1');

    expect(listInst2).toHaveLength(1);
    expect(listInst2[0].name).toBe('Driver Instance 2');

    // Verify cross-instance access returns null
    const crossAccess = await getEntity('driver', driverInst1.id, 'inst2');
    expect(crossAccess).toBeNull();
  });

  it('la identificacion del conductor se lee y se valida segun el mercado', () => {
    // Chile (mercado activo): RUT con digito verificador.
    expect(formatDriverId('123456785', MARKETS.CL)).toBe('12.345.678-5');
    expect(isValidDriverId('123456785', MARKETS.CL)).toBe(true);
    expect(isValidDriverId('123456784', MARKETS.CL)).toBe(false);
    // Un valor que no se puede leer se muestra tal cual: no se reescribe ni se descarta.
    expect(formatDriverId('80123456', MARKETS.CL)).toBe('80123456');
    expect(formatDriverId('', MARKETS.CL)).toBe('—');
    // Colombia: la cedula no trae digito verificador, asi que solo se exige que no este vacia.
    expect(formatDriverId('79.456.123', MARKETS.CO)).toBe('79.456.123');
    expect(isValidDriverId('79.456.123', MARKETS.CO)).toBe(true);
    expect(isValidDriverId('', MARKETS.CO)).toBe(false);
  });

  it('License expiry validation: driver with licenseExpiry in the past is marked as expired in computed status', () => {
    const activeDriver = {
      name: 'Juan Perez',
      status: 'active',
      licenseExpiry: '2030-01-01',
    };
    expect(computeDriverStatus(activeDriver)).toBe('active');

    const expiredDriver = {
      name: 'Pedro Gomez',
      status: 'active',
      licenseExpiry: '2020-01-01',
    };
    expect(computeDriverStatus(expiredDriver)).toBe('expired');

    const suspendedDriverWithFutureExpiry = {
      name: 'Maria Lopez',
      status: 'suspended',
      licenseExpiry: '2030-01-01',
    };
    expect(computeDriverStatus(suspendedDriverWithFutureExpiry)).toBe('suspended');
  });
});
