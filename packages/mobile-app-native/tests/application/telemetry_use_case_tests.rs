use native::application::telemetry_use_cases::RecordTelemetryUseCase;
use native::domain::telemetry::{GeoPoint, SensorData, AccelerometerData};
use crate::mocks::database_adapter::MockDatabaseAdapter;
use crate::mocks::event_bus::MockEventBus;

fn valid_sensor_data() -> SensorData {
    SensorData {
        timestamp: 1706000000,
        vehicle_id: [0u8; 32],
        speed: 60.0,
        rpm: 3000,
        fuel_level: 0.75,
        location: Some(GeoPoint { lat: 37.7749, lon: -122.4194, accuracy: 5.0 }),
        obd_codes: vec![],
        accelerometer: Some(AccelerometerData { x: 0.0, y: 0.0, z: 9.81 }),
        gyroscope: None,
    }
}

#[tokio::test]
async fn test_record_telemetry_success() {
    let mock_db = MockDatabaseAdapter::new();
    let mock_bus = MockEventBus::new();

    let use_case = RecordTelemetryUseCase::new(&mock_db, &mock_bus);
    let data = valid_sensor_data();

    let result = use_case.execute(data).await;
    assert!(result.is_ok());
    assert!(mock_db.was_called("store_telemetry"));
    assert!(mock_bus.was_emitted("TelemetryRecorded"));
}
