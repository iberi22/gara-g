//! V2V Active Foreground Service and Duty Cycling
//!
//! Provides the core implementation for running the smartphone V2V mesh
//! protocol as an active Foreground Service, managing power consumption
//! through adaptive duty cycling.

use crate::protocol::{SafetyPacket, ROAD_HAZARD_MASK};
use crate::mesh::peer_discovery::PeerRegistry;
use crate::mesh::active_mesh::ActiveMesh;

/// Represents the power state of the V2V active mobile mesh node
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum V2VMobileState {
    /// High-power mode actively listening for packets
    Scanning,
    /// Actively broadcasting safety packets / heartbeats
    Advertising,
    /// Low-power mode, radios are sleeping to conserve battery
    Sleeping,
}

/// Duty cycle configuration for smartphone power management
#[derive(Debug, Clone)]
pub struct V2VMobileConfig {
    /// Time spent scanning in ms
    pub scan_window_ms: u64,
    /// Time spent advertising in ms
    pub advertise_window_ms: u64,
    /// Time spent sleeping in ms
    pub sleep_window_ms: u64,
}

impl Default for V2VMobileConfig {
    fn default() -> Self {
        Self {
            scan_window_ms: 900,      // 90% scanning
            advertise_window_ms: 100, // 10% advertising
            sleep_window_ms: 1000,    // 1s sleep in normal power saving
        }
    }
}

/// Coordinates duty cycling and background packet broadcasting
pub struct V2VMobileManager {
    pub config: V2VMobileConfig,
    pub state: V2VMobileState,
    pub peer_registry: PeerRegistry,
    pub active_mesh: ActiveMesh,
    accumulated_time_ms: u64,
    pub packet_sent_count: u64,
    pub packet_received_count: u64,
}

impl V2VMobileManager {
    pub fn new(config: V2VMobileConfig) -> Self {
        Self {
            config,
            state: V2VMobileState::Scanning,
            peer_registry: PeerRegistry::new(30000), // 30s timeout
            active_mesh: ActiveMesh::new(),
            accumulated_time_ms: 0,
            packet_sent_count: 0,
            packet_received_count: 0,
        }
    }

    /// Update the duty cycle timer and transition state if necessary
    pub fn tick(&mut self, elapsed_ms: u64) {
        self.accumulated_time_ms += elapsed_ms;

        // Manage duty_cycle transitions
        match self.state {
            V2VMobileState::Scanning => {
                if self.accumulated_time_ms >= self.config.scan_window_ms {
                    self.state = V2VMobileState::Advertising;
                    self.accumulated_time_ms = 0;
                }
            }
            V2VMobileState::Advertising => {
                if self.accumulated_time_ms >= self.config.advertise_window_ms {
                    if self.config.sleep_window_ms > 0 {
                        self.state = V2VMobileState::Sleeping;
                    } else {
                        self.state = V2VMobileState::Scanning;
                    }
                    self.accumulated_time_ms = 0;
                }
            }
            V2VMobileState::Sleeping => {
                if self.accumulated_time_ms >= self.config.sleep_window_ms {
                    self.state = V2VMobileState::Scanning;
                    self.accumulated_time_ms = 0;
                }
            }
        }
    }

    /// Broadcast a packet through the mesh (only active when Advertising)
    pub fn broadcast_packet(&mut self, packet: &SafetyPacket) -> bool {
        if self.state == V2VMobileState::Advertising {
            self.packet_sent_count += 1;
            true
        } else {
            false // Cannot advertise/broadcast while Scanning or Sleeping
        }
    }

    /// Receive a packet from a peer (only active when Scanning)
    pub fn receive_packet(&mut self, endpoint_id: &str, packet: &SafetyPacket) -> bool {
        if self.state == V2VMobileState::Scanning {
            self.packet_received_count += 1;

            // Update peer discovery registry
            self.peer_registry.update_peer(endpoint_id, packet.temp_id, "V2V_Peer", -60);
            self.peer_registry.set_connected(endpoint_id);

            // Update active mesh route
            let entry = crate::mesh::active_mesh::RouteEntry {
                destination_temp_id: packet.temp_id,
                next_hop_endpoint_id: endpoint_id.to_string(),
                hop_count: packet.hop_count + 1,
                metric: 10 + packet.hop_count as u32 * 5,
                last_updated: chrono::Utc::now().timestamp_millis() as u64,
            };
            self.active_mesh.update_route(entry);

            true
        } else {
            false // Cannot scan/receive when Advertising or Sleeping
        }
    }
}

/// Active Foreground Service managing the active V2V loop
pub struct ForegroundService {
    pub service_id: String,
    pub is_active: bool,
    pub wake_lock_acquired: bool,
    pub manager: V2VMobileManager,
}

impl ForegroundService {
    pub fn new(service_id: String, config: V2VMobileConfig) -> Self {
        Self {
            service_id,
            is_active: false,
            wake_lock_acquired: false,
            manager: V2VMobileManager::new(config),
        }
    }

    /// Start the V2V active foreground service, acquiring partial wake locks
    pub fn start_service(&mut self) {
        self.is_active = true;
        self.wake_lock_acquired = true;
    }

    /// Stop the V2V active foreground service and release wake locks
    pub fn stop_service(&mut self) {
        self.is_active = false;
        self.wake_lock_acquired = false;
        self.manager.state = V2VMobileState::Sleeping;
    }

    /// Service cycle tick
    pub fn tick_service(&mut self, elapsed_ms: u64) {
        if self.is_active {
            self.manager.tick(elapsed_ms);
        }
    }
}
