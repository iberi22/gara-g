import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

describe('Mesh Sync & CRDT Integration Logic', () => {
  let doc1: Y.Doc;
  let doc2: Y.Doc;

  beforeEach(() => {
    doc1 = new Y.Doc();
    doc2 = new Y.Doc();
  });

  it('should synchronize Yjs maps across 2 peer documents using state update vectors', () => {
    const map1 = doc1.getMap('fleets');
    const map2 = doc2.getMap('fleets');

    map1.set('fleet_01', { name: 'Alpha Fleet', vehicles: 5 });

    // Sync doc1 -> doc2
    const update = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update);

    const syncedFleet = map2.get('fleet_01') as { name: string; vehicles: number };
    expect(syncedFleet).toBeDefined();
    expect(syncedFleet.name).toBe('Alpha Fleet');
    expect(syncedFleet.vehicles).toBe(5);
  });

  it('should handle late joining 3rd peer by applying state vector delta', () => {
    const doc3 = new Y.Doc();
    const map1 = doc1.getMap('fleets');
    const map3 = doc3.getMap('fleets');

    map1.set('fleet_01', { name: 'Alpha Fleet' });

    // Late sync to doc3
    const stateVector3 = Y.encodeStateVector(doc3);
    const delta = Y.encodeStateAsUpdate(doc1, stateVector3);
    Y.applyUpdate(doc3, delta);

    expect(map3.get('fleet_01')).toEqual({ name: 'Alpha Fleet' });
  });

  it('should buffer offline operations and merge deterministically upon reconnection', () => {
    const map1 = doc1.getMap('vehicles');
    const map2 = doc2.getMap('vehicles');

    // Peer 1 creates 10 offline edits
    for (let i = 1; i <= 10; i++) {
      map1.set(`veh_${i}`, { vin: `VIN_${i}`, status: 'active', mileage: i * 1000 });
    }

    expect(map1.size).toBe(10);
    expect(map2.size).toBe(0);

    // Reconnect: sync doc1 -> doc2
    const update = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update);

    expect(map2.size).toBe(10);
    const veh5 = map2.get('veh_5') as { vin: string; mileage: number };
    expect(veh5.vin).toBe('VIN_5');
    expect(veh5.mileage).toBe(5000);
  });

  it('should resolve concurrent LWW edits deterministically in Yjs', () => {
    const map1 = doc1.getMap('vehicles');
    const map2 = doc2.getMap('vehicles');

    // Concurrent edits
    map1.set('veh_99', { status: 'in_service', clock: 100 });
    map2.set('veh_99', { status: 'decommissioned', clock: 200 });

    // Cross-apply updates
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);

    Y.applyUpdate(doc2, update1);
    Y.applyUpdate(doc1, update2);

    // Both docs should converge to identical state
    const state1 = map1.get('veh_99');
    const state2 = map2.get('veh_99');

    expect(state1).toEqual(state2);
  });

  it('should route edge-mesh direct messages and update Y.Array event logs', () => {
    const eventArray1 = doc1.getArray('swal/gara-g/econ');
    const eventArray2 = doc2.getArray('swal/gara-g/econ');

    const mockEvent = {
      actionType: 'FLEET_SYNC_BROADCAST',
      nodeId: 'node_peer_alpha',
      timestamp: Date.now(),
      value: 'fleet_update_broadcast_01',
    };

    eventArray1.push([mockEvent]);

    const update = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update);

    expect(eventArray2.length).toBe(1);
    const received = eventArray2.get(0) as typeof mockEvent;
    expect(received.actionType).toBe('FLEET_SYNC_BROADCAST');
    expect(received.nodeId).toBe('node_peer_alpha');
  });
});
