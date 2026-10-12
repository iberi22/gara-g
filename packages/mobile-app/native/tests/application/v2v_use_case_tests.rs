#[cfg(test)]
mod tests {
    use native::application::v2v_use_cases::{BroadcastSafetyMessageUseCase, ProcessReceivedMessageUseCase};
    use native::domain::v2v::{V2VWallet, Position, V2VMessageType};
    use native::protocol::SafetyPacket;

    #[test]
    fn test_broadcast_safety_message_success() {
        let wallet = V2VWallet::new("TestDevice".to_string());
        let use_case = BroadcastSafetyMessageUseCase::new(&wallet);

        let position = Position {
            latitude: 40.4168,
            longitude: -3.7038,
            accuracy: 5.0,
            speed: Some(13.8),
            heading: Some(90.0),
            timestamp: chrono::Utc::now().timestamp_millis(),
        };

        // 0x01 is Emergency in BroadcastSafetyMessageUseCase
        let result = use_case.execute(0x01, Some(position)).expect("Broadcast failed");

        assert_eq!(result.msg_type, V2VMessageType::Emergency);
        assert_eq!(result.sender_id, wallet.public_key);
        assert!(result.verify().unwrap());
    }

    #[test]
    fn test_process_received_message_success() {
        let wallet = V2VWallet::new("SenderDevice".to_string());
        let use_case = ProcessReceivedMessageUseCase;

        let msg = wallet.sign_message(
            V2VMessageType::Text,
            "Hello Mesh".to_string(),
            None,
        );

        let result = use_case.execute(msg).expect("Process failed");
        assert!(result.is_some());
        let processed = result.unwrap();
        assert_eq!(processed.sender_id, wallet.public_key);
    }

    #[test]
    fn test_process_received_message_stale() {
        let wallet = V2VWallet::new("SenderDevice".to_string());
        let use_case = ProcessReceivedMessageUseCase;

        let mut msg = wallet.sign_message(
            V2VMessageType::Text,
            "Old message".to_string(),
            None,
        );

        // Manually set an old timestamp (more than 30 seconds ago)
        msg.timestamp = chrono::Utc::now().timestamp_millis() - 40000;

        // Freshness check should fail
        let result = use_case.execute(msg).expect("Process failed");
        assert!(result.is_none());
    }

    #[test]
    fn test_mesh_routing_logic() {
        // Testing the mesh routing logic from protocol::SafetyPacket used in V2V context
        let pkt = SafetyPacket::new_heartbeat(12345, 40.4168, -3.7038, 50.0);

        assert!(pkt.can_forward());
        assert_eq!(pkt.hop_count, 0);

        let fwd = pkt.forwarded();
        assert_eq!(fwd.hop_count, 1);
        assert!(fwd.can_forward());
    }
}
