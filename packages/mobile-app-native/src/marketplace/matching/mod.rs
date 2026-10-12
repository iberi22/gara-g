//! P2P Matching Engine for Buyer-Seller Pairs.
//! Includes Vendor Opt-in notifications based on proximity, price and categories.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::domain::marketplace::haversine_distance;

/// Represents a P2P demand request created by a buyer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct P2PDemand {
    pub demand_id: String,
    pub buyer_id: String,
    pub category: String,
    pub max_price: u64,
    pub latitude: f64,
    pub longitude: f64,
    pub max_distance_meters: f64,
    pub min_reputation: u32,
    pub timestamp: i64,
}

/// Represents a P2P supply listing created by a seller/vendor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct P2PSupply {
    pub supply_id: String,
    pub seller_id: String,
    pub category: String,
    pub price: u64,
    pub latitude: f64,
    pub longitude: f64,
    pub seller_reputation: u32,
    pub timestamp: i64,
}

/// A matched buyer-seller pair.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchedP2PPair {
    pub match_id: String,
    pub demand_id: String,
    pub supply_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub category: String,
    pub matched_price: u64,
    pub distance_meters: f64,
}

/// Vendor preferences for opting into notification alerts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VendorOptInPreferences {
    pub vendor_id: String,
    pub notifications_enabled: bool,
    pub allowed_categories: Vec<String>,
    pub max_distance_km: f64,
    pub min_payout: u64,
}

impl Default for VendorOptInPreferences {
    fn default() -> Self {
        Self {
            vendor_id: "default_vendor".to_string(),
            notifications_enabled: true,
            allowed_categories: vec!["telemetry".to_string(), "video".to_string()],
            max_distance_km: 100.0,
            min_payout: 10,
        }
    }
}

/// Notification triggered for a vendor on incoming demand matches.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VendorNotification {
    pub notification_id: String,
    pub vendor_id: String,
    pub demand_id: String,
    pub message: String,
    pub timestamp: i64,
}

/// STATEFUL matching engine to manage the queues, matches, and opt-in notifications.
#[derive(Debug, Clone, Default)]
pub struct MatchingEngine {
    pub demand_queue: Vec<P2PDemand>,
    pub supply_queue: Vec<P2PSupply>,
    pub opt_in_preferences: HashMap<String, VendorOptInPreferences>,
    pub notifications: Vec<VendorNotification>,
    pub nonce: u64,
}

impl MatchingEngine {
    pub fn new() -> Self {
        Self {
            demand_queue: Vec::new(),
            supply_queue: Vec::new(),
            opt_in_preferences: HashMap::new(),
            notifications: Vec::new(),
            nonce: 0,
        }
    }

    /// Register or update vendor opt-in notification preferences
    pub fn update_vendor_preferences(&mut self, prefs: VendorOptInPreferences) {
        self.opt_in_preferences.insert(prefs.vendor_id.clone(), prefs);
    }

    /// Add supply listing to the queue
    pub fn add_supply(&mut self, supply: P2PSupply) {
        self.supply_queue.push(supply);
    }

    /// Add demand request to the queue.
    /// Triggers notifications to opted-in vendors whose criteria match this new demand.
    pub fn add_demand(&mut self, demand: P2PDemand, current_time: i64) {
        self.check_and_notify_vendors(&demand, current_time);
        self.demand_queue.push(demand);
    }

    /// Match demand and supply queues. Matches are made when:
    /// - Category is identical
    /// - Seller price <= Buyer max_price
    /// - Seller reputation meets Buyer min reputation requirement
    /// - Geolocation distance between buyer and seller <= Buyer max_distance_meters
    /// Settlement price is midpoint.
    pub fn match_queues(&mut self) -> Vec<MatchedP2PPair> {
        let mut matches = Vec::new();
        let mut i = 0;

        while i < self.demand_queue.len() {
            let demand = &self.demand_queue[i];
            let mut matched_index = None;
            let mut matched_distance = 0.0;

            for (j, supply) in self.supply_queue.iter().enumerate() {
                if demand.category == supply.category
                    && supply.price <= demand.max_price
                    && supply.seller_reputation >= demand.min_reputation
                {
                    let dist = haversine_distance(demand.latitude, demand.longitude, supply.latitude, supply.longitude);
                    if dist <= demand.max_distance_meters {
                        matched_index = Some(j);
                        matched_distance = dist;
                        break;
                    }
                }
            }

            if let Some(j) = matched_index {
                let demand = self.demand_queue.remove(i);
                let supply = self.supply_queue.remove(j);

                let matched_price = supply.price + (demand.max_price - supply.price) / 2;
                let match_id = format!("match_{}_{}", self.nonce, chrono::Utc::now().timestamp_millis());
                self.nonce += 1;

                let pair = MatchedP2PPair {
                    match_id,
                    demand_id: demand.demand_id,
                    supply_id: supply.supply_id,
                    buyer_id: demand.buyer_id,
                    seller_id: supply.seller_id,
                    category: demand.category,
                    matched_price,
                    distance_meters: matched_distance,
                };

                matches.push(pair);
            } else {
                i += 1;
            }
        }

        matches
    }

    /// Private helper to evaluate opt-in preferences for an incoming demand request and generate notifications.
    fn check_and_notify_vendors(&mut self, demand: &P2PDemand, current_time: i64) {
        for (vendor_id, prefs) in self.opt_in_preferences.iter() {
            if !prefs.notifications_enabled {
                continue;
            }

            // Check category opt-in
            if !prefs.allowed_categories.contains(&demand.category) {
                continue;
            }

            // Check minimum payout limit
            if demand.max_price < prefs.min_payout {
                continue;
            }

            // Geolocation check for notifications (vendor_prefs distance limit vs. vendor supply or location,
            // since this is a global preference we can check if there's any matching active supply or just use max_distance).
            // Here, we check if the demand's distance limit fits the vendor's maximum distance.
            let max_pref_distance_m = prefs.max_distance_km * 1000.0;
            if demand.max_distance_meters > max_pref_distance_m {
                continue;
            }

            // Trigger notification
            let notification_id = format!("notif_{}_{}", self.nonce, current_time);
            self.nonce += 1;

            let message = format!(
                "Vendor Alert: New matching demand found! Category: {}, Max Price: {} GARA",
                demand.category, demand.max_price
            );

            self.notifications.push(VendorNotification {
                notification_id,
                vendor_id: vendor_id.clone(),
                demand_id: demand.demand_id.clone(),
                message,
                timestamp: current_time,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matching_engine_haversine_and_reputation() {
        let mut engine = MatchingEngine::new();

        // Demands
        let d1 = P2PDemand {
            demand_id: "dem_1".to_string(),
            buyer_id: "buyer_1".to_string(),
            category: "telemetry".to_string(),
            max_price: 500,
            latitude: 40.7128,  // NYC
            longitude: -74.0060,
            max_distance_meters: 10000.0, // 10 km
            min_reputation: 80,
            timestamp: 100,
        };

        // Suppliess
        // 1. Correct category and price, but reputation too low
        let s_low_rep = P2PSupply {
            supply_id: "sup_low_rep".to_string(),
            seller_id: "seller_low".to_string(),
            category: "telemetry".to_string(),
            price: 300,
            latitude: 40.7128,
            longitude: -74.0060,
            seller_reputation: 50, // lower than 80
            timestamp: 120,
        };

        // 2. Correct category and price, but too far away (approx 15 km in NYC area)
        let s_far = P2PSupply {
            supply_id: "sup_far".to_string(),
            seller_id: "seller_far".to_string(),
            category: "telemetry".to_string(),
            price: 300,
            latitude: 40.8500, // further North
            longitude: -74.0060,
            seller_reputation: 90,
            timestamp: 130,
        };

        // 3. Perfect match
        let s_match = P2PSupply {
            supply_id: "sup_match".to_string(),
            seller_id: "seller_match".to_string(),
            category: "telemetry".to_string(),
            price: 400,
            latitude: 40.7130, // 200m away
            longitude: -74.0062,
            seller_reputation: 85,
            timestamp: 140,
        };

        engine.add_supply(s_low_rep);
        engine.add_supply(s_far);
        engine.add_supply(s_match);

        engine.add_demand(d1, 150);

        let matches = engine.match_queues();
        assert_eq!(matches.len(), 1);

        let m = &matches[0];
        assert_eq!(m.demand_id, "dem_1");
        assert_eq!(m.supply_id, "sup_match");
        assert_eq!(m.matched_price, 450); // Midpoint of 400 and 500
    }

    #[test]
    fn test_vendor_opt_in_notifications() {
        let mut engine = MatchingEngine::new();

        // Configure opted-in vendor
        let vendor_prefs = VendorOptInPreferences {
            vendor_id: "vendor_abc".to_string(),
            notifications_enabled: true,
            allowed_categories: vec!["video".to_string()],
            max_distance_km: 50.0,
            min_payout: 200,
        };
        engine.update_vendor_preferences(vendor_prefs);

        // Demand that matches perfectly
        let d_match = P2PDemand {
            demand_id: "dem_v1".to_string(),
            buyer_id: "buyer_v".to_string(),
            category: "video".to_string(),
            max_price: 300,
            latitude: 40.0,
            longitude: -70.0,
            max_distance_meters: 10000.0, // 10 km (under 50 km)
            min_reputation: 0,
            timestamp: 100,
        };

        engine.add_demand(d_match, 100);

        // Should have triggered 1 notification
        assert_eq!(engine.notifications.len(), 1);
        let n = &engine.notifications[0];
        assert_eq!(n.vendor_id, "vendor_abc");
        assert_eq!(n.demand_id, "dem_v1");
        assert!(n.message.contains("video"));

        // Demand with non-matching category
        let d_mismatch_category = P2PDemand {
            demand_id: "dem_v2".to_string(),
            buyer_id: "buyer_v".to_string(),
            category: "telemetry".to_string(), // Mismatch
            max_price: 300,
            latitude: 40.0,
            longitude: -70.0,
            max_distance_meters: 10000.0,
            min_reputation: 0,
            timestamp: 110,
        };

        engine.add_demand(d_mismatch_category, 110);
        // Notification count remains 1
        assert_eq!(engine.notifications.len(), 1);
    }
}
