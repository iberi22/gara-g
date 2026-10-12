use native::mesh::peer_discovery::{PeerRegistry, ConnectionState};
use native::mesh::active_mesh::{ActiveMesh, RouteEntry};
use native::mesh::relay::MeshRelay;
use native::protocol::{SafetyPacket, MsgType, HARD_BRAKE_MASK};

#[test]
fn test_peer_discovery_lifecycle() {
    // 1. Initialize registry with 100ms timeout for easy testing of pruning
    let mut registry = PeerRegistry::new(100);

    // 2. Discover peer
    let peer = registry.update_peer("peer_a", 12345, "Ambulance_1", -50);
    assert_eq!(peer.endpoint_id, "peer_a");
    assert_eq!(peer.temp_id, 12345);
    assert_eq!(peer.device_name, "Ambulance_1");
    assert_eq!(peer.rssi, -50);
    assert_eq!(peer.state, ConnectionState::Discovered);

    // Check active peers
    let active = registry.get_active_peers();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].endpoint_id, "peer_a");

    // 3. Set peer as handshaking
    assert!(registry.set_handshaking("peer_a"));
    assert_eq!(registry.get_peer("peer_a").unwrap().state, ConnectionState::Handshaking);

    // 4. Set peer as connected
    assert!(registry.set_connected("peer_a"));
    assert_eq!(registry.get_peer("peer_a").unwrap().state, ConnectionState::Connected);

    // 5. Test pruning/timeout behavior
    std::thread::sleep(std::time::Duration::from_millis(150));
    let timed_out = registry.prune_stale_peers();
    assert_eq!(timed_out.len(), 1);
    assert_eq!(timed_out[0], "peer_a");

    // Now peer should be disconnected
    assert_eq!(registry.get_peer("peer_a").unwrap().state, ConnectionState::Disconnected);
    assert!(registry.get_active_peers().is_empty());
}

#[test]
fn test_active_mesh_routing() {
    let mut mesh = ActiveMesh::new();

    // 1. Add direct neighbor connection (endpoint "peer_a", temp_id 100)
    mesh.add_connection("peer_a", "Node_A", 100, false);
    assert_eq!(mesh.get_neighbors().len(), 1);
    assert_eq!(mesh.get_neighbors()[0].endpoint_id, "peer_a");

    // Best next hop to reach 100 should be "peer_a" (direct)
    assert_eq!(mesh.get_next_hop(100), Some("peer_a".to_string()));

    // 2. Add multi-hop route to reach destination temp_id 200 via next hop "peer_a"
    let route_entry = RouteEntry {
        destination_temp_id: 200,
        next_hop_endpoint_id: "peer_a".to_string(),
        hop_count: 2,
        metric: 30,
        last_updated: 0,
    };
    mesh.update_route(route_entry);

    assert_eq!(mesh.get_next_hop(200), Some("peer_a".to_string()));

    // 3. Add alternative (better) route to 200 via "peer_b" (metric 15)
    mesh.add_connection("peer_b", "Node_B", 101, false);
    let better_route_entry = RouteEntry {
        destination_temp_id: 200,
        next_hop_endpoint_id: "peer_b".to_string(),
        hop_count: 2,
        metric: 15,
        last_updated: 0,
    };
    mesh.update_route(better_route_entry);

    // Next hop should update to "peer_b" because it has a lower/better metric
    assert_eq!(mesh.get_next_hop(200), Some("peer_b".to_string()));

    // 4. Test connection teardown cleans up routes
    mesh.remove_connection("peer_b");
    // Next hop should fall back to "peer_a"
    assert_eq!(mesh.get_next_hop(200), Some("peer_a".to_string()));
}

#[test]
fn test_relay_logic() {
    let mut relay = MeshRelay::new(5);

    // 1. Standard heartbeat packet
    let packet = SafetyPacket {
        magic: b'G',
        version: 2,
        msg_type: MsgType::Heartbeat,
        network_id: 0,
        hop_count: 1,
        max_hops: 5,
        temp_id: 11111,
        timestamp: 0,
        lat: 0,
        lon: 0,
        speed_cms: 0,
        heading: 0,
        events: 0,
    };

    // First time seeing packet -> should relay (hop count increments to 2)
    let relay_pkt = relay.process_packet(&packet).expect("Should process new packet");
    assert_eq!(relay_pkt.hop_count, 2);

    // Second time seeing packet -> duplicate detection, should be dropped
    assert!(relay.process_packet(&packet).is_none());

    // 2. TTL / Hop count limit check
    let packet_at_max = SafetyPacket {
        magic: b'G',
        version: 2,
        msg_type: MsgType::Heartbeat,
        network_id: 0,
        hop_count: 5,
        max_hops: 5,
        temp_id: 22222,
        timestamp: 0,
        lat: 0,
        lon: 0,
        speed_cms: 0,
        heading: 0,
        events: 0,
    };

    // Packet has reached max hops -> should not relay
    assert!(relay.process_packet(&packet_at_max).is_none());

    // 3. Priority bypass check
    let emergency_packet = SafetyPacket {
        magic: b'G',
        version: 2,
        msg_type: MsgType::EmergencyBrake,
        network_id: 0,
        hop_count: 2,
        max_hops: 7,
        temp_id: 33333,
        timestamp: 0,
        lat: 0,
        lon: 0,
        speed_cms: 0,
        heading: 0,
        events: HARD_BRAKE_MASK,
    };

    // Emergency packets are high priority
    assert!(emergency_packet.is_high_priority());
    let relay_emergency = relay.process_packet(&emergency_packet).expect("Should process emergency");
    assert_eq!(relay_emergency.hop_count, 3);
}
