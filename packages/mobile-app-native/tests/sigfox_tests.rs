use native::domain::sigfox::*;

#[test]
fn test_full_sigfox_pipeline() {
    // Register a device
    let mut registry = SigfoxRegistry::new();
    registry.register_device(
        "sigfox-001".into(),
        "vehicle-test-01".into(),
        SigfoxRegion::Rc1,
    );

    // Decode a GPS heartbeat
    let raw_hex = "018000001c80000000000000";
    let uplink = SigfoxDecoder::decode(raw_hex, "sigfox-001", 85, 1)
        .expect("Failed to decode GPS heartbeat");

    assert_eq!(uplink.device_id, "sigfox-001");
    assert_eq!(uplink.signal_quality, 85);
    assert_eq!(uplink.msg_type, SigfoxMessageType::GpsHeartbeat);

    // Record in registry
    registry.record_message("sigfox-001", uplink.msg_type);

    // Verify
    let device = registry.get_device("sigfox-001").unwrap();
    assert_eq!(device.total_messages, 1);

    // Create a downlink GPS request
    let downlink = SigfoxEncoder::request_gps_position("sigfox-001")
        .expect("Failed to encode downlink");
    assert_eq!(downlink, "01");
}

#[test]
fn test_sigfox_emergency_flow() {
    // Simulate an emergency alert from Sigfox
    let raw_hex = "038000001c80000100000000";
    let uplink = SigfoxDecoder::decode(raw_hex, "sigfox-002", 90, 3)
        .expect("Failed to decode emergency alert");

    assert_eq!(uplink.msg_type, SigfoxMessageType::EmergencyAlert);
    if let SigfoxPayload::EmergencyAlert { alert_type, .. } = uplink.data {
        assert_eq!(alert_type, 1); // collision
    }
}

#[test]
fn test_multiple_message_types() {
    let messages = vec![
        ("018000001c80000000000000", SigfoxMessageType::GpsHeartbeat),
        ("0264880196000000000000", SigfoxMessageType::VehicleStatus),
        ("058001000000000000000000", SigfoxMessageType::FuelReport),
        ("070000640000000000000000", SigfoxMessageType::Temperature),
        ("090000000000000000000000", SigfoxMessageType::DailySummary),
    ];

    for (hex, expected_type) in messages {
        let uplink = SigfoxDecoder::decode(hex, "sigfox-multi", 70, 0)
            .unwrap_or_else(|e| panic!("Failed to decode {}: {}", hex, e));
        assert_eq!(uplink.msg_type, expected_type, "Expected {:?} for hex {}", expected_type, hex);
    }
}
