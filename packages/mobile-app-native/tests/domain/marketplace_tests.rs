#[cfg(test)]
mod tests {
    use native::domain::marketplace::{AnonymizedBatch, AnonymizedDataPoint, ParticipantReputation};
    use native::domain::telemetry::{RoadType, WeatherConditions};

    #[test]
    fn test_anonymized_batch_serialization() {
        let batch = AnonymizedBatch {
            batch_id: "test-batch-123".to_string(),
            data_points: vec![
                AnonymizedDataPoint {
                    timestamp: 1678886400000,
                    fuzzed_h3_index: "8828308281fffff".to_string(),
                    road_type: RoadType::Urban,
                    weather: WeatherConditions::Clear,
                }
            ],
            h3_resolution: 8,
            data_hash: [0u8; 32],
            record_count: 1,
            price_gara: 10,
            merkle_proof: vec![[0u8; 32]],
            time_range: (1678886400000, 1678886400000),
        };

        let serialized = bincode::serialize(&batch).expect("Failed to serialize");
        let deserialized: AnonymizedBatch = bincode::deserialize(&serialized).expect("Failed to deserialize");

        assert_eq!(deserialized.batch_id, batch.batch_id);
        assert_eq!(deserialized.record_count, batch.record_count);
        assert_eq!(deserialized.price_gara, batch.price_gara);
        assert_eq!(deserialized.data_points.len(), 1);
    }

    #[test]
    fn test_participant_reputation_initialization() {
        let participant_id = "user-789".to_string();
        let rep = ParticipantReputation::new(participant_id.clone());

        assert_eq!(rep.participant_id, participant_id);
        assert_eq!(rep.score, 100);
        assert_eq!(rep.successful_sales, 0);
    }

    #[test]
    fn test_participant_reputation_update() {
        let mut rep = ParticipantReputation::new("user-789".to_string());

        // Positive update
        rep.update_score(50);
        assert_eq!(rep.score, 150);

        // Negative update
        rep.update_score(-200);
        assert_eq!(rep.score, 0); // Should be clamped at 0

        // Large update
        rep.update_score(20000);
        assert_eq!(rep.score, 10000); // Should be clamped at 10000
    }

    #[test]
    fn test_anonymized_data_point_enum_consistency() {
        let dp = AnonymizedDataPoint {
            timestamp: 12345,
            fuzzed_h3_index: "h3".to_string(),
            road_type: RoadType::Highway,
            weather: WeatherConditions::Rain,
        };

        assert_eq!(dp.road_type, RoadType::Highway);
        assert_eq!(dp.weather, WeatherConditions::Rain);
    }
}
