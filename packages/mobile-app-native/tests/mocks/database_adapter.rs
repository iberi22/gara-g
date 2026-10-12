
use async_trait::async_trait;
use native::domain::telemetry::{SensorData, TelemetryBatch};
use native::infrastructure::db::DatabaseAdapter;
use anyhow::Result;
use std::sync::{Arc, Mutex};

pub struct MockDatabaseAdapter {
    was_called: Arc<Mutex<bool>>,
}

impl MockDatabaseAdapter {
    pub fn new() -> Self {
        Self {
            was_called: Arc::new(Mutex::new(false)),
        }
    }

    pub fn was_called(&self, method: &str) -> bool {
        if method == "store_telemetry" {
            *self.was_called.lock().unwrap()
        } else {
            false
        }
    }
}

#[async_trait]
impl DatabaseAdapter for MockDatabaseAdapter {
    async fn store_telemetry(&self, _data: SensorData) -> Result<()> {
        let mut was_called = self.was_called.lock().unwrap();
        *was_called = true;
        Ok(())
    }

    async fn query_telemetry(&self, _start_time: i64, _end_time: i64) -> Result<TelemetryBatch> {
        Ok(TelemetryBatch {
            id: [0u8; 32],
            data_points: vec![],
            merkle_root: [0u8; 32],
            created_at: 0,
        })
    }
}
