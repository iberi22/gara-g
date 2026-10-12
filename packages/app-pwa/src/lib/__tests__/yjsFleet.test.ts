import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsFleetManager } from '../yjsFleet.js';
import { createFleetStore } from '../fleetStore.js';

describe('YjsFleetManager & FleetStore', () => {
  let doc: Y.Doc;
  let manager: YjsFleetManager;

  beforeEach(() => {
    doc = new Y.Doc();
    manager = new YjsFleetManager('test-instance', doc);
  });

  it('should create and list fleets', () => {
    const fleet = manager.createFleet({
      id: 'fleet-1',
      name: 'North Region Fleet',
      organizationId: 'org-100',
      region: 'North America',
      tags: ['delivery', 'ev'],
    });

    expect(fleet.id).toBe('fleet-1');
    expect(fleet.createdAt).toBeGreaterThan(0);

    const fleets = manager.listFleets();
    expect(fleets.length).toBe(1);
    expect(fleets[0].name).toBe('North Region Fleet');
  });

  it('should update fleet details', () => {
    manager.createFleet({
      id: 'fleet-1',
      name: 'Old Name',
      organizationId: 'org-100',
      region: 'North',
      tags: [],
    });

    const updated = manager.updateFleet('fleet-1', { name: 'New Name' });
    expect(updated?.name).toBe('New Name');
    expect(manager.getFleet('fleet-1')?.name).toBe('New Name');
  });

  it('should delete fleet and associated vehicles', () => {
    manager.createFleet({
      id: 'fleet-1',
      name: 'Fleet To Delete',
      organizationId: 'org-1',
      region: 'South',
      tags: [],
    });

    manager.addVehicle({
      id: 'veh-1',
      fleetId: 'fleet-1',
      vin: 'VIN123',
      make: 'Tesla',
      model: 'Model Y',
      year: 2024,
      status: 'active',
      mileage: 12000,
    });

    expect(manager.listFleets().length).toBe(1);
    expect(manager.listVehicles().length).toBe(1);

    const deleted = manager.deleteFleet('fleet-1');
    expect(deleted).toBe(true);
    expect(manager.listFleets().length).toBe(0);
    expect(manager.listVehicles().length).toBe(0);
  });

  it('should manage vehicle CRUD operations', () => {
    manager.addVehicle({
      id: 'veh-1',
      fleetId: 'fleet-1',
      vin: 'VIN999',
      make: 'Ford',
      model: 'Lightning',
      year: 2023,
      status: 'active',
      mileage: 5000,
    });

    expect(manager.getVehicle('veh-1')?.make).toBe('Ford');

    manager.updateVehicle('veh-1', { status: 'maintenance', mileage: 5500 });
    const veh = manager.getVehicle('veh-1');
    expect(veh?.status).toBe('maintenance');
    expect(veh?.mileage).toBe(5500);

    const filtered = manager.listVehicles('fleet-1');
    expect(filtered.length).toBe(1);

    const nonExistent = manager.listVehicles('fleet-2');
    expect(nonExistent.length).toBe(0);

    manager.deleteVehicle('veh-1');
    expect(manager.getVehicle('veh-1')).toBeUndefined();
  });

  it('should support Yjs state replication between instances', () => {
    const doc2 = new Y.Doc();
    const manager2 = new YjsFleetManager('test-instance', doc2);

    manager.createFleet({
      id: 'replicated-fleet',
      name: 'Sync Fleet',
      organizationId: 'org-sync',
      region: 'EU',
      tags: ['sync'],
    });

    // Simulate Yjs sync update
    const update = Y.encodeStateAsUpdate(doc);
    Y.applyUpdate(doc2, update);

    expect(manager2.getFleet('replicated-fleet')?.name).toBe('Sync Fleet');
  });
});
