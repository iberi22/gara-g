//! Gara-G Protocol V2 Definition - Hybrid V2V Mesh Protocol
//! Binary wire format for LoRa and BLE communication.
//!
//! ## Protocol Layers:
//! - **Layer 1 (Close Range):** Smartphone-to-Smartphone via Google Nearby Connections
//!   - Range: ~100m, High bandwidth for richer data
//! - **Layer 2 (Long Range):** Sentinel-to-Sentinel via LoRa (SX1262)
//!   - Range: ~1km+, Low bandwidth for safety packets
//!
//! ## Security Features:
//! - Ephemeral rolling IDs prevent tracking
//! - Network isolation via `network_id`
//! - TTL-based hop limiting prevents packet storms

use serde::{Serialize, Deserialize};
use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Verifier, Signature};

// ============================================================================
// Constants
// ============================================================================

/// Protocol version (increment on breaking changes)
pub const PROTOCOL_VERSION: u8 = 2;

/// Maximum hops a packet can travel (prevents infinite loops)
pub const MAX_HOP_COUNT: u8 = 5;

/// Default network ID for public mesh
pub const DEFAULT_NETWORK_ID: u8 = 0;

/// Ephemeral ID rotation interval in milliseconds (5 minutes)
pub const EPHEMERAL_ID_ROTATION_MS: u64 = 300_000;

// Event Bitmasks (for `events` field)
pub const CRASH_EVENT_MASK: u16 = 0x0001;      // High G-force detected
pub const HARD_BRAKE_MASK: u16 = 0x0002;       // Emergency braking
pub const HAZARD_LIGHTS_MASK: u16 = 0x0004;    // Hazard lights on
pub const EMERGENCY_VEHICLE_MASK: u16 = 0x0008; // Detected emergency vehicle
pub const ROAD_HAZARD_MASK: u16 = 0x0010;      // Road obstacle/hazard reported

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum MsgType {
    Heartbeat = 0x01,       // Regular position broadcast
    Hazard = 0x02,          // Danger warning (high priority)
    Chat = 0x03,            // Driver-to-driver message (via app)
    Handshake = 0x99,       // Mesh peer discovery
    EmergencyBrake = 0x10,  // Immediate danger - highest priority
    RoadCondition = 0x11,   // Pothole, ice, debris
}

/// V2 SafetyPacket with mesh networking support
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[repr(C)]
pub struct SafetyPacket {
    // Header (4 bytes)
    pub magic: u8,          // 'G'
    pub version: u8,        // 2 (protocol version)
    pub msg_type: MsgType,  // Enum as u8
    pub network_id: u8,     // Mesh network isolation (0 = public)

    // Mesh Routing (2 bytes)
    pub hop_count: u8,      // Current hop count (starts at 0)
    pub max_hops: u8,       // Max allowed hops (default: MAX_HOP_COUNT)

    // Identity (4 bytes)
    pub temp_id: u32,       // Rolling ephemeral ID (rotates every 5 min)

    // Telemetry (21 bytes)
    pub timestamp: u64,     // Unix MS
    pub lat: i32,           // Microdegrees (Lat * 1e6)
    pub lon: i32,           // Microdegrees (Lon * 1e6)
    pub speed_cms: u16,     // cm/s
    pub heading: u8,        // 0-255 (0 = North, 128 = South)

    // Status (2 bytes)
    pub events: u16,        // Bitmask for events
}

impl SafetyPacket {
    /// Create a new heartbeat packet (V2 with mesh support)
    pub fn new_heartbeat(temp_id: u32, lat: f64, lon: f64, speed_kmh: f32) -> Self {
        Self {
            magic: b'G',
            version: PROTOCOL_VERSION,
            msg_type: MsgType::Heartbeat,
            network_id: DEFAULT_NETWORK_ID,
            hop_count: 0,
            max_hops: MAX_HOP_COUNT,
            temp_id,
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
            lat: (lat * 1_000_000.0) as i32,
            lon: (lon * 1_000_000.0) as i32,
            speed_cms: (speed_kmh * 27.7778) as u16,
            heading: 0,
            events: 0,
        }
    }

    /// Create a hazard warning packet (high priority)
    pub fn new_hazard(temp_id: u32, lat: f64, lon: f64, event_mask: u16) -> Self {
        Self {
            magic: b'G',
            version: PROTOCOL_VERSION,
            msg_type: MsgType::Hazard,
            network_id: DEFAULT_NETWORK_ID,
            hop_count: 0,
            max_hops: MAX_HOP_COUNT,
            temp_id,
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
            lat: (lat * 1_000_000.0) as i32,
            lon: (lon * 1_000_000.0) as i32,
            speed_cms: 0,
            heading: 0,
            events: event_mask,
        }
    }

    /// Create an emergency brake packet (highest priority, max hops)
    pub fn new_emergency_brake(temp_id: u32, lat: f64, lon: f64, speed_kmh: f32, heading: u8) -> Self {
        Self {
            magic: b'G',
            version: PROTOCOL_VERSION,
            msg_type: MsgType::EmergencyBrake,
            network_id: DEFAULT_NETWORK_ID,
            hop_count: 0,
            max_hops: MAX_HOP_COUNT + 2, // Extended reach for emergencies
            temp_id,
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
            lat: (lat * 1_000_000.0) as i32,
            lon: (lon * 1_000_000.0) as i32,
            speed_cms: (speed_kmh * 27.7778) as u16,
            heading,
            events: HARD_BRAKE_MASK,
        }
    }

    /// Check if packet can be forwarded (hop count not exceeded)
    pub fn can_forward(&self) -> bool {
        self.hop_count < self.max_hops
    }

    /// Increment hop count for forwarding (returns new packet)
    pub fn forwarded(&self) -> Self {
        let mut pkt = *self;
        pkt.hop_count = pkt.hop_count.saturating_add(1);
        pkt
    }

    /// Check if packet belongs to our network
    pub fn is_our_network(&self, our_network_id: u8) -> bool {
        self.network_id == our_network_id || self.network_id == DEFAULT_NETWORK_ID
    }

    /// Check if this is a high-priority message that should bypass normal filtering
    pub fn is_high_priority(&self) -> bool {
        matches!(self.msg_type, MsgType::EmergencyBrake | MsgType::Hazard)
            || (self.events & CRASH_EVENT_MASK) != 0
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        bincode::serialize(self).unwrap_or(vec![])
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        bincode::deserialize(bytes).ok()
    }

    /// Generate raw signable bytes representation for Ed25519 authentication
    pub fn signable_bytes(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(31);
        data.push(self.magic);
        data.push(self.version);
        data.push(self.msg_type as u8);
        data.push(self.network_id);
        data.push(self.hop_count);
        data.push(self.max_hops);
        data.extend_from_slice(&self.temp_id.to_le_bytes());
        data.extend_from_slice(&self.timestamp.to_le_bytes());
        data.extend_from_slice(&self.lat.to_le_bytes());
        data.extend_from_slice(&self.lon.to_le_bytes());
        data.extend_from_slice(&self.speed_cms.to_le_bytes());
        data.push(self.heading);
        data.extend_from_slice(&self.events.to_le_bytes());
        data
    }

    /// Sign packet using Ed25519 signing key
    pub fn sign_ed25519(&self, signing_key: &SigningKey) -> SignedSafetyPacket {
        let message = self.signable_bytes();
        let signature = signing_key.sign(&message);
        let public_key = signing_key.verifying_key().to_bytes();

        SignedSafetyPacket {
            packet: *self,
            public_key: public_key.to_vec(),
            signature: signature.to_bytes().to_vec(),
        }
    }

    /// Verify Ed25519 signature against this packet
    pub fn verify_ed25519(&self, public_key: &[u8; 32], signature_bytes: &[u8; 64]) -> bool {
        let message = self.signable_bytes();
        if let Ok(verifying_key) = VerifyingKey::from_bytes(public_key) {
            let signature = Signature::from_bytes(signature_bytes);
            verifying_key.verify(&message, &signature).is_ok()
        } else {
            false
        }
    }
}

/// Ed25519 Signed SafetyPacket wrapper for 246-byte maximum wire transport
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedSafetyPacket {
    pub packet: SafetyPacket,
    pub public_key: Vec<u8>,
    pub signature: Vec<u8>,
}

impl SignedSafetyPacket {
    /// Verify internal Ed25519 signature
    pub fn verify(&self) -> bool {
        if self.public_key.len() != 32 || self.signature.len() != 64 {
            return false;
        }
        let mut pk = [0u8; 32];
        let mut sig = [0u8; 64];
        pk.copy_from_slice(&self.public_key);
        sig.copy_from_slice(&self.signature);
        self.packet.verify_ed25519(&pk, &sig)
    }

    /// Serialize signed packet to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        bincode::serialize(self).unwrap_or_default()
    }

    /// Deserialize signed packet from bytes
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        bincode::deserialize(bytes).ok()
    }
}

// ============================================================================
// Ephemeral ID Generator (Rolling IDs for Privacy)
// ============================================================================

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static LAST_ROTATION: AtomicU64 = AtomicU64::new(0);
static CURRENT_EPHEMERAL_ID: AtomicU64 = AtomicU64::new(0);

/// Generate or retrieve current ephemeral ID
/// ID rotates every EPHEMERAL_ID_ROTATION_MS milliseconds
pub fn get_ephemeral_id() -> u32 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let last = LAST_ROTATION.load(Ordering::Relaxed);

    if now - last >= EPHEMERAL_ID_ROTATION_MS || last == 0 {
        // Time to rotate - generate new random ID
        let new_id = generate_random_id();
        CURRENT_EPHEMERAL_ID.store(new_id as u64, Ordering::Relaxed);
        LAST_ROTATION.store(now, Ordering::Relaxed);
        new_id
    } else {
        CURRENT_EPHEMERAL_ID.load(Ordering::Relaxed) as u32
    }
}

/// Force rotation of ephemeral ID (for privacy-sensitive operations)
pub fn rotate_ephemeral_id() -> u32 {
    let new_id = generate_random_id();
    CURRENT_EPHEMERAL_ID.store(new_id as u64, Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    LAST_ROTATION.store(now, Ordering::Relaxed);
    new_id
}

fn generate_random_id() -> u32 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let state = RandomState::new();
    let mut hasher = state.build_hasher();
    hasher.write_u64(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64);
    (hasher.finish() & 0xFFFFFFFF) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packet_serialization_v2() {
        let pkt = SafetyPacket::new_heartbeat(12345, 40.4168, -3.7038, 50.0);
        let bytes = pkt.to_bytes();
        assert!(!bytes.is_empty());

        let decoded = SafetyPacket::from_bytes(&bytes).unwrap();
        assert_eq!(decoded.temp_id, 12345);
        assert_eq!(decoded.magic, b'G');
        assert_eq!(decoded.version, PROTOCOL_VERSION);
        assert_eq!(decoded.hop_count, 0);
        assert_eq!(decoded.max_hops, MAX_HOP_COUNT);
        // Check lat precision
        assert_eq!(decoded.lat, 40416800);
    }

    #[test]
    fn test_packet_forwarding() {
        let pkt = SafetyPacket::new_heartbeat(12345, 40.4168, -3.7038, 50.0);

        // Initial packet should be forwardable
        assert!(pkt.can_forward());
        assert_eq!(pkt.hop_count, 0);

        // Forward the packet
        let fwd1 = pkt.forwarded();
        assert_eq!(fwd1.hop_count, 1);
        assert!(fwd1.can_forward());

        // Keep forwarding until max hops
        let mut current = fwd1;
        for _ in 2..MAX_HOP_COUNT {
            current = current.forwarded();
            assert!(current.can_forward());
        }

        // Last forward should max out
        current = current.forwarded();
        assert_eq!(current.hop_count, MAX_HOP_COUNT);
        assert!(!current.can_forward()); // No more forwarding allowed
    }

    #[test]
    fn test_emergency_brake_extended_hops() {
        let pkt = SafetyPacket::new_emergency_brake(
            12345, 40.4168, -3.7038, 80.0, 128
        );

        assert_eq!(pkt.msg_type, MsgType::EmergencyBrake);
        assert_eq!(pkt.max_hops, MAX_HOP_COUNT + 2);
        assert!(pkt.is_high_priority());
        assert!((pkt.events & HARD_BRAKE_MASK) != 0);
    }

    #[test]
    fn test_network_isolation() {
        let public_pkt = SafetyPacket::new_heartbeat(12345, 0.0, 0.0, 0.0);
        assert_eq!(public_pkt.network_id, DEFAULT_NETWORK_ID);

        // Public packets are visible to all networks
        assert!(public_pkt.is_our_network(0));
        assert!(public_pkt.is_our_network(1));
        assert!(public_pkt.is_our_network(255));

        // Private network packet
        let mut private_pkt = public_pkt;
        private_pkt.network_id = 42;

        // Only visible to network 42 and public (0)
        assert!(private_pkt.is_our_network(42));
        assert!(!private_pkt.is_our_network(0)); // 0 can only see 0
        assert!(!private_pkt.is_our_network(43));
    }

    #[test]
    fn test_hazard_packet() {
        let pkt = SafetyPacket::new_hazard(
            12345, 40.4168, -3.7038,
            CRASH_EVENT_MASK | ROAD_HAZARD_MASK
        );

        assert_eq!(pkt.msg_type, MsgType::Hazard);
        assert!(pkt.is_high_priority());
        assert!((pkt.events & CRASH_EVENT_MASK) != 0);
        assert!((pkt.events & ROAD_HAZARD_MASK) != 0);
    }

    #[test]
    fn test_ephemeral_id_generation() {
        let id1 = get_ephemeral_id();
        let id2 = get_ephemeral_id();

        // Same ID within rotation window
        assert_eq!(id1, id2);

        // Force rotation should give different ID
        let id3 = rotate_ephemeral_id();
        assert_ne!(id1, id3);
    }

    #[test]
    fn test_ed25519_signing_and_verification() {
        use rand_core::{RngCore, OsRng};
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let signing_key = SigningKey::from_bytes(&secret);

        let pkt = SafetyPacket::new_hazard(
            12345, 40.4168, -3.7038, CRASH_EVENT_MASK | HARD_BRAKE_MASK
        );

        let signed_pkt = pkt.sign_ed25519(&signing_key);
        assert!(signed_pkt.verify());

        let raw_bytes = signed_pkt.to_bytes();
        assert!(raw_bytes.len() <= 246);

        let decoded = SignedSafetyPacket::from_bytes(&raw_bytes).expect("Deserialization failed");
        assert!(decoded.verify());
        assert_eq!(decoded.packet.temp_id, 12345);
        assert!((decoded.packet.events & CRASH_EVENT_MASK) != 0);
    }

    #[test]
    fn test_packet_deserialization_v2() {
        // Create a known V2 packet
        let original_packet = SafetyPacket {
            magic: b'G',
            version: PROTOCOL_VERSION,
            msg_type: MsgType::Hazard,
            network_id: 42,
            hop_count: 2,
            max_hops: 5,
            temp_id: 0xDEADBEEF,
            timestamp: 1678886400000,
            lat: 40416800,
            lon: -3703800,
            speed_cms: 1388,
            heading: 90,
            events: CRASH_EVENT_MASK,
        };

        // Serialize and deserialize
        let raw_bytes = original_packet.to_bytes();
        let decoded = SafetyPacket::from_bytes(&raw_bytes).expect("Failed to deserialize");

        // Assert all V2 fields match
        assert_eq!(decoded.magic, original_packet.magic);
        assert_eq!(decoded.version, original_packet.version);
        assert_eq!(decoded.msg_type, original_packet.msg_type);
        assert_eq!(decoded.network_id, original_packet.network_id);
        assert_eq!(decoded.hop_count, original_packet.hop_count);
        assert_eq!(decoded.max_hops, original_packet.max_hops);
        assert_eq!(decoded.temp_id, original_packet.temp_id);
        assert_eq!(decoded.timestamp, original_packet.timestamp);
        assert_eq!(decoded.lat, original_packet.lat);
        assert_eq!(decoded.lon, original_packet.lon);
        assert_eq!(decoded.speed_cms, original_packet.speed_cms);
        assert_eq!(decoded.heading, original_packet.heading);
        assert_eq!(decoded.events, original_packet.events);
    }
}
