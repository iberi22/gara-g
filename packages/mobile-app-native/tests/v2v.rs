use native::v2v::{V2VMobileState, V2VMobileConfig, V2VMobileManager, ForegroundService};
use native::protocol::{SafetyPacket, ROAD_HAZARD_MASK};
use native::api::{
    init_v2v_mobile, start_v2v_foreground_service,
    process_v2v_received_packet, get_v2v_service_status,
    get_copilot_risk_level, get_next_copilot_alert,
};

#[test]
fn test_duty_cycling_state_transitions() {
    let config = V2VMobileConfig {
        scan_window_ms: 100,
        advertise_window_ms: 50,
        sleep_window_ms: 200,
    };
    let mut manager = V2VMobileManager::new(config);

    // Starts in Scanning
    assert_eq!(manager.state, V2VMobileState::Scanning);

    // Advance within scan window -> remains Scanning
    manager.tick(80);
    assert_eq!(manager.state, V2VMobileState::Scanning);

    // Cross scan window -> transitions to Advertising
    manager.tick(30);
    assert_eq!(manager.state, V2VMobileState::Advertising);

    // Advance within advertise window -> remains Advertising
    manager.tick(20);
    assert_eq!(manager.state, V2VMobileState::Advertising);

    // Cross advertise window -> transitions to Sleeping
    manager.tick(40);
    assert_eq!(manager.state, V2VMobileState::Sleeping);

    // Advance within sleep window -> remains Sleeping
    manager.tick(150);
    assert_eq!(manager.state, V2VMobileState::Sleeping);

    // Cross sleep window -> transitions back to Scanning
    manager.tick(60);
    assert_eq!(manager.state, V2VMobileState::Scanning);
}

#[test]
fn test_foreground_service_lifecycle() {
    let config = V2VMobileConfig {
        scan_window_ms: 100,
        advertise_window_ms: 50,
        sleep_window_ms: 200,
    };
    let mut service = ForegroundService::new("test_service".to_string(), config);

    assert_eq!(service.is_active, false);
    assert_eq!(service.wake_lock_acquired, false);

    service.start_service();
    assert_eq!(service.is_active, true);
    assert_eq!(service.wake_lock_acquired, true);

    service.tick_service(120);
    assert_eq!(service.manager.state, V2VMobileState::Advertising);

    service.stop_service();
    assert_eq!(service.is_active, false);
    assert_eq!(service.wake_lock_acquired, false);
    assert_eq!(service.manager.state, V2VMobileState::Sleeping);
}

#[test]
fn test_hazard_flag_and_copilot_integration() {
    // Initialize V2V mobile service and start it so it is in Scanning state
    init_v2v_mobile(100, 50, 200);
    start_v2v_foreground_service();

    // Verify initial copilot risk is Low (or whatever is current)
    let initial_risk = get_copilot_risk_level();
    println!("Initial copilot risk: {}", initial_risk);

    // Create a normal heartbeat safety packet (no hazard)
    let packet_normal = SafetyPacket::new_heartbeat(12345, 40.4168, -3.7038, 50.0);
    let bytes_normal = packet_normal.to_bytes();

    // Ingest the normal packet
    let processed_normal = process_v2v_received_packet("peer_normal".to_string(), bytes_normal);
    assert!(processed_normal);

    // Create a hazard packet
    let packet_hazard = SafetyPacket::new_hazard(
        67890, 40.4168, -3.7038, ROAD_HAZARD_MASK
    );
    let bytes_hazard = packet_hazard.to_bytes();

    // Ingest the hazard packet
    let processed_hazard = process_v2v_received_packet("peer_hazard".to_string(), bytes_hazard);
    assert!(processed_hazard);

    // Risk level should now be High or Critical due to the hazard flag integration
    let updated_risk = get_copilot_risk_level();
    assert!(updated_risk.contains("High") || updated_risk.contains("Critical"));

    // An alert should have been queued up
    let alert = get_next_copilot_alert();
    assert!(alert.is_some());
    let alert_str = alert.unwrap();
    assert!(alert_str.contains("ROAD HAZARD"));

    // Check status API
    let status_json = get_v2v_service_status();
    assert!(status_json.contains("v2v_foreground_service"));
    assert!(status_json.contains("true")); // is_active
}
