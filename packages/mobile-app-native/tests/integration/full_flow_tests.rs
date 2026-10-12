use async_trait::async_trait;
use native::application::marketplace_use_cases::PrepareDataForSaleUseCase;
use native::application::telemetry_use_cases::{ExportTelemetryBatchUseCase, RecordTelemetryUseCase};
use native::domain::anonymizer::Anonymizer;
use native::domain::telemetry::{GeoPoint, SensorData, TelemetryBatch};
use native::infrastructure::db::DatabaseAdapter;
use crate::mocks::event_bus::MockEventBus;
use anyhow::Result;
use std::sync::Mutex;

/// In-memory database adapter for integration testing
pub struct InMemoryDatabaseAdapter {
    data: Mutex<Vec<SensorData>>,
}

impl InMemoryDatabaseAdapter {
    pub fn new() -> Self {
        Self {
            data: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl DatabaseAdapter for InMemoryDatabaseAdapter {
    async fn store_telemetry(&self, data: SensorData) -> Result<()> {
        let mut storage = self.data.lock().unwrap();
        storage.push(data);
        Ok(())
    }

    async fn query_telemetry(&self, start_time: i64, end_time: i64) -> Result<TelemetryBatch> {
        let storage = self.data.lock().unwrap();
        let filtered: Vec<SensorData> = storage
            .iter()
            .filter(|d| d.timestamp >= start_time && d.timestamp <= end_time)
            .cloned()
            .collect();

        Ok(TelemetryBatch {
            id: [0u8; 32],
            data_points: filtered,
            merkle_root: [0u8; 32],
            created_at: 0,
        })
    }
}

#[tokio::test]
async fn test_full_telemetry_to_marketplace_flow() {
    // Setup infrastructure and use cases
    let db = InMemoryDatabaseAdapter::new();
    let bus = MockEventBus::new();
    let anonymizer = Anonymizer::default();

    let record_use_case = RecordTelemetryUseCase::new(&db, &bus);
    let export_use_case = ExportTelemetryBatchUseCase::new(&db, &anonymizer);
    let prepare_use_case = PrepareDataForSaleUseCase::new(&anonymizer);

    // 1. Record telemetry data (create multiple points)
    let data1 = SensorData {
        timestamp: 1000,
        vehicle_id: [1u8; 32],
        speed: 50.5,
        rpm: 2000,
        fuel_level: 0.5,
        location: Some(GeoPoint { lat: 37.77492, lon: -122.41942, accuracy: 5.0 }),
        obd_codes: vec![],
        accelerometer: None,
        gyroscope: None,
    };

    let data2 = SensorData {
        timestamp: 2000,
        vehicle_id: [1u8; 32],
        speed: 55.0,
        rpm: 2200,
        fuel_level: 0.49,
        location: Some(GeoPoint { lat: 37.7750, lon: -122.4195, accuracy: 5.0 }),
        obd_codes: vec![],
        accelerometer: None,
        gyroscope: None,
    };

    record_use_case.execute(data1).await.expect("Failed to record data 1");
    record_use_case.execute(data2).await.expect("Failed to record data 2");

    // 2. Export batch from vault
    let batch = export_use_case.execute(0, 3000).await.expect("Failed to export batch");
    assert_eq!(batch.data_points.len(), 2, "Should have exported 2 data points");

    // Verify anonymization happened during export (location should be fuzzed)
    if let Some(loc) = batch.data_points[0].location {
        assert_ne!(loc.lat, 37.77492, "Latitude should be anonymized");
    }

    // 3. Anonymize location and prepare marketplace listing
    let raw_batch = bincode::serialize(&batch).expect("Failed to serialize batch");
    let anonymized_batch = prepare_use_case.execute(raw_batch).expect("Failed to prepare data for sale");

    // 4. Verify marketplace listing structure and business logic
    assert_eq!(anonymized_batch.record_count, 2, "Marketplace batch should have 2 records");
    assert_eq!(anonymized_batch.price_gara, 20, "Price should be 10 GARA per record (2 * 10 = 20)");

    // 5. Verify merkle proof structure and batch integrity
    assert_ne!(anonymized_batch.data_hash, [0u8; 32], "Data hash should be populated");
    assert!(!anonymized_batch.merkle_proof.is_empty(), "Merkle proof should not be empty");

    println!("Full flow integration test passed successfully!");
}
