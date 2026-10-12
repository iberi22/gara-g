//! V2V Communication use cases

use crate::domain::v2v::{MessageType, Position, V2VMessage, V2VWallet};
use anyhow::{anyhow, Result};

/// Use Case: Broadcast safety message to nearby vehicles
pub struct BroadcastSafetyMessageUseCase<'a> {
    wallet: &'a V2VWallet,
}

impl<'a> BroadcastSafetyMessageUseCase<'a> {
    pub fn new(wallet: &'a V2VWallet) -> Self {
        Self { wallet }
    }

    pub fn execute(&self, msg_type: u8, position: Option<Position>) -> Result<V2VMessage> {
         let msg_type_enum = match msg_type {
            0x01 => MessageType::Emergency,
            0x02 => MessageType::QuickMessage, // Hazard
            0x03 => MessageType::QuickMessage, // Traffic
            0x04 => MessageType::QuickMessage, // Road
            _ => return Err(anyhow!("Invalid message type")),
        };

        let payload = match msg_type {
            0x02 => "HazardWarning",
            0x03 => "TrafficJam",
            0x04 => "RoadCondition",
            _ => "Emergency",
        }.to_string();

        let message = self.wallet.sign_message(msg_type_enum, payload, position);

        Ok(message)
    }
}

/// Use Case: Process received V2V message
pub struct ProcessReceivedMessageUseCase;

impl ProcessReceivedMessageUseCase {
    pub fn execute(&self, message: V2VMessage) -> Result<Option<V2VMessage>> {
        // 1. Verify signature
        if !message.verify().unwrap_or(false) {
             return Ok(None);
        }

        // 2. Check message freshness
        let current_time = chrono::Utc::now().timestamp_millis();
        if (current_time - message.timestamp).abs() > 30000 { // 30 seconds
            return Ok(None); // Stale message
        }

        // 3. Update reward tracker (not implemented here)
        // 4. Return parsed message
        Ok(Some(message))
    }
}
