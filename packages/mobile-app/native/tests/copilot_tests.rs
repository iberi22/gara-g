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
