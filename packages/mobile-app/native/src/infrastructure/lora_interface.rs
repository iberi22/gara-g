//! LoRaWAN Network Interface
//!
//! Provides LoRaWAN connectivity for long-range, low-power communication.
//! Supports both physical LoRa modules (via BLE/USB) and simulation.

use anyhow::Result;
use std::time::Duration;
use super::network_interface::{ConnectionStatus, NetworkInterface, NetworkStats};

/// LoRaWAN frequency bands
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoraFrequency {
    /// Europe, Africa, Asia - 868 MHz
    EU868,
    /// US, Canada, Australia - 915 MHz
    US915,
    /// China - 470 MHz
    CN470,
}

impl LoraFrequency {
    pub fn frequency_mhz(&self) -> u32 {
        match self {
            LoraFrequency::EU868 => 868,
            LoraFrequency::US915 => 915,
            LoraFrequency::CN470 => 470,
        }
    }
}

pub struct LoraInterface {
    frequency: LoraFrequency,
    status: ConnectionStatus,
    stats: NetworkStats,
    is_listening: bool,
    hardware_connected: bool,
}

impl LoraInterface {
    pub fn new(frequency: LoraFrequency) -> Self {
        Self {
            frequency,
            status: ConnectionStatus::NoHardware,
            stats: NetworkStats::new(),
            is_listening: false,
            hardware_connected: false,
        }
    }

    /// Check for LoRa hardware (BLE modem, USB dongle, or embedded module)
    pub fn detect_hardware(&mut self) -> bool {
        // In real implementation:
        // 1. Scan for BLE devices advertising LoRa service UUID
        // 2. Check for USB serial devices (VID/PID for LoRa modules)
        // 3. On supported phones, check if internal LoRa chip is present

        // For simulation: assume no hardware by default
        self.hardware_connected = false;
        self.status = if self.hardware_connected {
            ConnectionStatus::Disconnected
        } else {
            ConnectionStatus::NoHardware
        };

        self.hardware_connected
    }

    /// Start listening for LoRa packets
    pub fn start_listening(&mut self) -> Result<()> {
        if !self.hardware_connected {
            return Err(anyhow::anyhow!("No LoRa hardware detected"));
        }

        if !self.status.is_usable() {
            return Err(anyhow::anyhow!("LoRa not connected"));
        }

        self.is_listening = true;
        Ok(())
    }

    /// Stop listening for LoRa packets
    pub fn stop_listening(&mut self) {
        self.is_listening = false;
    }

    /// Check if currently listening
    pub fn is_listening(&self) -> bool {
        self.is_listening
    }

    /// Get the frequency band in use
    pub fn get_frequency(&self) -> LoraFrequency {
        self.frequency
    }

    /// Simulate receiving a LoRa packet (for testing)
    pub fn simulate_receive(&mut self, data: Vec<u8>) {
        if self.is_listening {
            self.stats.record_receive(data.len() as u64);
        }
    }

    /// Get network statistics
    pub fn get_stats(&self) -> &NetworkStats {
        &self.stats
    }
}

impl NetworkInterface for LoraInterface {
    fn name(&self) -> &str {
        match self.frequency {
            LoraFrequency::EU868 => "LoRaWAN EU868",
            LoraFrequency::US915 => "LoRaWAN US915",
            LoraFrequency::CN470 => "LoRaWAN CN470",
        }
    }

    fn status(&self) -> ConnectionStatus {
        self.status
    }

    fn is_hardware_present(&self) -> bool {
        self.hardware_connected
    }

    fn connect(&mut self) -> Result<()> {
        self.detect_hardware();

        if !self.hardware_connected {
            return Err(anyhow::anyhow!("No LoRa hardware found"));
        }

        self.status = ConnectionStatus::Connecting;

        // Simulate connection delay
        std::thread::sleep(Duration::from_millis(200));

        // Assume successful connection with good signal (4/5)
        self.status = ConnectionStatus::Connected(4);
        Ok(())
    }

    fn disconnect(&mut self) -> Result<()> {
        self.stop_listening();
        self.status = ConnectionStatus::Disconnected;
        Ok(())
    }

    fn send(&mut self, data: &[u8]) -> Result<usize> {
        if !self.status.is_usable() {
            self.stats.record_error();
            return Err(anyhow::anyhow!("LoRa not connected"));
        }

        if data.len() > self.max_payload_size() {
            self.stats.record_error();
            return Err(anyhow::anyhow!(
                "Payload too large: {} bytes (max {})",
                data.len(),
                self.max_payload_size()
            ));
        }

        // Simulate transmission delay (~1 second for LoRa)
        std::thread::sleep(Duration::from_millis(1000));

        self.stats.record_send(data.len() as u64);
        Ok(data.len())
    }

    fn max_payload_size(&self) -> usize {
        // LoRaWAN max payload depends on spreading factor and region
        // Typical max: 51-242 bytes
        // Using 51 bytes for worst case (SF12 in EU868)
        51
    }

    fn estimated_latency_ms(&self) -> u64 {
        // LoRa latency depends on spreading factor
        // SF7: ~100ms, SF12: ~2000ms
        // Using average of ~1 second
        1000
    }

    fn bandwidth_bps(&self) -> u64 {
        // LoRa bandwidth is very low
        // Typical: 250-5470 bps depending on SF
        // Using conservative estimate: 980 bps (DR0 in EU868)
        980
    }

    fn supports_receive(&self) -> bool {
        true
    }

    fn receive(&mut self) -> Result<Vec<u8>> {
        if !self.is_listening {
            return Err(anyhow::anyhow!("Not listening for LoRa packets"));
        }

        // In real implementation: read from hardware buffer
        // For simulation: return empty (no packets)
        Err(anyhow::anyhow!("No packets available"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lora_frequency_values() {
        assert_eq!(LoraFrequency::EU868.frequency_mhz(), 868);
        assert_eq!(LoraFrequency::US915.frequency_mhz(), 915);
        assert_eq!(LoraFrequency::CN470.frequency_mhz(), 470);
    }

    #[test]
    fn test_lora_interface_initial_state() {
        let lora = LoraInterface::new(LoraFrequency::EU868);
        assert_eq!(lora.status(), ConnectionStatus::NoHardware);
        assert!(!lora.is_hardware_present());
        assert!(!lora.is_listening());
    }

    #[test]
    fn test_lora_interface_name() {
        let lora_eu = LoraInterface::new(LoraFrequency::EU868);
        assert_eq!(lora_eu.name(), "LoRaWAN EU868");

        let lora_us = LoraInterface::new(LoraFrequency::US915);
        assert_eq!(lora_us.name(), "LoRaWAN US915");

        let lora_cn = LoraInterface::new(LoraFrequency::CN470);
        assert_eq!(lora_cn.name(), "LoRaWAN CN470");
    }

    #[test]
    fn test_lora_interface_max_payload() {
        let lora = LoraInterface::new(LoraFrequency::EU868);
        assert_eq!(lora.max_payload_size(), 51);
    }

    #[test]
    fn test_lora_interface_latency() {
        let lora = LoraInterface::new(LoraFrequency::EU868);
        assert_eq!(lora.estimated_latency_ms(), 1000);
    }

    #[test]
    fn test_lora_interface_bandwidth() {
        let lora = LoraInterface::new(LoraFrequency::EU868);
        assert_eq!(lora.bandwidth_bps(), 980);
    }

    #[test]
    fn test_lora_interface_supports_receive() {
        let lora = LoraInterface::new(LoraFrequency::EU868);
        assert!(lora.supports_receive());
    }

    #[test]
    fn test_lora_interface_hardware_detection() {
        let mut lora = LoraInterface::new(LoraFrequency::EU868);
        let has_hardware = lora.detect_hardware();
        // In simulation mode, should return false
        assert!(!has_hardware);
        assert_eq!(lora.status(), ConnectionStatus::NoHardware);
    }

    #[test]
    fn test_lora_interface_start_listening_without_connection() {
        let mut lora = LoraInterface::new(LoraFrequency::EU868);
        let result = lora.start_listening();
        assert!(result.is_err());
    }

    #[test]
    fn test_lora_interface_stop_listening() {
        let mut lora = LoraInterface::new(LoraFrequency::EU868);
        lora.is_listening = true;
        lora.stop_listening();
        assert!(!lora.is_listening());
    }

    #[test]
    fn test_lora_interface_send_without_connection() {
        let mut lora = LoraInterface::new(LoraFrequency::EU868);
        let result = lora.send(b"test message");
        assert!(result.is_err());
        assert_eq!(lora.get_stats().messages_sent, 0);
        assert_eq!(lora.get_stats().errors, 1);
    }

    #[test]
    fn test_lora_interface_send_too_large() {
        let mut lora = LoraInterface::new(LoraFrequency::EU868);
        lora.status = ConnectionStatus::Connected(4);
        lora.hardware_connected = true;

        // Create message larger than 51 bytes
        let large_message = vec![0u8; 52];
        let result = lora.send(&large_message);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too large"));
    }

    #[test]
    fn test_lora_interface_get_frequency() {
        let lora_eu = LoraInterface::new(LoraFrequency::EU868);
        assert_eq!(lora_eu.get_frequency(), LoraFrequency::EU868);

        let lora_us = LoraInterface::new(LoraFrequency::US915);
        assert_eq!(lora_us.get_frequency(), LoraFrequency::US915);
    }

    #[test]
    fn test_lora_interface_simulate_receive() {
        let mut lora = LoraInterface::new(LoraFrequency::EU868);
        lora.is_listening = true;

        let test_data = vec![1, 2, 3, 4, 5];
        lora.simulate_receive(test_data.clone());

        assert_eq!(lora.get_stats().messages_received, 1);
        assert_eq!(lora.get_stats().bytes_received, test_data.len() as u64);
    }

    #[test]
    fn test_lora_interface_receive_when_not_listening() {
        let mut lora = LoraInterface::new(LoraFrequency::EU868);
        let result = lora.receive();
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not listening"));
    }
}
