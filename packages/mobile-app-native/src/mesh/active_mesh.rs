//! Active V2V Mesh Topology and Routing Protocol
//!
//! Maintains routing tables, manages multi-hop paths, tracks connection flows,
//! and determines the next hop or optimal paths for packet delivery.

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct RouteEntry {
    pub destination_temp_id: u32,
    pub next_hop_endpoint_id: String,
    pub hop_count: u8,
    pub metric: u32, // Lower is better (e.g., path quality / RSSI)
    pub last_updated: u64,
}

pub struct ActiveMesh {
    /// Maps destination temp ID -> list of available routes
    routing_table: HashMap<u32, Vec<RouteEntry>>,
    /// Maps endpoint_id -> active peer connection info (endpoint name, is_gateway, etc.)
    connections: HashMap<String, PeerConnectionInfo>,
}

#[derive(Debug, Clone)]
pub struct PeerConnectionInfo {
    pub endpoint_id: String,
    pub device_name: String,
    pub temp_id: u32,
    pub is_gateway: bool,
}

impl ActiveMesh {
    pub fn new() -> Self {
        Self {
            routing_table: HashMap::new(),
            connections: HashMap::new(),
        }
    }

    /// Add or update an active point-to-point connection
    pub fn add_connection(&mut self, endpoint_id: &str, device_name: &str, temp_id: u32, is_gateway: bool) {
        self.connections.insert(
            endpoint_id.to_string(),
            PeerConnectionInfo {
                endpoint_id: endpoint_id.to_string(),
                device_name: device_name.to_string(),
                temp_id,
                is_gateway,
            },
        );

        // Add a direct route (hop count = 1) for this peer's temp ID
        let entry = RouteEntry {
            destination_temp_id: temp_id,
            next_hop_endpoint_id: endpoint_id.to_string(),
            hop_count: 1,
            metric: 10,
            last_updated: chrono::Utc::now().timestamp_millis() as u64,
        };
        self.update_route(entry);
    }

    /// Remove a connection and clean up associated routes
    pub fn remove_connection(&mut self, endpoint_id: &str) {
        self.connections.remove(endpoint_id);

        // Remove routes where next hop is the disconnected endpoint
        for routes in self.routing_table.values_mut() {
            routes.retain(|route| route.next_hop_endpoint_id != endpoint_id);
        }

        // Clean up destinations with empty route entries
        self.routing_table.retain(|_, routes| !routes.is_empty());
    }

    /// Update or insert a multi-hop route entry
    pub fn update_route(&mut self, entry: RouteEntry) {
        let routes = self.routing_table.entry(entry.destination_temp_id).or_default();

        // If there's an existing route with the same next hop, update or replace it
        if let Some(existing) = routes.iter_mut().find(|r| r.next_hop_endpoint_id == entry.next_hop_endpoint_id) {
            *existing = entry;
        } else {
            routes.push(entry);
        }

        // Sort routes by metric, then hop count to prioritize optimal paths
        routes.sort_by(|a, b| {
            a.metric.cmp(&b.metric)
                .then_with(|| a.hop_count.cmp(&b.hop_count))
        });
    }

    /// Query the best next hop endpoint ID to reach a given temp ID
    pub fn get_next_hop(&self, destination_temp_id: u32) -> Option<String> {
        self.routing_table
            .get(&destination_temp_id)
            .and_then(|routes| routes.first())
            .map(|route| route.next_hop_endpoint_id.clone())
    }

    /// Get all destinations that currently have a valid route
    pub fn get_reachable_destinations(&self) -> HashSet<u32> {
        self.routing_table.keys().cloned().collect()
    }

    /// Retrieve direct neighbor connections
    pub fn get_neighbors(&self) -> Vec<PeerConnectionInfo> {
        self.connections.values().cloned().collect()
    }

    /// Clear routing table and connections
    pub fn clear(&mut self) {
        self.routing_table.clear();
        self.connections.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unit_active_mesh_routing() {
        let mut mesh = ActiveMesh::new();

        mesh.add_connection("peer_y", "Node_Y", 555, true);
        assert_eq!(mesh.get_neighbors().len(), 1);
        assert_eq!(mesh.get_neighbors()[0].endpoint_id, "peer_y");
        assert!(mesh.get_neighbors()[0].is_gateway);

        assert_eq!(mesh.get_next_hop(555), Some("peer_y".to_string()));

        let route = RouteEntry {
            destination_temp_id: 888,
            next_hop_endpoint_id: "peer_y".to_string(),
            hop_count: 3,
            metric: 50,
            last_updated: 0,
        };
        mesh.update_route(route);
        assert_eq!(mesh.get_next_hop(888), Some("peer_y".to_string()));

        mesh.remove_connection("peer_y");
        assert!(mesh.get_next_hop(888).is_none());
        assert!(mesh.get_neighbors().is_empty());
    }
}
