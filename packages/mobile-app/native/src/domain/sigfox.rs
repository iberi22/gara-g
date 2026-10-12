//! Sigfox IoT Integration Module
//!
//! Provides parsing, encoding, and decoding of Sigfox messages
//! for ultra-low-power IoT telemetry from GARA-G vehicles.
//!
//! Sigfox operates in:
//! - RC1 (Europe) - 868 MHz
//! - RC2/RC4 (Americas) - 902 MHz
//! - RC3 (Japan) - 920 MHz
//!
//! Maximum payload: 12 bytes uplink, 8 bytes downlink

use serde::{Deserialize, Serialize};

/// Sigfox region configuration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SigfoxRegion {
    /// Europe - 868 MHz
    Rc1,
    /// Americas - 902 MHz
    Rc2,
    /// Japan - 920 MHz
    Rc3,
    /// Australia/NZ - 920 MHz
    Rc4,
}

impl SigfoxRegion {
    pub fn frequency_mhz(&self) -> u32 {
        match self {
            SigfoxRegion::Rc1 => 868,
            SigfoxRegion::Rc2 => 902,
            SigfoxRegion::Rc3 => 920,
            SigfoxRegion::Rc4 => 920,
        }
    }

    pub fn max_payload_bytes(&self) -> usize {
        match self {
            SigfoxRegion::Rc1 => 12,
            SigfoxRegion::Rc2 => 12,
            SigfoxRegion::Rc3 => 12,
            SigfoxRegion::Rc4 => 12,
        }
    }
}

/// Sigfox message types for GARA-G telemetry
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum SigfoxMessageType {
    /// GPS heartbeat (lat/lng in compact format)
    GpsHeartbeat = 0x01,
    /// Vehicle status (battery, speed, ignition)
    VehicleStatus = 0x02,
    /// Emergency/panic alert
    EmergencyAlert = 0x03,
    /// Geofence breach notification
    GeofenceBreach = 0x04,
    /// Fuel level report
    FuelReport = 0x05,
    /// OBD fault code summary
    ObdFault = 0x06,
    /// Temperature sensor reading
    Temperature = 0x07,
    /// Accelerometer event (impact/crash detected)
    ImpactEvent = 0x08,
    /// Daily journey summary
    DailySummary = 0x09,
}

impl SigfoxMessageType {
    /// Convert from byte
    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            0x01 => Some(SigfoxMessageType::GpsHeartbeat),
            0x02 => Some(SigfoxMessageType::VehicleStatus),
            0x03 => Some(SigfoxMessageType::EmergencyAlert),
            0x04 => Some(SigfoxMessageType::GeofenceBreach),
            0x05 => Some(SigfoxMessageType::FuelReport),
            0x06 => Some(SigfoxMessageType::ObdFault),
            0x07 => Some(SigfoxMessageType::Temperature),
            0x08 => Some(SigfoxMessageType::ImpactEvent),
            0x09 => Some(SigfoxMessageType::DailySummary),
            _ => None,
        }
    }

    /// Human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            SigfoxMessageType::GpsHeartbeat => "GPS Position Heartbeat",
            SigfoxMessageType::VehicleStatus => "Vehicle Status Report",
            SigfoxMessageType::EmergencyAlert => "Emergency/Panic Alert",
            SigfoxMessageType::GeofenceBreach => "Geofence Breach Notification",
            SigfoxMessageType::FuelReport => "Fuel Level Report",
            SigfoxMessageType::ObdFault => "OBD Fault Code Summary",
            SigfoxMessageType::Temperature => "Temperature Reading",
            SigfoxMessageType::ImpactEvent => "Impact/Crash Event",
            SigfoxMessageType::DailySummary => "Daily Journey Summary",
        }
    }
}

/// Compact GPS coordinate (Sigfox-optimized 3 bytes per coordinate)
///
/// Format: signed integer with scaling factor
/// - Latitude: 23 bits, range -90 to 90, resolution ~0.000011°
/// - Longitude: 24 bits, range -180 to 180, resolution ~0.000011°
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CompactCoordinate {
    pub lat: f64,
    pub lng: f64,
}

impl CompactCoordinate {
    pub fn encode(&self) -> (u32, u32) {
        let lat_enc = ((self.lat + 90.0) * 10_000_000.0) as u32;
        let lng_enc = ((self.lng + 180.0) * 10_000_000.0) as u32;
        (lat_enc, lng_enc)
    }

    pub fn decode(lat_enc: u32, lng_enc: u32) -> Self {
        let lat = (lat_enc as f64 / 10_000_000.0) - 90.0;
        let lng = (lng_enc as f64 / 10_000_000.0) - 180.0;
        Self { lat, lng }
    }
}

/// A decoded Sigfox uplink message (max 12 bytes)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigfoxUplink {
    /// Device ID (Sigfox device identifier)
    pub device_id: String,
    /// Message timestamp (Unix ms)
    pub timestamp: i64,
    /// Sequence number
    pub sequence: u16,
    /// Signal quality (0-100)
    pub signal_quality: u8,
    /// Parsed message type
    pub msg_type: SigfoxMessageType,
    /// Parsed data payload
    pub data: SigfoxPayload,
    /// Raw hex payload
    pub raw_hex: String,
}

/// Parsed payload from Sigfox message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SigfoxPayload {
    GpsHeartbeat {
        position: CompactCoordinate,
        speed: u8,       // km/h
        heading: u8,     // 0-255 → 0-360°
    },
    VehicleStatus {
        battery_percent: u8,
        ignition_on: bool,
        speed: u8,
        odometer_km: u32,
    },
    EmergencyAlert {
        position: CompactCoordinate,
        alert_type: u8,  // 0=panic, 1=collision, 2=theft, 3=medical
    },
    GeofenceBreach {
        position: CompactCoordinate,
        geofence_id: u16,
    },
    FuelReport {
        fuel_level_percent: u8,
        fuel_consumption_l: u16, // tenths of liter
    },
    ObdFault {
        fault_count: u8,
        severity: u8,   // 0=warning, 1=major, 2=critical
        codes: String,  // Comma-separated OBD-II codes
    },
    Temperature {
        temp_celsius: i16, // tenths of degree
        humidity_percent: u8,
    },
    ImpactEvent {
        position: CompactCoordinate,
        impact_g: u16,  // tenths of G
        direction: u8,  // 0-360°
    },
    DailySummary {
        total_distance_km: u32,
        avg_speed_kmh: u8,
        max_speed_kmh: u8,
        trip_count: u8,
        total_idle_minutes: u16,
    },
}

/// Sigfox message decoder
pub struct SigfoxDecoder;

impl SigfoxDecoder {
    /// Decode a raw 12-byte Sigfox payload
    pub fn decode(raw_hex: &str, device_id: &str, signal_quality: u8, sequence: u16) -> Result<SigfoxUplink, String> {
        let raw_bytes = hex_decode(raw_hex)?;

        if raw_bytes.len() > 12 {
            return Err(format!("Sigfox payload too long: {} bytes (max 12)", raw_bytes.len()));
        }

        let msg_byte = raw_bytes.first().copied().ok_or("Empty payload")?;
        let msg_type = SigfoxMessageType::from_byte(msg_byte)
            .ok_or_else(|| format!("Unknown message type: 0x{:02x}", msg_byte))?;

        let data = match msg_type {
            SigfoxMessageType::GpsHeartbeat => {
                if raw_bytes.len() < 7 { return Err("GpsHeartbeat: need 7+ bytes".into()); }
                let lat_enc = u32::from_be_bytes([0, raw_bytes[1], raw_bytes[2], raw_bytes[3]]);
                let lng_enc = u32::from_be_bytes([0, raw_bytes[4], raw_bytes[5], raw_bytes[6]]);
                SigfoxPayload::GpsHeartbeat {
                    position: CompactCoordinate::decode(lat_enc, lng_enc),
                    speed: *raw_bytes.get(7).unwrap_or(&0),
                    heading: *raw_bytes.get(8).unwrap_or(&0),
                }
            }
            SigfoxMessageType::VehicleStatus => {
                if raw_bytes.len() < 9 { return Err("VehicleStatus: need 9+ bytes".into()); }
                SigfoxPayload::VehicleStatus {
                    battery_percent: raw_bytes[1],
                    ignition_on: raw_bytes[2] > 0,
                    speed: raw_bytes[3],
                    odometer_km: u32::from_be_bytes([raw_bytes[4], raw_bytes[5], raw_bytes[6], raw_bytes[7]]),
                }
            }
            SigfoxMessageType::EmergencyAlert => {
                if raw_bytes.len() < 8 { return Err("EmergencyAlert: need 8+ bytes".into()); }
                let lat_enc = u32::from_be_bytes([0, raw_bytes[1], raw_bytes[2], raw_bytes[3]]);
                let lng_enc = u32::from_be_bytes([0, raw_bytes[4], raw_bytes[5], raw_bytes[6]]);
                SigfoxPayload::EmergencyAlert {
                    position: CompactCoordinate::decode(lat_enc, lng_enc),
                    alert_type: raw_bytes[7],
                }
            }
            SigfoxMessageType::GeofenceBreach => {
                if raw_bytes.len() < 8 { return Err("GeofenceBreach: need 8+ bytes".into()); }
                let lat_enc = u32::from_be_bytes([0, raw_bytes[1], raw_bytes[2], raw_bytes[3]]);
                let lng_enc = u32::from_be_bytes([0, raw_bytes[4], raw_bytes[5], raw_bytes[6]]);
                SigfoxPayload::GeofenceBreach {
                    position: CompactCoordinate::decode(lat_enc, lng_enc),
                    geofence_id: u16::from_be_bytes([raw_bytes[7], raw_bytes[8]]),
                }
            }
            SigfoxMessageType::FuelReport => {
                if raw_bytes.len() < 4 { return Err("FuelReport: need 4+ bytes".into()); }
                SigfoxPayload::FuelReport {
                    fuel_level_percent: raw_bytes[1],
                    fuel_consumption_l: u16::from_be_bytes([raw_bytes[2], raw_bytes[3]]),
                }
            }
            SigfoxMessageType::ObdFault => {
                if raw_bytes.len() < 3 { return Err("ObdFault: need 3+ bytes".into()); }
                let code_len = raw_bytes.len() - 3;
                let codes = std::str::from_utf8(&raw_bytes[3..])
                    .unwrap_or("")
                    .to_string();
                SigfoxPayload::ObdFault {
                    fault_count: raw_bytes[1],
                    severity: raw_bytes[2],
                    codes,
                }
            }
            SigfoxMessageType::Temperature => {
                if raw_bytes.len() < 4 { return Err("Temperature: need 4+ bytes".into()); }
                SigfoxPayload::Temperature {
                    temp_celsius: i16::from_be_bytes([raw_bytes[1], raw_bytes[2]]),
                    humidity_percent: raw_bytes[3],
                }
            }
            SigfoxMessageType::ImpactEvent => {
                if raw_bytes.len() < 8 { return Err("ImpactEvent: need 8+ bytes".into()); }
                let lat_enc = u32::from_be_bytes([0, raw_bytes[1], raw_bytes[2], raw_bytes[3]]);
                let lng_enc = u32::from_be_bytes([0, raw_bytes[4], raw_bytes[5], raw_bytes[6]]);
                SigfoxPayload::ImpactEvent {
                    position: CompactCoordinate::decode(lat_enc, lng_enc),
                    impact_g: u16::from_be_bytes([raw_bytes[7], raw_bytes[8]]),
                    direction: *raw_bytes.get(9).unwrap_or(&0),
                }
            }
            SigfoxMessageType::DailySummary => {
                if raw_bytes.len() < 7 { return Err("DailySummary: need 7+ bytes".into()); }
                SigfoxPayload::DailySummary {
                    total_distance_km: u32::from_be_bytes([raw_bytes[1], raw_bytes[2], raw_bytes[3], raw_bytes[4]]),
                    avg_speed_kmh: raw_bytes[5],
                    max_speed_kmh: raw_bytes[6],
                    trip_count: *raw_bytes.get(7).unwrap_or(&0),
                    total_idle_minutes: u16::from_be_bytes([*raw_bytes.get(8).unwrap_or(&0), *raw_bytes.get(9).unwrap_or(&0)]),
                }
            }
        };

        Ok(SigfoxUplink {
            device_id: device_id.to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            sequence,
            signal_quality,
            msg_type,
            data,
            raw_hex: raw_hex.to_string(),
        })
    }
}

/// Sigfox message encoder (for downlink responses)
pub struct SigfoxEncoder;

impl SigfoxEncoder {
    /// Encode a downlink command (max 8 bytes)
    pub fn encode_downlink(device_id: &str, command: u8, payload: &[u8]) -> Result<String, String> {
        if payload.len() > 7 {
            return Err(format!("Downlink payload too long: {} bytes (max 7)", payload.len()));
        }

        let mut bytes = vec![command];
        bytes.extend_from_slice(payload);

        Ok(hex_encode(&bytes))
    }

    /// Create a GPS request command
    pub fn request_gps_position(device_id: &str) -> Result<String, String> {
        Self::encode_downlink(device_id, 0x01, &[])
    }

    /// Create a status request command
    pub fn request_status(device_id: &str) -> Result<String, String> {
        Self::encode_downlink(device_id, 0x02, &[])
    }

    /// Set geofence parameters
    pub fn set_geofence(device_id: &str, radius_meters: u16, lat: f64, lng: f64) -> Result<String, String> {
        let coord = CompactCoordinate { lat, lng };
        let (lat_enc, lng_enc) = coord.encode();

        let mut payload = Vec::with_capacity(8);
        payload.extend_from_slice(&radius_meters.to_be_bytes());
        payload.extend_from_slice(&lat_enc.to_be_bytes()[1..]); // 3 bytes
        payload.extend_from_slice(&lng_enc.to_be_bytes()[1..]); // 3 bytes

        Self::encode_downlink(device_id, 0x03, &payload)
    }
}

/// Sigfox device registry
#[derive(Debug, Clone, Default)]
pub struct SigfoxRegistry {
    devices: std::collections::HashMap<String, SigfoxDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigfoxDevice {
    pub device_id: String,
    pub vehicle_id: String,
    pub region: SigfoxRegion,
    pub last_seen: i64,
    pub last_message: Option<SigfoxMessageType>,
    pub total_messages: u64,
}

impl SigfoxRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_device(&mut self, device_id: String, vehicle_id: String, region: SigfoxRegion) {
        self.devices.insert(device_id.clone(), SigfoxDevice {
            device_id,
            vehicle_id,
            region,
            last_seen: 0,
            last_message: None,
            total_messages: 0,
        });
    }

    pub fn record_message(&mut self, device_id: &str, msg_type: SigfoxMessageType) {
        if let Some(device) = self.devices.get_mut(device_id) {
            device.last_seen = chrono::Utc::now().timestamp_millis();
            device.last_message = Some(msg_type);
            device.total_messages += 1;
        }
    }

    pub fn get_device(&self, device_id: &str) -> Option<&SigfoxDevice> {
        self.devices.get(device_id)
    }

    pub fn list_devices(&self) -> Vec<&SigfoxDevice> {
        self.devices.values().collect()
    }
}

// Hex helpers
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let s = s.trim();
    if s.len() % 2 != 0 {
        return Err("Hex string must have even length".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16)
                .map_err(|e| format!("Invalid hex at position {}: {}", i, e))
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigfoxPacket {
    pub device_id: u32,
    pub latitude: f32,
    pub longitude: f32,
}

impl SigfoxPacket {
    pub fn to_bytes(&self) -> Vec<u8> {
        bincode::serialize(self).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gps_heartbeat_decode() {
        // Simulate a 12-byte Sigfox uplink: GPS heartbeat
        let raw_hex = "018000001c80000000000000";
        let result = SigfoxDecoder::decode(raw_hex, "device-001", 75, 1);
        assert!(result.is_ok(), "Failed to decode: {:?}", result.err());

        let uplink = result.unwrap();
        assert_eq!(uplink.msg_type, SigfoxMessageType::GpsHeartbeat);
        if let SigfoxPayload::GpsHeartbeat { position, .. } = uplink.data {
            // Madrid area (~40.4168, -3.7038)
            assert!((position.lat - 40.0).abs() < 10.0);
            assert!((position.lng + 3.0).abs() < 10.0);
        } else {
            panic!("Expected GpsHeartbeat payload");
        }
    }

    #[test]
    fn test_vehicle_status_decode() {
        let raw_hex = "0264880196000000000000";
        let result = SigfoxDecoder::decode(raw_hex, "device-002", 80, 5);
        assert!(result.is_ok());

        let uplink = result.unwrap();
        assert_eq!(uplink.msg_type, SigfoxMessageType::VehicleStatus);
        if let SigfoxPayload::VehicleStatus { battery_percent, ignition_on, speed, .. } = uplink.data {
            assert!(battery_percent > 0);
        }
    }

    #[test]
    fn test_emergency_alert() {
        let raw_hex = "038000001c80000001000000";
        let result = SigfoxDecoder::decode(raw_hex, "device-003", 60, 10);
        assert!(result.is_ok());

        let uplink = result.unwrap();
        assert_eq!(uplink.msg_type, SigfoxMessageType::EmergencyAlert);
        if let SigfoxPayload::EmergencyAlert { alert_type, .. } = uplink.data {
            assert_eq!(alert_type, 1); // collision
        }
    }

    #[test]
    fn test_downlink_encode() {
        let result = SigfoxEncoder::request_gps_position("device-001");
        assert!(result.is_ok());
        let hex = result.unwrap();
        assert_eq!(hex, "0101");
    }

    #[test]
    fn test_compact_coordinate_roundtrip() {
        let coord = CompactCoordinate { lat: 40.4168, lng: -3.7038 };
        let (lat_enc, lng_enc) = coord.encode();
        let decoded = CompactCoordinate::decode(lat_enc, lng_enc);

        assert!((decoded.lat - coord.lat).abs() < 0.001);
        assert!((decoded.lng - coord.lng).abs() < 0.001);
    }

    #[test]
    fn test_device_registry() {
        let mut registry = SigfoxRegistry::new();
        registry.register_device("device-001".into(), "vehicle-mad-01".into(), SigfoxRegion::Rc1);
        registry.register_device("device-002".into(), "vehicle-bcn-01".into(), SigfoxRegion::Rc2);

        registry.record_message("device-001", SigfoxMessageType::GpsHeartbeat);

        let device = registry.get_device("device-001");
        assert!(device.is_some());
        assert_eq!(device.unwrap().total_messages, 1);
        assert_eq!(device.unwrap().vehicle_id, "vehicle-mad-01");

        let all = registry.list_devices();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_max_payload_enforcement() {
        let long_payload = "ffffffffffffffffffffffffffffffff"; // 16 bytes
        let result = SigfoxDecoder::decode(long_payload, "device-001", 70, 1);
        assert!(result.is_err()); // Should be > 12 bytes
    }
}
