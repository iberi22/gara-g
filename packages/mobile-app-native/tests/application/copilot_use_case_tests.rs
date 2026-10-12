use native::application::copilot_use_cases::{AlertQueue, CopilotEngine, GarageVoiceAgent, VoiceIntent};
use native::domain::copilot::{Alert, AlertSeverity, RiskLevel};
use native::ai_processor::AnalysisResult;
use native::domain::telemetry::EmergencyEvent;

#[test]
fn test_alert_queue_push_pop_peek_order_clear() {
    let mut queue = AlertQueue::new();
    assert!(queue.is_empty());
    assert!(queue.peek().is_none());

    let info_alert = Alert {
        id: "alert_info_1".to_string(),
        severity: AlertSeverity::Info,
        message: "Info message".to_string(),
        source: "System".to_string(),
        timestamp: 1000,
    };

    let warning_alert = Alert {
        id: "alert_warning_1".to_string(),
        severity: AlertSeverity::Warning,
        message: "Warning message".to_string(),
        source: "Vision".to_string(),
        timestamp: 1001,
    };

    let emergency_alert = Alert {
        id: "alert_emergency_1".to_string(),
        severity: AlertSeverity::Emergency,
        message: "Emergency message".to_string(),
        source: "Telemetry".to_string(),
        timestamp: 1002,
    };

    // Push in mixed order
    queue.push(info_alert);
    queue.push(emergency_alert.clone());
    queue.push(warning_alert);

    assert!(!queue.is_empty());

    // Peek should reveal the highest priority alert (Emergency) without removing it
    let peeked = queue.peek().expect("Expected peek to return an alert");
    assert_eq!(peeked.severity, AlertSeverity::Emergency);
    assert_eq!(peeked.id, "alert_emergency_1");

    // Pop order should be Emergency -> Warning -> Info
    let first_popped = queue.pop().expect("Expected emergency alert");
    assert_eq!(first_popped.severity, AlertSeverity::Emergency);

    let second_popped = queue.pop().expect("Expected warning alert");
    assert_eq!(second_popped.severity, AlertSeverity::Warning);

    // Verify clear empties the queue
    queue.clear();
    assert!(queue.is_empty());
    assert!(queue.pop().is_none());
}

#[test]
fn test_copilot_engine_process_cycle_prioritized_alert() {
    let mut engine = CopilotEngine::new();

    // Ingest both a warning vision alert and an emergency telemetry event
    engine.ingest_vision_analysis(AnalysisResult {
        detections: vec![],
        events: vec![],
        alerts: vec!["⚠️ Slow vehicle ahead".to_string()],
        processing_mode: "local".to_string(),
        dms_status: None,
    });

    engine.ingest_telemetry_event(EmergencyEvent::CrashDetected { g_force: 12.5 });

    engine.process_cycle();

    // Verify inputs were consumed and cleared
    assert!(engine.last_vision_analysis.is_none());
    assert!(engine.last_telemetry_event.is_none());

    // Highest severity alert (Emergency crash) should be popped first
    let alert1 = engine.get_next_alert().expect("Expected crash emergency alert");
    assert_eq!(alert1.severity, AlertSeverity::Emergency);
    assert!(alert1.message.contains("Impact detected"));

    // Next alert should be the warning vision alert
    let alert2 = engine.get_next_alert().expect("Expected vision warning alert");
    assert_eq!(alert2.severity, AlertSeverity::Warning);
    assert!(alert2.message.contains("Slow vehicle ahead"));
}

#[test]
fn test_ingest_vision_and_telemetry_events() {
    let mut engine = CopilotEngine::new();
    assert_eq!(engine.risk_level, RiskLevel::Low);

    // Ingest vision analysis with emergency icon
    engine.ingest_vision_analysis(AnalysisResult {
        detections: vec![],
        events: vec![],
        alerts: vec!["🚨 Pedestrian in path".to_string()],
        processing_mode: "ai_processor".to_string(),
        dms_status: None,
    });

    engine.update_risk_assessment();
    assert_eq!(engine.risk_level, RiskLevel::High);

    // Ingest theft telemetry event
    engine.ingest_telemetry_event(EmergencyEvent::TheftDetected { movement: 2.5 });
    engine.update_risk_assessment();
    assert_eq!(engine.risk_level, RiskLevel::High);

    // Process cycle pushes alerts to queue
    engine.process_cycle();
    assert!(!engine.alert_queue.is_empty());
}

#[test]
fn test_ingest_v2v_hazard_raises_priority() {
    let mut engine = CopilotEngine::new();
    assert_eq!(engine.risk_level, RiskLevel::Low);

    // Ingest V2V hazard flag
    engine.ingest_v2v_hazard(true);
    assert!(engine.hazard_flag);

    engine.process_cycle();

    // Risk level should elevate to High
    assert_eq!(engine.risk_level, RiskLevel::High);

    // V2V hazard alert should be generated with Emergency severity
    let alert = engine.get_next_alert().expect("Expected V2V hazard alert");
    assert_eq!(alert.source, "V2VMeshAgent");
    assert_eq!(alert.severity, AlertSeverity::Emergency);
    assert!(alert.message.contains("V2V ROAD HAZARD DETECTED AHEAD"));

    // Reset hazard flag
    engine.ingest_v2v_hazard(false);
    assert!(!engine.hazard_flag);
}

#[test]
fn test_garage_voice_agent_route_intent() {
    let agent = GarageVoiceAgent::new();

    // Utterance with "status"
    assert_eq!(agent.route_intent("What is the current vehicle status?"), VoiceIntent::GetStatus);

    // Utterances with "alert" or "warning"
    assert_eq!(agent.route_intent("Do I have any active alerts?"), VoiceIntent::GetAlerts);
    assert_eq!(agent.route_intent("Show me any warning notifications"), VoiceIntent::GetAlerts);

    // Utterances with "diagnostic" or "check"
    assert_eq!(agent.route_intent("Run a diagnostic scan"), VoiceIntent::GetDiagnostics);
    assert_eq!(agent.route_intent("Check system health"), VoiceIntent::GetDiagnostics);

    // Utterances for unsupported commands or lights/doors
    assert_eq!(agent.route_intent("Open garage door"), VoiceIntent::Unknown);
    assert_eq!(agent.route_intent("Close windows"), VoiceIntent::Unknown);
    assert_eq!(agent.route_intent("Turn on headlights"), VoiceIntent::Unknown);
}

#[test]
fn test_garage_voice_agent_speech_to_text_and_error_path() {
    let agent = GarageVoiceAgent::new();

    // Empty audio data should return Err
    let empty_result = agent.speech_to_text(&[]);
    assert!(empty_result.is_err());
    let err_msg = empty_result.unwrap_err();
    assert!(err_msg.contains("STT processing error: empty audio data"));

    // Valid ASCII utterance audio data
    let valid_text = agent.speech_to_text(b"status check").unwrap();
    assert_eq!(valid_text, "status check");

    // Binary / non-UTF8 garbage audio length fallback checks
    // len = 3 -> % 3 == 0 -> "status"
    let status_fallback = agent.speech_to_text(&[0xFF, 0xFE, 0xFD]).unwrap();
    assert_eq!(status_fallback, "status");

    // len = 4 -> % 3 == 1 -> "alerts"
    let alerts_fallback = agent.speech_to_text(&[0xFF, 0xFE, 0xFD, 0xFC]).unwrap();
    assert_eq!(alerts_fallback, "alerts");

    // len = 5 -> % 3 == 2 -> "diagnostics"
    let diagnostics_fallback = agent.speech_to_text(&[0xFF, 0xFE, 0xFD, 0xFC, 0xFB]).unwrap();
    assert_eq!(diagnostics_fallback, "diagnostics");
}

#[test]
fn test_garage_voice_agent_full_loop_responses() {
    let agent = GarageVoiceAgent::new();

    // Loop with status audio
    let status_res = agent.process_voice_agent_loop(b"check status").unwrap();
    assert!(status_res.contains("GetStatus"));
    assert!(status_res.contains("All systems are nominal"));

    // Loop with alert audio
    let alerts_res = agent.process_voice_agent_loop(b"show alerts").unwrap();
    assert!(alerts_res.contains("GetAlerts"));
    assert!(alerts_res.contains("no active high-severity alerts"));

    // Loop with unknown command audio
    let unknown_res = agent.process_voice_agent_loop(b"open headlights").unwrap();
    assert!(unknown_res.contains("Unknown"));
    assert!(unknown_res.contains("not sure how to assist"));
}
