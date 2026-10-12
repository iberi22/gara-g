//! Network Interface Abstraction
//!
//! Provides a common interface for different network types:
//! - Satellite (Iridium, RockBlock, Skylo)
//! - LoRaWAN
//! - HTTP fallback

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Connection status for network interfaces
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionStatus {
    /// Hardware not detected
    NoHardware,
    /// Hardware detected but not connected
    Disconnected,
    /// Attempting to connect
    Connecting,
    /// Connected with signal strength (0-5)
    Connected(u8),
    /// Error state with last known signal
    Error(u8),
}

impl ConnectionStatus {
    /// Check if the connection is usable for sending data
    pub fn is_usable(&self) -> bool {
        matches!(self, ConnectionStatus::Connected(_))
    }

    /// Get a human-readable status string
    pub fn display_string(&self) -> String {
        match self {
            ConnectionStatus::NoHardware => "No Hardware Found".to_string(),
            ConnectionStatus::Disconnected => "Disconnected".to_string(),
            ConnectionStatus::Connecting => "Connecting...".to_string(),
            ConnectionStatus::Connected(signal) => {
                format!("Connected (Signal: {}/5)", signal)
            }
            ConnectionStatus::Error(last_signal) => {
                format!("Error (Last Signal: {}/5)", last_signal)
            }
        }
    }
}

/// Trait for network interfaces
pub trait NetworkInterface: Send + Sync {
    /// Get the name of this network interface
    fn name(&self) -> &str;

    /// Get current connection status
    fn status(&self) -> ConnectionStatus;

    /// Check if hardware is available
    fn is_hardware_present(&self) -> bool;

    /// Attempt to connect/reconnect
    fn connect(&mut self) -> Result<()>;

    /// Disconnect from the network
    fn disconnect(&mut self) -> Result<()>;

    /// Send data over this network
    /// Returns number of bytes sent
    fn send(&mut self, data: &[u8]) -> Result<usize>;

    /// Get maximum payload size for this network (bytes)
    fn max_payload_size(&self) -> usize;

    /// Get estimated latency in milliseconds
    fn estimated_latency_ms(&self) -> u64;

    /// Get bandwidth constraints (bytes per second)
    fn bandwidth_bps(&self) -> u64;

    /// Check if this interface supports receiving data
    fn supports_receive(&self) -> bool {
        false // Default: send-only
    }

    /// Receive data (if supported)
    fn receive(&mut self) -> Result<Vec<u8>> {
        Err(anyhow::anyhow!("Receive not supported by this interface"))
    }
}

/// Statistics for network interface usage
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetworkStats {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub messages_sent: u64,
    pub messages_received: u64,
    pub errors: u64,
    pub last_activity_unix_ms: u64,
}

impl NetworkStats {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_send(&mut self, bytes: u64) {
        self.bytes_sent += bytes;
        self.messages_sent += 1;
        self.last_activity_unix_ms = chrono::Utc::now().timestamp_millis() as u64;
    }

    pub fn record_receive(&mut self, bytes: u64) {
        self.bytes_received += bytes;
        self.messages_received += 1;
        self.last_activity_unix_ms = chrono::Utc::now().timestamp_millis() as u64;
    }

    pub fn record_error(&mut self) {
        self.errors += 1;
    }
}
