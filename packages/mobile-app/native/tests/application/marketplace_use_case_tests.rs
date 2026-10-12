#[cfg(test)]
mod tests {
    use native::application::marketplace_use_cases::PrepareDataForSaleUseCase;
    use native::domain::anonymizer::Anonymizer;
    use native::domain::telemetry::{TelemetryBatch, SensorData, GeoPoint};

    #[test]
    fn test_prepare_data_for_sale_success() {
        let anonymizer = Anonymizer::default();
        let use_case = PrepareDataForSaleUseCase::new(&anonymizer);

        let batch = TelemetryBatch {
            id: [1u8; 32],
            data_points: vec![
                SensorData {
                    timestamp: 1678886400000,
                    vehicle_id: [0u8; 32],
                    speed: 50.0,
                    rpm: 2000,
                    fuel_level: 0.5,
                    location: Some(GeoPoint { lat: 40.4168, lon: -3.7038, accuracy: 10.0 }),
                    obd_codes: vec![],
                    accelerometer: None,
                    gyroscope: None,
                },
                SensorData {
                    timestamp: 1678886460000,
                    vehicle_id: [0u8; 32],
                    speed: 55.0,
                    rpm: 2200,
                    fuel_level: 0.49,
                    location: Some(GeoPoint { lat: 40.4170, lon: -3.7040, accuracy: 10.0 }),
                    obd_codes: vec![],
                    accelerometer: None,
                    gyroscope: None,
                }
            ],
            merkle_root: [0u8; 32],
            created_at: 1678886400000,
        };

        let raw_batch = bincode::serialize(&batch).unwrap();
        let result = use_case.execute(raw_batch).expect("UseCase execution failed");

        assert_eq!(result.record_count, 2);
        assert_eq!(result.price_gara, 20); // 10 GARA per record
        assert_ne!(result.data_hash, [0u8; 32]);
    }

    #[test]
    fn test_prepare_data_for_sale_empty_batch() {
        let anonymizer = Anonymizer::default();
        let use_case = PrepareDataForSaleUseCase::new(&anonymizer);

        let batch = TelemetryBatch {
            id: [2u8; 32],
            data_points: vec![],
            merkle_root: [0u8; 32],
            created_at: 1678886400000,
        };

        let raw_batch = bincode::serialize(&batch).unwrap();
        let result = use_case.execute(raw_batch).expect("UseCase execution failed");

        assert_eq!(result.record_count, 0);
        assert_eq!(result.price_gara, 0);
    }

    #[test]
    fn test_prepare_data_for_sale_invalid_data() {
        let anonymizer = Anonymizer::default();
        let use_case = PrepareDataForSaleUseCase::new(&anonymizer);

        let invalid_raw_data = vec![0, 1, 2, 3];
        let result = use_case.execute(invalid_raw_data);

        assert!(result.is_err());
    }
}
