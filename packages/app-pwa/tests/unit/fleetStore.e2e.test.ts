import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { createFleetStore, getFleetManager } from '../../src/lib/fleetStore.js';
import { YjsFleetManager, IndexedDBStorageManager } from '../../src/lib/yjsFleet.js';
import {
  createSealedPack,
  verifySealedPackHash,
  unpackSealedPack,
} from '../../src/lib/sealedPack.js';
import { R2StorageClient } from '../../src/lib/r2Client.js';
import { cloud } from '../../src/cloud/index.js';

describe('FleetStore & IndexedDB E2E Unit Test Suite', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let managerA: YjsFleetManager;
  let managerB: YjsFleetManager;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    managerA = new YjsFleetManager('unit-e2e-shared-instance', docA);
    managerB = new YjsFleetManager('unit-e2e-shared-instance', docB);
  });

  it('should initialize fleet store and list empty initial fleets and vehicles', () => {
    const store = createFleetStore('unit-init-test');
    expect(store.listFleets()).toEqual([]);
    expect(store.listVehicles()).toEqual([]);
    expect(store.fleets).toEqual([]);
    expect(store.vehicles).toEqual([]);
  });

  it('should perform full Fleet CRUD lifecycle with subscription notifications', () => {
    const manager = new YjsFleetManager('unit-crud-fleet', new Y.Doc());
    let callbackCalled = 0;
    const unsubscribe = manager.subscribe(() => {
      callbackCalled++;
    });

    const newFleet = manager.createFleet({
      id: 'fleet-north-1',
      name: 'North Logistics Fleet',
      organizationId: 'org-swal-01',
      region: 'North America',
      tags: ['ev', 'autonomous', 'logistics'],
    });

    expect(newFleet.id).toBe('fleet-north-1');
    expect(newFleet.createdAt).toBeGreaterThan(0);
    expect(manager.getFleet('fleet-north-1')?.name).toBe('North Logistics Fleet');
    expect(callbackCalled).toBeGreaterThan(0);

    const updated = manager.updateFleet('fleet-north-1', {
      name: 'North Regional Fleet Updated',
      region: 'US-East',
    });

    expect(updated?.name).toBe('North Regional Fleet Updated');
    expect(updated?.region).toBe('US-East');

    const listed = manager.listFleets();
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe('fleet-north-1');

    unsubscribe();
  });

  it('should perform Vehicle CRUD operations and filter by fleetId', () => {
    const manager = new YjsFleetManager('unit-crud-veh', new Y.Doc());

    manager.createFleet({
      id: 'fleet-alpha',
      name: 'Alpha Fleet',
      organizationId: 'org-1',
      region: 'US-West',
      tags: [],
    });

    manager.addVehicle({
      id: 'veh-001',
      fleetId: 'fleet-alpha',
      vin: '1HGCR2F83HA000101',
      make: 'Tesla',
      model: 'Model 3',
      year: 2024,
      status: 'active',
      mileage: 15000,
    });

    manager.addVehicle({
      id: 'veh-002',
      fleetId: 'fleet-beta',
      vin: '1HGCR2F83HA000102',
      make: 'Ford',
      model: 'F-150 Lightning',
      year: 2023,
      status: 'active',
      mileage: 22000,
    });

    expect(manager.getVehicle('veh-001')?.make).toBe('Tesla');
    expect(manager.listVehicles('fleet-alpha').length).toBe(1);
    expect(manager.listVehicles('fleet-alpha')[0].id).toBe('veh-001');

    manager.updateVehicle('veh-001', { status: 'maintenance', mileage: 15800 });
    const vehUpdated = manager.getVehicle('veh-001');
    expect(vehUpdated?.status).toBe('maintenance');
    expect(vehUpdated?.mileage).toBe(15800);

    const deletedVeh = manager.deleteVehicle('veh-002');
    expect(deletedVeh).toBe(true);
    expect(manager.getVehicle('veh-002')).toBeUndefined();
  });

  it('should cascade vehicle deletion when parent fleet is deleted', () => {
    const manager = new YjsFleetManager('unit-cascade-del', new Y.Doc());

    manager.createFleet({
      id: 'fleet-cascade-target',
      name: 'Fleet To Delete',
      organizationId: 'org-del',
      region: 'EU-Central',
      tags: [],
    });

    manager.addVehicle({
      id: 'veh-cascaded-1',
      fleetId: 'fleet-cascade-target',
      vin: '1HGCR2F83HA000888',
      make: 'Rivian',
      model: 'EDV700',
      year: 2024,
      status: 'active',
      mileage: 8000,
    });

    expect(manager.listFleets().length).toBe(1);
    expect(manager.listVehicles('fleet-cascade-target').length).toBe(1);

    const isDeleted = manager.deleteFleet('fleet-cascade-target');
    expect(isDeleted).toBe(true);
    expect(manager.getFleet('fleet-cascade-target')).toBeUndefined();
    expect(manager.listVehicles('fleet-cascade-target').length).toBe(0);
    expect(manager.getVehicle('veh-cascaded-1')).toBeUndefined();
  });

  it('should simulate IndexedDB load/save binary update state persistence', async () => {
    const dbName = 'test-swal-gara-g-db';
    const storageManager = new IndexedDBStorageManager(dbName);
    await storageManager.init();

    // Create mock update binary payload representing Yjs state
    const originalDoc = new Y.Doc();
    const map = originalDoc.getMap('test-map');
    map.set('key1', 'value1');
    const stateUpdate = Y.encodeStateAsUpdate(originalDoc);

    expect(stateUpdate).toBeInstanceOf(Uint8Array);
    expect(stateUpdate.length).toBeGreaterThan(0);

    // Mock IndexedDB load/save behavior for node vitest environment
    let savedState: Uint8Array | null = null;
    vi.spyOn(storageManager, 'save').mockImplementation(async (upd: Uint8Array) => {
      savedState = upd;
    });
    vi.spyOn(storageManager, 'load').mockImplementation(async () => {
      return savedState;
    });

    await storageManager.save(stateUpdate);
    const restoredState = await storageManager.load();

    expect(restoredState).not.toBeNull();
    expect(restoredState).toEqual(stateUpdate);

    const restoredDoc = new Y.Doc();
    if (restoredState) {
      Y.applyUpdate(restoredDoc, restoredState);
    }
    const restoredMap = restoredDoc.getMap('test-map');
    expect(restoredMap.get('key1')).toBe('value1');
  });

  it('should seal vehicle telemetry into AES-GCM pack, upload to R2 mock, and not anchor without cloud', async () => {
    const telemetryData = {
      vin: '1HGCR2F83HA000999',
      timestamp: Date.now(),
      speed: 74.2,
      rpm: 2500,
      coolantTemp: 90,
      fuelLevel: 82.5,
      latitude: 40.7128,
      longitude: -74.006,
    };

    const payload = new TextEncoder().encode(JSON.stringify(telemetryData));
    const metadata = {
      vehicleId: 'veh-telemetry-01',
      timestamp: Date.now(),
      recordCount: 1,
      deviceId: 'obd2-adapter-2026',
    };

    // 1. Create sealed pack with AES-256-GCM and Shamir 2/3 DEK shares
    const sealedPack = await createSealedPack(payload, metadata);

    expect(sealedPack.id).toMatch(/^pack-/);
    expect(sealedPack.content_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(sealedPack.shares.length).toBe(3);
    expect(sealedPack.chain).toBe('polygon');

    // 2. Verify content hash and decrypt payload from 2 shares
    const isHashValid = await verifySealedPackHash(sealedPack);
    expect(isHashValid).toBe(true);

    const decryptedPayload = await unpackSealedPack(sealedPack, [
      sealedPack.shares[0],
      sealedPack.shares[1],
    ]);
    const reconstructedData = JSON.parse(new TextDecoder().decode(decryptedPayload));
    expect(reconstructedData.vin).toBe('1HGCR2F83HA000999');

    // 3. Upload to mock R2StorageClient
    const r2Client = new R2StorageClient({ bucketName: 'swal-r2-test-bucket' });
    const r2Result = await r2Client.uploadSealedPack(sealedPack);

    expect(r2Result.contentHash).toBe(sealedPack.content_hash);
    expect(r2Result.url).toContain('swal-r2-test-bucket');

    const retrievedPack = await r2Client.getSealedPack(sealedPack.content_hash);
    expect(retrievedPack?.content_hash).toBe(sealedPack.content_hash);

    // 4. Without the optional cloud module nothing is anchored on-chain (src/cloud/local.ts).
    //    The Polygon anchoring test lives with the private cloud module.
    expect(cloud.anchor.registerOnPolygon(sealedPack, {})).toBeUndefined();
  });

  it('should resolve concurrent CRDT updates deterministically between two Yjs instances', () => {
    // Instance A creates fleet
    managerA.createFleet({
      id: 'concurrent-fleet-1',
      name: 'Initial Name Fleet A',
      organizationId: 'org-crdt',
      region: 'North',
      tags: ['crdt'],
    });

    // Sync initial state from A to B
    const updateInit = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, updateInit);

    expect(managerB.getFleet('concurrent-fleet-1')?.name).toBe('Initial Name Fleet A');

    // Concurrent edit: Instance A updates name, Instance B adds vehicle
    managerA.updateFleet('concurrent-fleet-1', { name: 'Name Updated by A' });
    managerB.addVehicle({
      id: 'veh-concurrent-1',
      fleetId: 'concurrent-fleet-1',
      vin: '1HGCR2F83HA000777',
      make: 'BMW',
      model: 'i4',
      year: 2025,
      status: 'active',
      mileage: 3200,
    });

    // Exchange delta updates
    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docB, updateA);
    Y.applyUpdate(docA, updateB);

    // Both instances should converge deterministically
    expect(managerA.getFleet('concurrent-fleet-1')?.name).toBe('Name Updated by A');
    expect(managerB.getFleet('concurrent-fleet-1')?.name).toBe('Name Updated by A');

    expect(managerA.getVehicle('veh-concurrent-1')?.make).toBe('BMW');
    expect(managerB.getVehicle('veh-concurrent-1')?.make).toBe('BMW');
  });
});
