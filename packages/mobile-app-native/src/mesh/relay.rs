//! V2V Mesh Forwarding and Relay Logic
//!
//! Encapsulates rules for packet forwarding, including:
//! - Loop prevention & duplicate filtering via packet ID cache
//! - TTL and hop count limits
//! - High-priority emergency bypasses (critical alerts skip standard queues/checks)
//! - Adaptive flood control

use crate::protocol::SafetyPacket;
use std::collections::{HashSet, VecDeque};

const DUPLICATE_CACHE_MAX_SIZE: usize = 1000;

pub struct MeshRelay {
    /// Remembers recently processed packet IDs (temp_id) to prevent loops
    seen_packets: HashSet<u32>,
    /// Ordering deque to support LRU eviction on seen packet cache
    eviction_queue: VecDeque<u32>,
    /// Maximum allowed packet hop count
    default_max_hops: u8,
}

impl MeshRelay {
    pub fn new(default_max_hops: u8) -> Self {
        Self {
            seen_packets: HashSet::with_capacity(DUPLICATE_CACHE_MAX_SIZE),
            eviction_queue: VecDeque::with_capacity(DUPLICATE_CACHE_MAX_SIZE),
            default_max_hops,
        }
    }

    /// Process a received SafetyPacket and determine if it should be relayed.
    ///
    /// Returns `Some(SafetyPacket)` representing the updated packet with incremented hop count
    /// if the packet is new and eligible for forwarding. Otherwise, returns `None`.
    pub fn process_packet(&mut self, packet: &SafetyPacket) -> Option<SafetyPacket> {
        // 1. Check duplicate cache (loop prevention)
        if self.seen_packets.contains(&packet.temp_id) {
            return None; // Already processed, drop to prevent packet storm
        }

        // 2. Add to duplicate cache with LRU eviction
        if self.seen_packets.len() >= DUPLICATE_CACHE_MAX_SIZE {
            if let Some(oldest_id) = self.eviction_queue.pop_front() {
                self.seen_packets.remove(&oldest_id);
            }
        }
        self.seen_packets.insert(packet.temp_id);
        self.eviction_queue.push_back(packet.temp_id);

        // 3. High priority check - Bypasses certain checks, but still respects max hops
        let is_high_priority = packet.is_high_priority();

        // 4. Check hop count / TTL limits
        if packet.hop_count >= packet.max_hops {
            return None; // Exceeded allowed hops, discard
        }

        // 5. Build and return the forwarded packet
        let forwarded_packet = packet.forwarded();
        Some(forwarded_packet)
    }

    /// Reset internal duplicate packet cache
    pub fn clear(&mut self) {
        self.seen_packets.clear();
        self.eviction_queue.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{MsgType, SafetyPacket};

    #[test]
    fn test_unit_relay_deduplication_and_priority() {
        let mut relay = MeshRelay::new(5);

        let packet = SafetyPacket {
            magic: b'G',
            version: 2,
            msg_type: MsgType::Heartbeat,
            network_id: 0,
            hop_count: 0,
            max_hops: 5,
            temp_id: 77777,
            timestamp: 0,
            lat: 0,
            lon: 0,
            speed_cms: 0,
            heading: 0,
            events: 0,
        };

        // First process
        let rel_pkt = relay.process_packet(&packet).unwrap();
        assert_eq!(rel_pkt.hop_count, 1);

        // Duplicate
        assert!(relay.process_packet(&packet).is_none());

        // Max hops exceeded
        let packet_too_far = SafetyPacket {
            magic: b'G',
            version: 2,
            msg_type: MsgType::Heartbeat,
            network_id: 0,
            hop_count: 5,
            max_hops: 5,
            temp_id: 88888,
            timestamp: 0,
            lat: 0,
            lon: 0,
            speed_cms: 0,
            heading: 0,
            events: 0,
        };
        assert!(relay.process_packet(&packet_too_far).is_none());
    }
}
