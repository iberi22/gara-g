//! V2V (Vehicle-to-Vehicle) Communication Backend
//!
//! Provides cryptographic signing, verification, and reward calculation
//! for V2V messages. This Rust implementation ensures:
//! - Fast cryptographic operations
//! - Tamper-proof message verification
//! - Accurate reward calculation based on message types

use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Verifier, Signature};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::Timelike;

/// Message types for V2V communication with associated reward values
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum V2VMessageType {
    /// Text chat message - low reward
    Text,
    /// Voice message - medium reward (more effort)
    Voice,
    /// Quick preset message - base reward
    QuickMessage,
    /// Location share - medium reward (privacy cost)
    Location,
    /// Emergency alert - high reward (critical info)
    Emergency,
    /// Telemetry data - highest reward (most valuable)
    Telemetry,
}

pub type MessageType = V2VMessageType;

impl V2VMessageType {
    /// Base reward in micro-GARA (1 GARA = 1,000,000 micro)
    /// These values align with gara-chain tokenomics
    pub fn base_reward(&self) -> u64 {
        match self {
            V2VMessageType::Text => 10,           // 0.00001 GARA
            V2VMessageType::Voice => 50,          // 0.00005 GARA
            V2VMessageType::QuickMessage => 20,   // 0.00002 GARA
            V2VMessageType::Location => 100,      // 0.0001 GARA
            V2VMessageType::Emergency => 500,     // 0.0005 GARA
            V2VMessageType::Telemetry => 1000,    // 0.001 GARA
        }
    }

    /// Data Credit cost to RECEIVE this message type (consumer pays)
    /// 1 DC = $0.00001 USD
    pub fn dc_cost(&self) -> u64 {
        match self {
            V2VMessageType::Text => 1,
            V2VMessageType::Voice => 5,
            V2VMessageType::QuickMessage => 1,
            V2VMessageType::Location => 10,
            V2VMessageType::Emergency => 0,       // Free - safety critical
            V2VMessageType::Telemetry => 100,
        }
    }
}

/// Quick preset messages with Spanish display text
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QuickMessage {
    Thanks,
    Sorry,
    HazardAhead,
    PoliceAhead,
    TrafficJam,
    AccidentAhead,
    RoadWork,
    FuelStation,
    TurnSignal,
    LightsOn,
}

impl QuickMessage {
    pub fn display_text(&self) -> &'static str {
        match self {
            QuickMessage::Thanks => "👍 ¡Gracias!",
            QuickMessage::Sorry => "🙏 Disculpa",
            QuickMessage::HazardAhead => "⚠️ Peligro adelante",
            QuickMessage::PoliceAhead => "🚔 Policía adelante",
            QuickMessage::TrafficJam => "🚗 Tráfico",
            QuickMessage::AccidentAhead => "🚨 Accidente",
            QuickMessage::RoadWork => "🚧 Obra en vía",
            QuickMessage::FuelStation => "⛽ Gasolinera cerca",
            QuickMessage::TurnSignal => "🔄 Tu direccional",
            QuickMessage::LightsOn => "💡 Tus luces",
        }
    }

    /// Reward multiplier for helpful safety messages
    pub fn reward_multiplier(&self) -> f64 {
        match self {
            QuickMessage::HazardAhead => 2.0,
            QuickMessage::PoliceAhead => 1.5,
            QuickMessage::AccidentAhead => 2.5,
            QuickMessage::RoadWork => 1.5,
            _ => 1.0,
        }
    }
}

/// GPS Position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy: f32,
    pub speed: Option<f32>,      // m/s
    pub heading: Option<f32>,    // degrees
    pub timestamp: i64,          // Unix timestamp ms
}

impl Position {
    /// Calculate distance to another position in meters (Haversine formula)
    pub fn distance_to(&self, other: &Position) -> f64 {
        const EARTH_RADIUS: f64 = 6_371_000.0; // meters

        let lat1 = self.latitude.to_radians();
        let lat2 = other.latitude.to_radians();
        let dlat = (other.latitude - self.latitude).to_radians();
        let dlon = (other.longitude - self.longitude).to_radians();

        let a = (dlat / 2.0).sin().powi(2)
              + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().asin();

        EARTH_RADIUS * c
    }
}

/// A signed V2V message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct V2VMessage {
    /// Unique message ID (UUID v4)
    pub id: String,
    /// Sender's public key (hex encoded)
    pub sender_id: String,
    /// Sender's device/vehicle name
    pub sender_name: Option<String>,
    /// Message type
    pub msg_type: V2VMessageType,
    /// Payload (JSON encoded)
    pub payload: String,
    /// Sender's position (if shared)
    pub position: Option<Position>,
    /// Timestamp (Unix ms)
    pub timestamp: i64,
    /// Ed25519 signature (base64 encoded)
    pub signature: String,
}

impl V2VMessage {
    /// Create the bytes to sign (excludes signature field)
    pub fn signable_bytes(&self) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend(self.id.as_bytes());
        data.extend(self.sender_id.as_bytes());
        data.extend(&(self.msg_type as u8).to_le_bytes());
        data.extend(self.payload.as_bytes());
        data.extend(&self.timestamp.to_le_bytes());
        if let Some(pos) = &self.position {
            data.extend(&pos.latitude.to_le_bytes());
            data.extend(&pos.longitude.to_le_bytes());
        }
        data
    }

    /// Verify the message signature
    pub fn verify(&self) -> Result<bool, String> {
        let pubkey_bytes = hex::decode(&self.sender_id)
            .map_err(|e| format!("Invalid sender_id hex: {}", e))?;

        let pubkey_array: [u8; 32] = pubkey_bytes.try_into()
            .map_err(|_| "sender_id must be 32 bytes")?;

        let verifying_key = VerifyingKey::from_bytes(&pubkey_array)
            .map_err(|e| format!("Invalid public key: {}", e))?;

        let sig_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &self.signature
        ).map_err(|e| format!("Invalid signature base64: {}", e))?;

        let sig_array: [u8; 64] = sig_bytes.try_into()
            .map_err(|_| "Signature must be 64 bytes")?;

        let signature = Signature::from_bytes(&sig_array);

        let message_bytes = self.signable_bytes();

        match verifying_key.verify(&message_bytes, &signature) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}

/// Wallet for signing V2V messages
pub struct V2VWallet {
    pub signing_key: SigningKey,
    pub public_key: String, // hex encoded
    pub device_name: String,
}

impl V2VWallet {
    /// Create a new wallet with random keypair
    pub fn new(device_name: String) -> Self {
        use rand_core::{RngCore, OsRng};
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let signing_key = SigningKey::from_bytes(&secret);
        let public_key = hex::encode(signing_key.verifying_key().as_bytes());

        Self {
            signing_key,
            public_key,
            device_name,
        }
    }

    /// Restore wallet from secret key bytes
    pub fn from_secret_key(secret_bytes: &[u8], device_name: String) -> Result<Self, String> {
        let key_array: [u8; 32] = secret_bytes.try_into()
            .map_err(|_| "Secret key must be 32 bytes")?;

        let signing_key = SigningKey::from_bytes(&key_array);
        let public_key = hex::encode(signing_key.verifying_key().as_bytes());

        Ok(Self {
            signing_key,
            public_key,
            device_name,
        })
    }

    /// Export secret key bytes (for secure storage)
    pub fn export_secret_key(&self) -> Vec<u8> {
        self.signing_key.to_bytes().to_vec()
    }

    /// Sign a message
    pub fn sign_message(
        &self,
        msg_type: V2VMessageType,
        payload: String,
        position: Option<Position>,
    ) -> V2VMessage {
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = chrono::Utc::now().timestamp_millis();

        // Create unsigned message
        let mut msg = V2VMessage {
            id,
            sender_id: self.public_key.clone(),
            sender_name: Some(self.device_name.clone()),
            msg_type,
            payload,
            position,
            timestamp,
            signature: String::new(),
        };

        // Sign it
        let signable = msg.signable_bytes();
        let signature = self.signing_key.sign(&signable);
        msg.signature = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            signature.to_bytes()
        );

        msg
    }
}

/// Reward calculation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardCalculation {
    /// Base reward in micro-GARA
    pub base_reward: u64,
    /// Multiplier applied (time of day, safety, etc.)
    pub multiplier: f64,
    /// Final reward in micro-GARA
    pub final_reward: u64,
    /// DC cost for receiver
    pub dc_cost: u64,
    /// Breakdown explanation
    pub breakdown: String,
}

/// Calculate reward for a V2V message
pub fn calculate_reward(
    msg: &V2VMessage,
    receiver_count: u32,
    is_verified: bool,
) -> RewardCalculation {
    let base = msg.msg_type.base_reward();
    let dc = msg.msg_type.dc_cost();

    // Start with base multiplier
    let mut multiplier = 1.0;
    let mut breakdown = format!("Base: {} µGARA", base);

    // Receiver count bonus (capped at 10x)
    if receiver_count > 1 {
        let receiver_bonus = (receiver_count as f64).min(10.0);
        multiplier *= receiver_bonus;
        breakdown.push_str(&format!(" × {} receivers", receiver_count.min(10)));
    }

    // Quick message safety bonus
    if msg.msg_type == V2VMessageType::QuickMessage {
        if let Ok(qm) = serde_json::from_str::<QuickMessage>(&msg.payload) {
            let safety_mult = qm.reward_multiplier();
            if safety_mult > 1.0 {
                multiplier *= safety_mult;
                breakdown.push_str(&format!(" × {:.1} safety bonus", safety_mult));
            }
        }
    }

    // Verification bonus
    if is_verified {
        multiplier *= 1.2;
        breakdown.push_str(" × 1.2 verified");
    }

    // Time of day bonus (rush hour = more value)
    let hour = chrono::Utc::now().hour();
    if (7..=9).contains(&hour) || (17..=19).contains(&hour) {
        multiplier *= 1.5;
        breakdown.push_str(" × 1.5 rush hour");
    }

    let final_reward = (base as f64 * multiplier).round() as u64;
    breakdown.push_str(&format!(" = {} µGARA", final_reward));

    RewardCalculation {
        base_reward: base,
        multiplier,
        final_reward,
        dc_cost: dc * receiver_count as u64,
        breakdown,
    }
}

/// Track pending rewards for batch submission to blockchain
#[derive(Debug, Clone, Default)]
pub struct RewardTracker {
    /// Pending rewards by sender public key
    pending: HashMap<String, u64>,
    /// Total messages sent
    message_count: u64,
    /// Total rewards earned (micro-GARA)
    total_earned: u64,
}

impl RewardTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add reward for a message
    pub fn add_reward(&mut self, sender_id: &str, reward: &RewardCalculation) {
        *self.pending.entry(sender_id.to_string()).or_insert(0) += reward.final_reward;
        self.message_count += 1;
        self.total_earned += reward.final_reward;
    }

    /// Get pending reward for a sender
    pub fn get_pending(&self, sender_id: &str) -> u64 {
        self.pending.get(sender_id).copied().unwrap_or(0)
    }

    /// Get all pending rewards
    pub fn get_all_pending(&self) -> Vec<(String, u64)> {
        self.pending.iter().map(|(k, v)| (k.clone(), *v)).collect()
    }

    /// Flush pending rewards (after blockchain submission)
    pub fn flush(&mut self) -> Vec<(String, u64)> {
        let rewards = self.get_all_pending();
        self.pending.clear();
        rewards
    }

    /// Get statistics
    pub fn stats(&self) -> (u64, u64) {
        (self.message_count, self.total_earned)
    }
}

// Hex encoding helper (since we can't use external crate easily)
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    pub fn decode(s: &str) -> Result<Vec<u8>, String> {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallet_sign_verify() {
        let wallet = V2VWallet::new("TestDevice".to_string());

        let msg = wallet.sign_message(
            V2VMessageType::Text,
            "Hello V2V!".to_string(),
            None,
        );

        assert!(msg.verify().unwrap());
    }

    #[test]
    fn test_reward_calculation() {
        let wallet = V2VWallet::new("TestDevice".to_string());
        let msg = wallet.sign_message(
            V2VMessageType::Emergency,
            "Accident on highway".to_string(),
            None,
        );

        let reward = calculate_reward(&msg, 5, true);

        // Base 500 × 5 receivers × 1.2 verified = 3000+ (ignoring time bonus)
        assert!(reward.final_reward >= 3000);
        println!("Reward: {}", reward.breakdown);
    }

    #[test]
    fn test_distance_calculation() {
        let pos1 = Position {
            latitude: 40.7128,
            longitude: -74.0060,
            accuracy: 10.0,
            speed: None,
            heading: None,
            timestamp: 0,
        };

        let pos2 = Position {
            latitude: 40.7138,
            longitude: -74.0050,
            accuracy: 10.0,
            speed: None,
            heading: None,
            timestamp: 0,
        };

        let distance = pos1.distance_to(&pos2);
        // Should be roughly 130-140 meters
        assert!(distance > 100.0 && distance < 200.0);
    }
}
