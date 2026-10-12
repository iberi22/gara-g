use crate::domain::v2v::Position;
use crate::domain::telemetry::{GeoPoint, TelemetryBatch};
use crate::domain::marketplace::AnonymizedBatch;

const DEFAULT_GEO_PRECISION_LOSS: f64 = 0.01; // Approx 1km fuzzing

pub struct AnonymizedData {
    pub fuzzy_lat: f64,
    pub fuzzy_lon: f64,
    pub timestamp: f64,
    pub data_type: String,
}

pub struct Anonymizer {
    pub precision_loss: f64,
}

impl Anonymizer {
    pub fn new(precision_loss: f64) -> Self {
        Self { precision_loss }
    }

    pub fn default() -> Self {
        Self { precision_loss: DEFAULT_GEO_PRECISION_LOSS }
    }

    pub fn anonymize_location(&self, point: &GeoPoint) -> GeoPoint {
        let fuzz = |val: f64| (val / self.precision_loss).round() * self.precision_loss;
        GeoPoint {
            lat: fuzz(point.lat),
            lon: fuzz(point.lon),
            accuracy: 1000.0 as f32,
        }
    }

    pub fn anonymize_batch(&self, batch: &TelemetryBatch) -> AnonymizedBatch {
        let count = batch.data_points.len() as u64;
        let start = batch.data_points.first().map(|d| d.timestamp).unwrap_or(0);
        let end = batch.data_points.last().map(|d| d.timestamp).unwrap_or(0);

        AnonymizedBatch {
            batch_id: hex::encode(batch.id),
            data_points: vec![], // Placeholder
            h3_resolution: 8,
            data_hash: [0u8; 32],
            record_count: count,
            time_range: (start, end),
            price_gara: 0,
            merkle_proof: vec![],
        }
    }
}

pub fn anonymize_position(pos: &Position) -> Position {
    // Truncate lat/lon to simulate "Area Level" data instead of "Point Level"
    // e.g., 40.7128 -> 40.71
    let fuzz = |val: f64| (val / DEFAULT_GEO_PRECISION_LOSS).round() * DEFAULT_GEO_PRECISION_LOSS;

    Position {
        latitude: fuzz(pos.latitude),
        longitude: fuzz(pos.longitude),
        heading: None, // Remove heading to prevent tracking
        speed: None,   // Remove speed
        accuracy: 1000.0 as f32, // Low accuracy
        timestamp: pos.timestamp
    }
}

pub fn scrub_pii(text: String) -> String {
    // Simple scrubber: Remove patterns that look like emails or IDs (mocked)
    text.replace("@", "[REDACTED]")
}
