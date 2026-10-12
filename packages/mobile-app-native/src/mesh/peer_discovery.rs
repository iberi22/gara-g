//! Peer Discovery and Session Management for V2V Mobile Mesh
//!
//! Tracks nearby nodes discovered via Nearby Connections or BLE/LoRa,
//! manages active sessions, keepalives, and handles timeouts.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Discovered,
    Handshaking,
    Connected,
    Disconnected,
}

#[derive(Debug, Clone)]
pub struct PeerNode {
    pub endpoint_id: String,
    pub temp_id: u32,
    pub device_name: String,
    pub rssi: i32,
    pub last_seen: u64,
    pub state: ConnectionState,
}

pub struct PeerRegistry {
    peers: HashMap<String, PeerNode>,
    timeout_ms: u64,
}

impl PeerRegistry {
    pub fn new(timeout_ms: u64) -> Self {
        Self {
            peers: HashMap::new(),
            timeout_ms,
        }
    }

    /// Add or update a discovered peer
    pub fn update_peer(&mut self, endpoint_id: &str, temp_id: u32, device_name: &str, rssi: i32) -> PeerNode {
        let now = Self::current_time_ms();
        let peer = self.peers.entry(endpoint_id.to_string()).or_insert_with(|| PeerNode {
            endpoint_id: endpoint_id.to_string(),
            temp_id,
            device_name: device_name.to_string(),
            rssi,
            last_seen: now,
            state: ConnectionState::Discovered,
        });

        peer.temp_id = temp_id;
        peer.rssi = rssi;
        peer.last_seen = now;

        peer.clone()
    }

    /// Mark peer as handshaking
    pub fn set_handshaking(&mut self, endpoint_id: &str) -> bool {
        if let Some(peer) = self.peers.get_mut(endpoint_id) {
            peer.state = ConnectionState::Handshaking;
            peer.last_seen = Self::current_time_ms();
            true
        } else {
            false
        }
    }

    /// Set peer state to connected
    pub fn set_connected(&mut self, endpoint_id: &str) -> bool {
        if let Some(peer) = self.peers.get_mut(endpoint_id) {
            peer.state = ConnectionState::Connected;
            peer.last_seen = Self::current_time_ms();
            true
        } else {
            false
        }
    }

    /// Set peer state to disconnected
    pub fn set_disconnected(&mut self, endpoint_id: &str) -> bool {
        if let Some(peer) = self.peers.get_mut(endpoint_id) {
            peer.state = ConnectionState::Disconnected;
            true
        } else {
            false
        }
    }

    /// Get details of a single peer
    pub fn get_peer(&self, endpoint_id: &str) -> Option<&PeerNode> {
        self.peers.get(endpoint_id)
    }

    /// Get list of currently active (non-timedout) peers
    pub fn get_active_peers(&self) -> Vec<PeerNode> {
        let now = Self::current_time_ms();
        self.peers
            .values()
            .filter(|peer| {
                peer.state != ConnectionState::Disconnected
                    && (now - peer.last_seen) < self.timeout_ms
            })
            .cloned()
            .collect()
    }

    /// Clean up peers that haven't been seen within the timeout period
    pub fn prune_stale_peers(&mut self) -> Vec<String> {
        let now = Self::current_time_ms();
        let mut timed_out = Vec::new();

        for (id, peer) in self.peers.iter_mut() {
            if peer.state != ConnectionState::Disconnected && (now - peer.last_seen) >= self.timeout_ms {
                peer.state = ConnectionState::Disconnected;
                timed_out.push(id.clone());
            }
        }

        timed_out
    }

    fn current_time_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unit_peer_discovery_lifecycle() {
        let mut registry = PeerRegistry::new(100);

        let peer = registry.update_peer("peer_x", 99999, "Tesla_Model_3", -40);
        assert_eq!(peer.endpoint_id, "peer_x");
        assert_eq!(peer.temp_id, 99999);
        assert_eq!(peer.device_name, "Tesla_Model_3");
        assert_eq!(peer.rssi, -40);
        assert_eq!(peer.state, ConnectionState::Discovered);

        assert!(registry.set_handshaking("peer_x"));
        assert_eq!(registry.get_peer("peer_x").unwrap().state, ConnectionState::Handshaking);

        assert!(registry.set_connected("peer_x"));
        assert_eq!(registry.get_peer("peer_x").unwrap().state, ConnectionState::Connected);

        std::thread::sleep(std::time::Duration::from_millis(150));
        let pruned = registry.prune_stale_peers();
        assert_eq!(pruned.len(), 1);
        assert_eq!(pruned[0], "peer_x");
        assert_eq!(registry.get_peer("peer_x").unwrap().state, ConnectionState::Disconnected);
    }
}
