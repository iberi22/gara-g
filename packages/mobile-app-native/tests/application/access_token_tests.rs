#[cfg(test)]
mod tests {
    use crate::domain::access_token::{AccessTokenManager, TokenScope, TokenValidationError};
    use crate::domain::anonymizer::Anonymizer;
    use crate::application::marketplace_use_cases::{
        PrepareDataForSaleUseCase, BuyDataUseCase, ArbitrateDisputeUseCase,
    };
    use crate::domain::telemetry::{TelemetryBatch, SensorData, GeoPoint};
    use std::thread::sleep;
    use std::time::Duration;

    #[test]
    fn test_token_generation_and_validation() {
        let mut manager = AccessTokenManager::new();

        // Generate token with List and Buy scopes, permanent (expires_in_secs = 0)
        let token = manager.generate_token(
            "client_1".to_string(),
            vec![TokenScope::List, TokenScope::Buy],
            0,
            10,
            60,
        );

        assert_eq!(token.client_id, "client_1");
        assert_eq!(token.scopes.len(), 2);
        assert!(token.has_scope(TokenScope::List));
        assert!(token.has_scope(TokenScope::Buy));
        assert!(!token.has_scope(TokenScope::Arbitrate));

        // Validate List scope
        assert_eq!(manager.validate_token(&token.token_id, TokenScope::List), Ok(()));
        // Validate Buy scope
        assert_eq!(manager.validate_token(&token.token_id, TokenScope::Buy), Ok(()));
        // Validate Arbitrate scope should fail
        assert_eq!(
            manager.validate_token(&token.token_id, TokenScope::Arbitrate),
            Err(TokenValidationError::InsufficientScope)
        );
    }

    #[test]
    fn test_token_expiration() {
        let mut manager = AccessTokenManager::new();

        // Generate a token that expires in 1 second
        let token = manager.generate_token(
            "client_1".to_string(),
            vec![TokenScope::List],
            1,
            10,
            60,
        );

        // Immediate validation should succeed
        assert_eq!(manager.validate_token(&token.token_id, TokenScope::List), Ok(()));

        // Wait for 1.1 seconds so the token expires
        sleep(Duration::from_millis(1100));

        // Validation should now return Expired
        assert_eq!(
            manager.validate_token(&token.token_id, TokenScope::List),
            Err(TokenValidationError::Expired)
        );
    }

    #[test]
    fn test_token_revocation() {
        let mut manager = AccessTokenManager::new();

        let token = manager.generate_token(
            "client_1".to_string(),
            vec![TokenScope::Arbitrate],
            0,
            10,
            60,
        );

        assert_eq!(manager.validate_token(&token.token_id, TokenScope::Arbitrate), Ok(()));

        // Revoke the token
        let revoke_res = manager.revoke_token(&token.token_id);
        assert_eq!(revoke_res, Ok(()));

        // Validation should fail with Revoked
        assert_eq!(
            manager.validate_token(&token.token_id, TokenScope::Arbitrate),
            Err(TokenValidationError::Revoked)
        );

        // Revoking a non-existent token should return NotFound
        assert_eq!(manager.revoke_token("invalid_token"), Err(TokenValidationError::NotFound));
    }

    #[test]
    fn test_rate_limiting() {
        let mut manager = AccessTokenManager::new();

        // Limit: Max 2 requests per 1 second window
        let token = manager.generate_token(
            "client_1".to_string(),
            vec![TokenScope::List],
            0,
            2,
            1,
        );

        // First request: Ok
        assert_eq!(manager.check_rate_limit(&token.token_id), Ok(()));
        // Second request: Ok
        assert_eq!(manager.check_rate_limit(&token.token_id), Ok(()));
        // Third request: Exceeded
        assert_eq!(
            manager.check_rate_limit(&token.token_id),
            Err(TokenValidationError::RateLimitExceeded)
        );

        // Wait 1.1 seconds for the window to reset
        sleep(Duration::from_millis(1100));

        // Should succeed again
        assert_eq!(manager.check_rate_limit(&token.token_id), Ok(()));
    }

    #[test]
    fn test_marketplace_use_cases_integration() {
        let mut manager = AccessTokenManager::new();

        let token_list = manager.generate_token(
            "seller_1".to_string(),
            vec![TokenScope::List],
            0,
            100,
            60,
        );

        let token_buy = manager.generate_token(
            "buyer_1".to_string(),
            vec![TokenScope::Buy],
            0,
            100,
            60,
        );

        let token_arbitrate = manager.generate_token(
            "judge_1".to_string(),
            vec![TokenScope::Arbitrate],
            0,
            100,
            60,
        );

        let anonymizer = Anonymizer::default();
        let list_use_case = PrepareDataForSaleUseCase::new(&anonymizer);

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
                }
            ],
            merkle_root: [0u8; 32],
            created_at: 1678886400000,
        };
        let raw_batch = bincode::serialize(&batch).unwrap();

        // 1. PrepareDataForSaleUseCase
        // Should fail with a Buy token (List scope needed)
        let list_fail = list_use_case.execute_with_token(
            raw_batch.clone(),
            &mut manager,
            &token_buy.token_id,
        );
        assert!(list_fail.is_err());

        // Should succeed with a List token
        let list_ok = list_use_case.execute_with_token(
            raw_batch.clone(),
            &mut manager,
            &token_list.token_id,
        ).expect("Execution with token failed");
        assert_eq!(list_ok.record_count, 1);

        // 2. BuyDataUseCase
        let mut buy_use_case = BuyDataUseCase::new(&mut manager);
        // Should fail with a List token
        let buy_fail = buy_use_case.execute(&token_list.token_id, "batch_123");
        assert!(buy_fail.is_err());

        // Should succeed with a Buy token
        let buy_ok = buy_use_case.execute(&token_buy.token_id, "batch_123").expect("Buy use case failed");
        assert!(buy_ok.contains("Successfully bought"));

        // 3. ArbitrateDisputeUseCase
        let mut arbitrate_use_case = ArbitrateDisputeUseCase::new(&mut manager);
        // Should fail with a Buy token
        let arbitrate_fail = arbitrate_use_case.execute(&token_buy.token_id, "dispute_99", "refund");
        assert!(arbitrate_fail.is_err());

        // Should succeed with an Arbitrate token
        let arbitrate_ok = arbitrate_use_case.execute(&token_arbitrate.token_id, "dispute_99", "refund")
            .expect("Arbitration use case failed");
        assert!(arbitrate_ok.contains("resolved: refund"));
    }
}
