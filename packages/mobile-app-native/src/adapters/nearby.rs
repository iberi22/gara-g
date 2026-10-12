//! Google Nearby Connections / Bluetooth Adapter for Mobile Mesh
//!
//! Provides a clean integration layer bridging Nearby Connections events
//! (EndpointFound, EndpointLost, ConnectionInitiated, PayloadReceived) with the Rust-side
//! active mesh protocol state and peer discovery registry.

use crate::mesh::active_mesh::ActiveMesh;
use crate::mesh::peer_discovery::{PeerRegistry, ConnectionState, PeerNode};
use crate::protocol::SafetyPacket;
use std::sync::Mutex;
use once_cell::sync::Lazy;

pub struct NearbyAdapter {
    peer_registry: PeerRegistry,
    active_mesh: ActiveMesh,
}

impl NearbyAdapter {
    pub fn new(peer_timeout_ms: u64) -> Self {
        Self {
            peer_registry: PeerRegistry::new(peer_timeout_ms),
            active_mesh: ActiveMesh::new(),
        }
    }

    /// Handle when a new endpoint (vehicle) is discovered by Google Nearby Connections
    pub fn handle_endpoint_found(&mut self, endpoint_id: &str, device_name: &str, temp_id: u32, rssi: i32) -> PeerNode {
        self.peer_registry.update_peer(endpoint_id, temp_id, device_name, rssi)
    }

    /// Handle when an endpoint disappears or is lost
    pub fn handle_endpoint_lost(&mut self, endpoint_id: &str) {
        self.peer_registry.set_disconnected(endpoint_id);
        self.active_mesh.remove_connection(endpoint_id);
    }

    /// Handle when a connection is initiated with a remote peer
    pub fn handle_connection_initiated(&mut self, endpoint_id: &str) -> bool {
        self.peer_registry.set_handshaking(endpoint_id)
    }

    /// Handle when connection result is successful (connected) or failed
    pub fn handle_connection_result(&mut self, endpoint_id: &str, success: bool, is_gateway: bool) {
        if success {
            self.peer_registry.set_connected(endpoint_id);
            if let Some(peer) = self.peer_registry.get_peer(endpoint_id) {
                let temp_id = peer.temp_id;
                let device_name = peer.device_name.clone();
                self.active_mesh.add_connection(endpoint_id, &device_name, temp_id, is_gateway);
            }
        } else {
            self.peer_registry.set_disconnected(endpoint_id);
            self.active_mesh.remove_connection(endpoint_id);
        }
    }

    /// Process a received raw payload from Google Nearby Connections.
    ///
    /// If the payload contains a valid SafetyPacket, parses it and feeds it into the
    /// active mesh. Returns `Some(SafetyPacket)` with updated hop count if it should be relayed.
    pub fn handle_payload_received(&mut self, endpoint_id: &str, data: &[u8]) -> Option<SafetyPacket> {
        // Update last-seen timestamp for the peer node
        if let Some(peer) = self.peer_registry.get_peer(endpoint_id) {
            let temp_id = peer.temp_id;
            let device_name = peer.device_name.clone();
            let rssi = peer.rssi;
            self.peer_registry.update_peer(endpoint_id, temp_id, &device_name, rssi);
        }

        // Try to parse the payload as a SafetyPacket
        if let Some(packet) = SafetyPacket::from_bytes(data) {
            // Update routing path in our active mesh routing table
            let entry = crate::mesh::active_mesh::RouteEntry {
                destination_temp_id: packet.temp_id,
                next_hop_endpoint_id: endpoint_id.to_string(),
                hop_count: packet.hop_count.saturating_add(1),
                metric: 10 + packet.hop_count as u32 * 5, // simple path quality metric
                last_updated: chrono::Utc::now().timestamp_millis() as u64,
            };
            self.active_mesh.update_route(entry);

            // Let active mesh determine if packet is too old or should be relayed
            if packet.can_forward() {
                return Some(packet.forwarded());
            }
        }
        None
    }

    /// Retrieve list of all currently active neighboring peer nodes
    pub fn get_active_neighbors(&self) -> Vec<PeerNode> {
        self.peer_registry.get_active_peers()
    }

    /// Prune stale endpoints and clean up active routing entries
    pub fn prune_stale_endpoints(&mut self) -> Vec<String> {
        let timed_out = self.peer_registry.prune_stale_peers();
        for id in &timed_out {
            self.active_mesh.remove_connection(id);
        }
        timed_out
    }
}
