
use native::domain::telemetry::{GeoPoint, SensorData, ValidationError};

#[test]
fn test_sensor_data_validation_valid() {
    let data = SensorData {
        timestamp: 1706000000,
        vehicle_id: [0u8; 32],
        speed: 60.0,
        rpm: 3000,
        fuel_level: 0.75,
        location: Some(GeoPoint { lat: 37.7749, lon: -122.4194, accuracy: 5.0 }),
        obd_codes: vec![],
        accelerometer: None,
        gyroscope: None,
    };
    assert!(data.validate().is_ok());
}

#[test]
fn test_sensor_data_validation_invalid_speed() {
    let data = SensorData {
        timestamp: 1706000000,
        vehicle_id: [0u8; 32],
        speed: 600.0,
        rpm: 3000,
        fuel_level: 0.75,
        location: Some(GeoPoint { lat: 37.7749, lon: -122.4194, accuracy: 5.0 }),
        obd_codes: vec![],
        accelerometer: None,
        gyroscope: None,
    };
    assert!(matches!(data.validate(), Err(ValidationError::InvalidSpeed)));
}
