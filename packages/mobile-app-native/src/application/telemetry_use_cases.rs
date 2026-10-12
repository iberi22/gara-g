//! Telemetry-related use cases

use crate::domain::anonymizer::Anonymizer;
use crate::domain::telemetry::{SensorData, TelemetryBatch};
use crate::infrastructure::{db::DatabaseAdapter, event_bus::EventBus};
use anyhow::Result;
use sha2::{Digest, Sha256};

/// Use Case: Record new telemetry data point
pub struct RecordTelemetryUseCase<'a> {
    db: &'a dyn DatabaseAdapter,
    bus: &'a dyn EventBus,
}

impl<'a> RecordTelemetryUseCase<'a> {
    pub fn new(db: &'a dyn DatabaseAdapter, bus: &'a dyn EventBus) -> Self {
        Self { db, bus }
    }

    pub async fn execute(&self, data: SensorData) -> Result<()> {
        // 1. Validate sensor data
        data.validate().map_err(|e| anyhow::anyhow!("{:?}", e))?;

        // 2. Store in local vault
        self.db.store_telemetry(data).await?;
        // 3. Emit event for sync
        self.bus.emit(&"TelemetryRecorded").await;
        Ok(())
    }
}

/// Use Case: Export telemetry batch for marketplace
pub struct ExportTelemetryBatchUseCase<'a> {
    db: &'a dyn DatabaseAdapter,
    anonymizer: &'a Anonymizer,
}

impl<'a> ExportTelemetryBatchUseCase<'a> {
    pub fn new(db: &'a dyn DatabaseAdapter, anonymizer: &'a Anonymizer) -> Self {
        Self { db, anonymizer }
    }

    pub async fn execute(&self, start_time: i64, end_time: i64) -> Result<TelemetryBatch> {
        // 1. Query telemetry from vault
        let mut batch = self.db.query_telemetry(start_time, end_time).await?;

        // 2. Anonymize GPS coordinates
        for dp in &mut batch.data_points {
            if let Some(loc) = &dp.location {
                dp.location = Some(self.anonymizer.anonymize_location(loc));
            }
        }

        // 3. Generate merkle root for batch integrity
        let mut hasher = Sha256::new();
        for dp in &batch.data_points {
            // In a real application, use a stable serialization format like protobuf or bincode
            hasher.update(format!("{:?}", dp).as_bytes());
        }
        let hash_result = hasher.finalize();
        batch.merkle_root.copy_from_slice(&hash_result);

        // 4. Return batch
        Ok(batch)
    }
}
