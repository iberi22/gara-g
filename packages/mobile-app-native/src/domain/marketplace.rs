//! Represents data prepared for the GARA marketplace.

use serde::{Deserialize, Serialize};
use crate::domain::telemetry::{RoadType, WeatherConditions};

/// A batch of anonymized telemetry data ready for sale.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnonymizedBatch {
    /// A unique identifier for this anonymized batch.
    pub batch_id: String,
    /// A collection of anonymized data points.
    pub data_points: Vec<AnonymizedDataPoint>,
    /// The H3 resolution used for anonymization.
    pub h3_resolution: u8,
    pub data_hash: [u8; 32],
    pub record_count: u64,
    pub price_gara: u64,
    pub merkle_proof: Vec<[u8; 32]>,
    pub time_range: (i64, i64),
}

/// Simplified reputation model for marketplace participants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParticipantReputation {
    pub participant_id: String,
    pub score: u32,
    pub successful_sales: u32,
    pub last_updated: i64,
}

impl ParticipantReputation {
    pub fn new(participant_id: String) -> Self {
        Self {
            participant_id,
            score: 100, // Initial reputation
            successful_sales: 0,
            last_updated: chrono::Utc::now().timestamp(),
        }
    }

    pub fn update_score(&mut self, delta: i32) {
        let new_score = self.score as i32 + delta;
        self.score = new_score.clamp(0, 10000) as u32;
        self.last_updated = chrono::Utc::now().timestamp();
    }
}

/// A single anonymized telemetry data point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnonymizedDataPoint {
    /// The timestamp of the original data point.
    pub timestamp: i64,
    /// The H3 cell index representing the fuzzed location.
    pub fuzzed_h3_index: String,
    /// The type of road where the data was collected.
    pub road_type: RoadType,
    /// The weather conditions at the time of data collection.
    pub weather: WeatherConditions,
}

/// User preferences for opting into notifications and control over marketplace data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OptInPreferences {
    /// Minimum payout required to accept an offer (in micro-GARA)
    pub min_payout: u64,
    /// Hour from which notifications are allowed (0-23)
    pub start_hour: u8,
    /// Hour until which notifications are allowed (0-23)
    pub end_hour: u8,
    /// Categories of data the user allows to trigger notifications
    pub allowed_categories: Vec<String>,
    /// Whether P2P notification relay is active
    pub opt_in_p2p: bool,
}

impl Default for OptInPreferences {
    fn default() -> Self {
        Self {
            min_payout: 10000, // 0.01 GARA as default (10,000 micro-GARA)
            start_hour: 8,     // 8:00 AM
            end_hour: 22,    // 10:00 PM
            allowed_categories: vec![
                "location".to_string(),
                "telemetry".to_string(),
                "video".to_string(),
                "roadConditions".to_string(),
            ],
            opt_in_p2p: true,
        }
    }
}

/// A listing created by a producer in the marketplace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataListing {
    pub listing_id: String,
    pub producer_id: String,
    pub price_gara: u64,
    pub latitude: f64,
    pub longitude: f64,
    pub category: String,
    pub description: String,
    pub created_at: i64,
}

/// Represents the possible states of a marketplace transaction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TransactionStatus {
    Requested,
    Accepted,
    Paid,
    Delivered,
    Confirmed,
    Disputed,
    Resolved,
}

/// Options for resolving a disputed transaction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DisputeResolution {
    RefundConsumer,
    ReleaseToProducer,
}

/// A transaction between a consumer and a producer for data purchase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MarketplaceTransaction {
    pub transaction_id: String,
    pub listing_id: String,
    pub consumer_id: String,
    pub producer_id: String,
    pub price_gara: u64,
    pub status: TransactionStatus,
    pub data_payload: Option<String>,
    pub updated_at: i64,
}

/// Calculates the Haversine distance between two coordinates in meters.
pub fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6_371_000.0; // Earth's radius in meters
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let delta_phi = (lat2 - lat1).to_radians();
    let delta_lambda = (lon2 - lon1).to_radians();

    let a = (delta_phi / 2.0).sin().powi(2)
        + phi1.cos() * phi2.cos() * (delta_lambda / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());

    r * c
}
