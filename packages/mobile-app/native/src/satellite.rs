//! Satellite Communication Module
//! Supports Iridium SBD (RockBLOCK) and Skylo protocols

use serde::{Deserialize, Serialize};

/// Maximum SBD message size (Iridium limit)
const MAX_SBD_SIZE: usize = 340;

/// Satellite message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SatelliteMessage {
    /// Emergency SOS with location
    Sos {
        lat: f64,
        lon: f64,
        timestamp: u64,
        vehicle_id: String,
    },
    /// Crash detection alert
    CrashAlert {
        lat: f64,
        lon: f64,
        severity: CrashSeverity,
        g_force: f32,
        timestamp: u64,
    },
    /// Periodic heartbeat (low priority)
    Heartbeat {
        lat: f64,
        lon: f64,
        battery: u8,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum CrashSeverity {
    Minor,    // < 5g
    Moderate, // 5-15g
    Severe,   // > 15g
}

/// Satellite interface abstraction
pub trait SatelliteInterface {
    fn is_available(&self) -> bool;
    fn send_message(&mut self, msg: &SatelliteMessage) -> Result<String, SatelliteError>;
    fn check_inbox(&mut self) -> Vec<SatelliteMessage>;
    fn get_signal_strength(&self) -> u8; // 0-5 bars
}

/// Iridium SBD implementation (via RockBLOCK)
pub struct IridiumSbd {
    serial_port: String,
    baud_rate: u32,
    imei: String,
}

impl IridiumSbd {
    pub fn new(serial_port: &str) -> Result<Self, SatelliteError> {
        Ok(Self {
            serial_port: serial_port.to_string(),
            baud_rate: 19200,
            imei: String::new(),
        })
    }

    fn encode_sbd(&self, msg: &SatelliteMessage) -> Vec<u8> {
        // Compact binary encoding for SBD (max 340 bytes)
        let mut buffer = Vec::with_capacity(MAX_SBD_SIZE);

        match msg {
            SatelliteMessage::Sos { lat, lon, timestamp, vehicle_id } => {
                buffer.push(0x01); // Message type
                buffer.extend(&lat.to_le_bytes());
                buffer.extend(&lon.to_le_bytes());
                buffer.extend(&timestamp.to_le_bytes());
                buffer.extend(vehicle_id.as_bytes().iter().take(16));
            }
            SatelliteMessage::CrashAlert { lat, lon, severity, g_force, timestamp } => {
                buffer.push(0x02);
                buffer.extend(&lat.to_le_bytes());
                buffer.extend(&lon.to_le_bytes());
                buffer.push(*severity as u8);
                buffer.extend(&g_force.to_le_bytes());
                buffer.extend(&timestamp.to_le_bytes());
            }
            SatelliteMessage::Heartbeat { lat, lon, battery } => {
                buffer.push(0x03);
                buffer.extend(&lat.to_le_bytes());
                buffer.extend(&lon.to_le_bytes());
                buffer.push(*battery);
            }
        }

        buffer
    }
}

impl SatelliteInterface for IridiumSbd {
    fn is_available(&self) -> bool {
        // Check if modem responds to AT command
        true // Placeholder
    }

    fn send_message(&mut self, msg: &SatelliteMessage) -> Result<String, SatelliteError> {
        let encoded = self.encode_sbd(msg);
        if encoded.len() > MAX_SBD_SIZE {
            return Err(SatelliteError::MessageTooLarge);
        }

        // Send AT+SBDWB (write binary) command
        // Wait for +SBDIX response
        Ok("12345678".to_string()) // Return message ID
    }

    fn check_inbox(&mut self) -> Vec<SatelliteMessage> {
        // AT+SBDRT to read text message
        vec![]
    }

    fn get_signal_strength(&self) -> u8 {
        // AT+CSQ command
        3 // Placeholder: 3 bars
    }
}

/// Mock satellite for testing (HTTP fallback)
pub struct MockSatellite {
    endpoint: String,
    bandwidth_limit: usize, // bytes per message
}

impl MockSatellite {
    pub fn new(endpoint: &str) -> Self {
        Self {
            endpoint: endpoint.to_string(),
            bandwidth_limit: 340, // Simulate SBD constraints
        }
    }
}

impl SatelliteInterface for MockSatellite {
    fn is_available(&self) -> bool { true }

    fn send_message(&mut self, msg: &SatelliteMessage) -> Result<String, SatelliteError> {
        // HTTP POST to mock endpoint
        Ok(uuid::Uuid::new_v4().to_string())
    }

    fn check_inbox(&mut self) -> Vec<SatelliteMessage> { vec![] }
    fn get_signal_strength(&self) -> u8 { 5 }
}

#[derive(Debug)]
pub enum SatelliteError {
    NotAvailable,
    MessageTooLarge,
    TransmitFailed,
    Timeout,
}