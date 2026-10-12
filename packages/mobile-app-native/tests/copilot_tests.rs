use native::application::copilot_use_cases::CopilotEngine;
use native::domain::copilot::{RiskLevel, AlertSeverity};
use native::ai_processor::AnalysisResult;
use native::domain::telemetry::EmergencyEvent;

#[test]
fn test_copilot_risk_escalation() {
    let mut engine = CopilotEngine::new();
    assert_eq!(engine.risk_level, RiskLevel::Low);

    // Minor vision alerts -> Medium risk
    engine.ingest_vision_analysis(AnalysisResult {
        detections: vec![],
        events: vec![],
        alerts: vec!["⚠️ Small pothole".to_string()],
        processing_mode: "local".to_string(),
        dms_status: None,
    });
    engine.process_cycle();
    assert_eq!(engine.risk_level, RiskLevel::Medium);

    // Theft detection -> High risk
    engine.ingest_telemetry_event(EmergencyEvent::TheftDetected { movement: 1.0 });
    engine.process_cycle();
    assert_eq!(engine.risk_level, RiskLevel::High);

    // Crash detection -> Critical risk
    engine.ingest_telemetry_event(EmergencyEvent::CrashDetected { g_force: 15.0 });
    engine.process_cycle();
    assert_eq!(engine.risk_level, RiskLevel::Critical);
}

#[test]
fn test_voice_agent_stt_transcription() {
    let agent = native::application::copilot_use_cases::GarageVoiceAgent::new();

    // Check with direct UTF-8 string bytes
    let res = agent.speech_to_text(b"how is my vehicle status today?").unwrap();
    assert_eq!(res, "how is my vehicle status today?");

    // Check with length fallback (length modulo 3 == 0)
    let fallback_status = agent.speech_to_text(&[1, 2, 3]).unwrap();
    assert_eq!(fallback_status, "status");

    // Check with empty bytes returning error
    let err = agent.speech_to_text(&[]);
    assert!(err.is_err());
}

#[test]
fn test_voice_agent_intent_routing() {
    let agent = native::application::copilot_use_cases::GarageVoiceAgent::new();

    let status_intent = agent.route_intent("please get status of my vehicle");
    assert_eq!(status_intent, native::application::copilot_use_cases::VoiceIntent::GetStatus);

    let alerts_intent = agent.route_intent("show warnings or alerts");
    assert_eq!(alerts_intent, native::application::copilot_use_cases::VoiceIntent::GetAlerts);

    let diagnostics_intent = agent.route_intent("run diagnostics check");
    assert_eq!(diagnostics_intent, native::application::copilot_use_cases::VoiceIntent::GetDiagnostics);

    let unknown_intent = agent.route_intent("play some music");
    assert_eq!(unknown_intent, native::application::copilot_use_cases::VoiceIntent::Unknown);
}

#[test]
fn test_voice_agent_full_loop() {
    let agent = native::application::copilot_use_cases::GarageVoiceAgent::new();

    // Loop with "status" query
    let status_response = agent.process_voice_agent_loop(b"check status").unwrap();
    assert!(status_response.contains("GetStatus"));
    assert!(status_response.contains("nominal"));

    // Loop with "alerts" query
    let alerts_response = agent.process_voice_agent_loop(b"show alerts").unwrap();
    assert!(alerts_response.contains("GetAlerts"));
    assert!(alerts_response.contains("no active"));

    // Loop with "diagnostics" query
    let diagnostics_response = agent.process_voice_agent_loop(b"diagnostics").unwrap();
    assert!(diagnostics_response.contains("GetDiagnostics"));
    assert!(diagnostics_response.contains("stable"));
}

#[test]
fn test_copilot_alert_prioritization() {
    let mut engine = CopilotEngine::new();

    // Ingest a warning and an emergency
    engine.ingest_vision_analysis(AnalysisResult {
        detections: vec![],
        events: vec![],
        alerts: vec!["⚠️ Warning".to_string(), "🚨 Emergency".to_string()],
        processing_mode: "local".to_string(),
        dms_status: None,
    });

    engine.process_cycle();

    // First alert should be the emergency
    let first = engine.get_next_alert().unwrap();
    assert_eq!(first.severity, AlertSeverity::Emergency);

    // Second should be the warning
    let second = engine.get_next_alert().unwrap();
    assert_eq!(second.severity, AlertSeverity::Warning);
}

#[test]
fn test_copilot_dms_drowsiness() {
    let mut engine = CopilotEngine::new();
    assert_eq!(engine.risk_level, RiskLevel::Low);

    // Ingest a drowsy driver status via DMS
    engine.ingest_vision_analysis(AnalysisResult {
        detections: vec![],
        events: vec![],
        alerts: vec![],
        processing_mode: "dms_engine".to_string(),
        dms_status: Some(native::domain::dms::DmsAnalysis {
            ear_left: 0.1,
            ear_right: 0.1,
            mar: 0.1,
            drowsiness_score: 0.9,
            yawning_score: 0.1,
            head_pose: native::domain::dms::HeadPose { pitch: 0.0, yaw: 0.0, roll: 0.0 },
            is_distracted: false,
            is_drowsy: true,
            is_yawning: false,
            seatbelt_state: native::domain::seatbelt::SeatbeltState::Buckled,
        }),
    });

    engine.process_cycle();
    assert_eq!(engine.risk_level, RiskLevel::High);
}

#[test]
fn test_copilot_dms_seatbelt() {
    let mut engine = CopilotEngine::new();
    assert_eq!(engine.risk_level, RiskLevel::Low);

    // Ingest an unbuckled seatbelt status via DMS
    engine.ingest_vision_analysis(AnalysisResult {
        detections: vec![],
        events: vec![],
        alerts: vec![],
        processing_mode: "dms_engine".to_string(),
        dms_status: Some(native::domain::dms::DmsAnalysis {
            ear_left: 0.3,
            ear_right: 0.3,
            mar: 0.1,
            drowsiness_score: 0.1,
            yawning_score: 0.1,
            head_pose: native::domain::dms::HeadPose { pitch: 0.0, yaw: 0.0, roll: 0.0 },
            is_distracted: false,
            is_drowsy: false,
            is_yawning: false,
            seatbelt_state: native::domain::seatbelt::SeatbeltState::Unbuckled,
        }),
    });

    engine.process_cycle();
    assert_eq!(engine.risk_level, RiskLevel::High);
}

#[test]
fn test_copilot_dms_critical() {
    let mut engine = CopilotEngine::new();
    assert_eq!(engine.risk_level, RiskLevel::Low);

    // Ingest a simultaneously drowsy and distracted driver status
    engine.ingest_vision_analysis(AnalysisResult {
        detections: vec![],
        events: vec![],
        alerts: vec![],
        processing_mode: "dms_engine".to_string(),
        dms_status: Some(native::domain::dms::DmsAnalysis {
            ear_left: 0.1,
            ear_right: 0.1,
            mar: 0.1,
            drowsiness_score: 0.9,
            yawning_score: 0.1,
            head_pose: native::domain::dms::HeadPose { pitch: 25.0, yaw: 35.0, roll: 0.0 },
            is_distracted: true,
            is_drowsy: true,
            is_yawning: false,
            seatbelt_state: native::domain::seatbelt::SeatbeltState::Buckled,
        }),
    });

    engine.process_cycle();
    assert_eq!(engine.risk_level, RiskLevel::Critical);
}
