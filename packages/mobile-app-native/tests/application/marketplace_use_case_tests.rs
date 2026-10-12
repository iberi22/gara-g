#[cfg(test)]
mod tests {
    use native::application::marketplace_use_cases::{PrepareDataForSaleUseCase, MarketplaceManager};
    use native::domain::anonymizer::Anonymizer;
    use native::domain::telemetry::{TelemetryBatch, SensorData, GeoPoint};
    use native::domain::marketplace::{TransactionStatus, DisputeResolution};

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

    #[test]
    fn test_producer_create_listing() {
        let mut manager = MarketplaceManager::new();
        let producer = "producer_1".to_string();

        let listing = manager.create_listing(
            producer.clone(),
            150,
            40.4168,
            -3.7038,
            "telemetry".to_string(),
            "Madrid downtown telemetry data".to_string(),
        ).expect("Failed to create listing");

        assert_eq!(listing.producer_id, producer);
        assert_eq!(listing.price_gara, 150);
        assert_eq!(listing.latitude, 40.4168);
        assert_eq!(listing.longitude, -3.7038);
        assert_eq!(listing.category, "telemetry");
        assert_eq!(listing.description, "Madrid downtown telemetry data");

        // Verify the listing is saved in the state
        assert!(manager.listings.contains_key(&listing.listing_id));

        // Verify producer reputation is initialized to 100
        let rep = manager.reputations.get(&producer).expect("Reputation not found");
        assert_eq!(rep.score, 100);
        assert_eq!(rep.successful_sales, 0);
    }

    #[test]
    fn test_consumer_discover_listings() {
        let mut manager = MarketplaceManager::new();

        // Listing 1: Madrid, category "telemetry"
        manager.create_listing(
            "prod_1".to_string(),
            100,
            40.4168,
            -3.7038,
            "telemetry".to_string(),
            "Madrid telemetry".to_string(),
        ).unwrap();

        // Listing 2: Barcelona, category "diagnostics"
        manager.create_listing(
            "prod_2".to_string(),
            200,
            41.3851,
            2.1734,
            "diagnostics".to_string(),
            "Barcelona diagnostics".to_string(),
        ).unwrap();

        // 1. Search all (no filters)
        let all = manager.discover_listings(None, None, None, None);
        assert_eq!(all.len(), 2);

        // 2. Search by category
        let telemetry_listings = manager.discover_listings(Some("telemetry".to_string()), None, None, None);
        assert_eq!(telemetry_listings.len(), 1);
        assert_eq!(telemetry_listings[0].producer_id, "prod_1");

        // 3. Search by proximity: Madrid location (40.4168, -3.7038), max 50km
        // Madrid to Barcelona is ~500km, so it should filter Barcelona out.
        let madrid_coords = Some(40.4168);
        let madrid_lon = Some(-3.7038);
        let nearby = manager.discover_listings(None, madrid_coords, madrid_lon, Some(50000.0));
        assert_eq!(nearby.len(), 1);
        assert_eq!(nearby[0].producer_id, "prod_1");

        // 4. Search by proximity: Madrid location, max 600km, sorted by proximity (Madrid should be first)
        let sorted = manager.discover_listings(None, madrid_coords, madrid_lon, Some(600000.0));
        assert_eq!(sorted.len(), 2);
        assert_eq!(sorted[0].producer_id, "prod_1");
        assert_eq!(sorted[1].producer_id, "prod_2");
    }

    #[test]
    fn test_successful_transaction_flow() {
        let mut manager = MarketplaceManager::new();
        let producer = "producer_1".to_string();
        let consumer = "consumer_1".to_string();

        // Create listing
        let listing = manager.create_listing(
            producer.clone(),
            100,
            40.4168,
            -3.7038,
            "telemetry".to_string(),
            "Madrid telemetry".to_string(),
        ).unwrap();

        // 1. Request transaction
        let tx = manager.request_transaction(listing.listing_id.clone(), consumer.clone()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Requested);
        assert_eq!(tx.consumer_id, consumer);
        assert_eq!(tx.producer_id, producer);
        assert_eq!(tx.price_gara, 100);

        // 2. Accept transaction
        let tx = manager.accept_transaction(tx.transaction_id.clone(), producer.clone()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Accepted);

        // 3. Pay transaction
        let tx = manager.pay_transaction(tx.transaction_id.clone(), consumer.clone()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Paid);

        // 4. Deliver transaction
        let data_payload = "Encrypted_Madrid_Telemetry_Data_12345".to_string();
        let tx = manager.deliver_transaction(tx.transaction_id.clone(), producer.clone(), data_payload.clone()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Delivered);
        assert_eq!(tx.data_payload, Some(data_payload));

        // 5. Confirm transaction
        let tx = manager.confirm_transaction(tx.transaction_id.clone(), consumer.clone()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Confirmed);

        // Verify producer reputation and sales increased
        let rep = manager.reputations.get(&producer).unwrap();
        assert_eq!(rep.score, 110); // 100 + 10 = 110
        assert_eq!(rep.successful_sales, 1);
    }

    #[test]
    fn test_dispute_resolution_refund_consumer() {
        let mut manager = MarketplaceManager::new();
        let producer = "producer_1".to_string();
        let consumer = "consumer_1".to_string();

        let listing = manager.create_listing(
            producer.clone(),
            100,
            40.4168,
            -3.7038,
            "telemetry".to_string(),
            "Madrid telemetry".to_string(),
        ).unwrap();

        let tx = manager.request_transaction(listing.listing_id.clone(), consumer.clone()).unwrap();
        let tx = manager.accept_transaction(tx.transaction_id.clone(), producer.clone()).unwrap();
        let tx = manager.pay_transaction(tx.transaction_id.clone(), consumer.clone()).unwrap();
        let tx = manager.deliver_transaction(tx.transaction_id.clone(), producer.clone(), "corrupt_data".to_string()).unwrap();

        // 1. Flag dispute (Consumer files dispute)
        let tx = manager.flag_dispute(tx.transaction_id.clone(), consumer.clone()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Disputed);

        // Initial consumer rep drop from starting a dispute is -5, so 100 - 5 = 95
        assert_eq!(manager.reputations.get(&consumer).unwrap().score, 95);

        // 2. Resolve dispute as RefundConsumer
        let tx = manager.resolve_dispute(tx.transaction_id.clone(), DisputeResolution::RefundConsumer, "arbiter_1".to_string()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Resolved);
        assert_eq!(tx.data_payload, None); // Cleared/refunded payload

        // Producer gets severe penalty (-50 score)
        let prod_rep = manager.reputations.get(&producer).unwrap();
        assert_eq!(prod_rep.score, 50); // 100 - 50 = 50

        // Consumer gets restored (+5 score)
        let cons_rep = manager.reputations.get(&consumer).unwrap();
        assert_eq!(cons_rep.score, 100); // 95 + 5 = 100
    }

    #[test]
    fn test_dispute_resolution_release_to_producer() {
        let mut manager = MarketplaceManager::new();
        let producer = "producer_1".to_string();
        let consumer = "consumer_1".to_string();

        let listing = manager.create_listing(
            producer.clone(),
            100,
            40.4168,
            -3.7038,
            "telemetry".to_string(),
            "Madrid telemetry".to_string(),
        ).unwrap();

        let tx = manager.request_transaction(listing.listing_id.clone(), consumer.clone()).unwrap();
        let tx = manager.accept_transaction(tx.transaction_id.clone(), producer.clone()).unwrap();
        let tx = manager.pay_transaction(tx.transaction_id.clone(), consumer.clone()).unwrap();
        let tx = manager.deliver_transaction(tx.transaction_id.clone(), producer.clone(), "perfect_data".to_string()).unwrap();

        // 1. Flag dispute (Consumer files bad/false dispute)
        let tx = manager.flag_dispute(tx.transaction_id.clone(), consumer.clone()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Disputed);

        // 2. Resolve dispute as ReleaseToProducer
        let tx = manager.resolve_dispute(tx.transaction_id.clone(), DisputeResolution::ReleaseToProducer, "arbiter_1".to_string()).unwrap();
        assert_eq!(tx.status, TransactionStatus::Resolved);
        assert_eq!(tx.data_payload, Some("perfect_data".to_string()));

        // Producer is rewarded with payment release (+10 reputation, successful sale)
        let prod_rep = manager.reputations.get(&producer).unwrap();
        assert_eq!(prod_rep.score, 110);
        assert_eq!(prod_rep.successful_sales, 1);

        // Consumer is penalized (-15 reputation) for false dispute
        let cons_rep = manager.reputations.get(&consumer).unwrap();
        assert_eq!(cons_rep.score, 80); // 100 (initial) - 5 (flag) - 15 (resolution) = 80
    }
}
