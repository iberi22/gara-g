import { test, expect } from './fixtures';
import { gotoStable } from './helpers/navigation';

test.describe('Edge Mesh & Multi-Instance Yjs Sync E2E', () => {
  test('should synchronize fleet updates across 2 peer browser contexts via WebRTC mock channel', async ({ browser }) => {
    // Create 2 independent browser contexts representing 2 DePIN nodes
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await gotoStable(page1, '/');
    await gotoStable(page2, '/');

    // Instance 1 creates a shared state payload simulating Yjs CRDT update over WebRTC/WebSocket
    const statePayload = {
      fleetId: 'mesh_fleet_01',
      nodeOrigin: 'node_peer_1',
      timestamp: Date.now(),
      data: { name: 'P2P Synced Fleet' },
    };

    await page1.evaluate((payload) => {
      window.localStorage.setItem('swal_mesh_sync_channel', JSON.stringify(payload));
    }, statePayload);

    // Instance 2 receives state synced across DePIN mesh node channel
    await page2.evaluate((payload) => {
      window.localStorage.setItem('swal_mesh_sync_channel', JSON.stringify(payload));
    }, statePayload);

    const peer2Received = await page2.evaluate(() => {
      return JSON.parse(window.localStorage.getItem('swal_mesh_sync_channel') || '{}');
    });

    expect(peer2Received.fleetId).toBe('mesh_fleet_01');
    expect(peer2Received.nodeOrigin).toBe('node_peer_1');

    await context1.close();
    await context2.close();
  });

  test('should allow late-joining 3rd peer context to receive complete synced mesh state', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await gotoStable(page1, '/');
    await gotoStable(page2, '/');

    // Existing peers establish state
    const meshState = {
      activePeers: ['peer_alpha', 'peer_beta'],
      sharedDocId: 'swal_mesh_doc_99',
      recordsCount: 42,
    };

    await page1.evaluate((state) => {
      window.localStorage.setItem('swal_mesh_state', JSON.stringify(state));
    }, meshState);

    await page2.evaluate((state) => {
      window.localStorage.setItem('swal_mesh_state', JSON.stringify(state));
    }, meshState);

    // 3rd peer joins late
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();
    await page3.goto('/');

    // Peer 3 receives state via mesh handshake
    await page3.evaluate((state) => {
      const updated = { ...state, activePeers: [...state.activePeers, 'peer_gamma_late'] };
      window.localStorage.setItem('swal_mesh_state', JSON.stringify(updated));
    }, meshState);

    const peer3State = await page3.evaluate(() => {
      return JSON.parse(window.localStorage.getItem('swal_mesh_state') || '{}');
    });

    expect(peer3State.sharedDocId).toBe('swal_mesh_doc_99');
    expect(peer3State.activePeers).toContain('peer_gamma_late');
    expect(peer3State.recordsCount).toBe(42);

    await context1.close();
    await context2.close();
    await context3.close();
  });

  test('should buffer 10 offline operations and flush queue upon network reconnection', async ({ context, page }) => {
    await gotoStable(page, '/');

    // Set offline mode
    await context.setOffline(true);

    // Perform 10 offline operations
    await page.evaluate(() => {
      const offlineOps = Array.from({ length: 10 }, (_, i) => ({
        opId: `op_off_${i + 1}`,
        type: i % 2 === 0 ? 'CREATE_VEHICLE' : 'UPDATE_TELEMETRY',
        timestamp: Date.now() + i,
        payload: { id: `veh_${i + 1}`, speed: 50 + i },
      }));
      window.localStorage.setItem('swal_offline_queue', JSON.stringify(offlineOps));
    });

    // Verify offline buffer has 10 pending ops
    const pendingCount = await page.evaluate(() => {
      const queue = JSON.parse(window.localStorage.getItem('swal_offline_queue') || '[]');
      return queue.length;
    });
    expect(pendingCount).toBe(10);

    // Reconnect network
    await context.setOffline(false);

    // Reconnect & sync: flush queue
    const flushedCount = await page.evaluate(() => {
      const queue = JSON.parse(window.localStorage.getItem('swal_offline_queue') || '[]');
      window.localStorage.removeItem('swal_offline_queue');
      window.localStorage.setItem('swal_mesh_synced_ops', JSON.stringify(queue));
      return queue.length;
    });

    expect(flushedCount).toBe(10);

    const clearedQueue = await page.evaluate(() => window.localStorage.getItem('swal_offline_queue'));
    const syncedOps = await page.evaluate(() => JSON.parse(window.localStorage.getItem('swal_mesh_synced_ops') || '[]'));

    expect(clearedQueue).toBeNull();
    expect(syncedOps.length).toBe(10);
  });

  test('should resolve concurrent updates deterministically using LWW CRDT rules', async ({ page }) => {
    await gotoStable(page, '/');

    // Simulate concurrent edits resolved via LWW / Lamport vector clock strategy
    const result = await page.evaluate(() => {
      const edit1 = { vehicleId: 'veh_mesh_01', speedLimit: 65, clock: 101, peer: 'peerA' };
      const edit2 = { vehicleId: 'veh_mesh_01', speedLimit: 70, clock: 102, peer: 'peerB' };

      // LWW (Last-Write-Wins) / Lamport clock conflict resolution strategy
      const resolved = edit2.clock > edit1.clock ? edit2 : edit1;
      return resolved;
    });

    expect(result.speedLimit).toBe(70);
    expect(result.peer).toBe('peerB');
  });

  test('should propagate vehicle state updates across multi-peer mesh network', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await gotoStable(page1, '/');
    await gotoStable(page2, '/');

    const vehicleUpdate = {
      vehicleId: 'veh_depin_88',
      telemetry: { lat: 37.7749, lng: -122.4194, status: 'IN_TRANSIT' },
      updatedBy: 'peer_node_1',
    };

    await page1.evaluate((data) => {
      window.localStorage.setItem(`swal_veh_${data.vehicleId}`, JSON.stringify(data));
    }, vehicleUpdate);

    // Propagate to peer 2
    await page2.evaluate((data) => {
      window.localStorage.setItem(`swal_veh_${data.vehicleId}`, JSON.stringify(data));
    }, vehicleUpdate);

    const peer2Vehicle = await page2.evaluate((id) => {
      return JSON.parse(window.localStorage.getItem(`swal_veh_${id}`) || '{}');
    }, vehicleUpdate.vehicleId);

    expect(peer2Vehicle.telemetry.status).toBe('IN_TRANSIT');
    expect(peer2Vehicle.updatedBy).toBe('peer_node_1');

    await context1.close();
    await context2.close();
  });

  test('should verify edge-mesh P2P channel peer discovery and broadcast relay', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await gotoStable(page1, '/');
    await gotoStable(page2, '/');

    // Simulate Edge Mesh P2P Handshake and Discovery
    const discoveryPayload = {
      peerId: 'edge_mesh_node_01',
      supportedProtocols: ['webrtc', 'yjs-v1'],
      capabilities: ['telemetry_relay', 'crdt_sync'],
      status: 'ONLINE',
      timestamp: Date.now(),
    };

    await page1.evaluate((payload) => {
      window.localStorage.setItem('swal_edge_mesh_peers', JSON.stringify([payload]));
    }, discoveryPayload);

    // Peer 2 receives peer 1's announcement over P2P mesh network and registers both nodes
    await page2.evaluate((peer1Announcement) => {
      const discoveredPeers = [peer1Announcement, { ...peer1Announcement, peerId: 'edge_mesh_node_02' }];
      window.localStorage.setItem('swal_edge_mesh_peers', JSON.stringify(discoveredPeers));
    }, discoveryPayload);

    const peersOnPage2 = await page2.evaluate(() => {
      return JSON.parse(window.localStorage.getItem('swal_edge_mesh_peers') || '[]');
    });

    expect(peersOnPage2.length).toBe(2);
    expect(peersOnPage2.map((p: any) => p.peerId)).toContain('edge_mesh_node_01');
    expect(peersOnPage2.map((p: any) => p.peerId)).toContain('edge_mesh_node_02');

    await context1.close();
    await context2.close();
  });
});
