//! Use cases and application logic for the Copilot Engine

use crate::domain::copilot::{Alert, AlertSeverity, RiskLevel};
use crate::ai_processor::AnalysisResult;
use crate::domain::telemetry::EmergencyEvent;
use std::collections::BinaryHeap;
use std::cmp::Ordering;
use chrono::Utc;

/// Priority-based Alert Queue
#[derive(Debug, Default)]
pub struct AlertQueue {
    queue: BinaryHeap<PrioritizedAlert>,
}

#[derive(Debug, PartialEq, Eq)]
struct PrioritizedAlert {
    alert: Alert,
}

impl Ord for PrioritizedAlert {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher severity comes first. If same severity, newer timestamp comes first.
        self.alert.severity.cmp(&other.alert.severity)
            .then_with(|| self.alert.timestamp.cmp(&other.alert.timestamp))
    }
}

impl PartialOrd for PrioritizedAlert {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl AlertQueue {
    pub fn new() -> Self {
        Self {
            queue: BinaryHeap::new(),
        }
    }

    pub fn push(&mut self, alert: Alert) {
        self.queue.push(PrioritizedAlert { alert });
    }

    pub fn pop(&mut self) -> Option<Alert> {
        self.queue.pop().map(|pa| pa.alert)
    }

    pub fn peek(&self) -> Option<&Alert> {
        self.queue.peek().map(|pa| &pa.alert)
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn clear(&mut self) {
        self.queue.clear();
    }
}

/// Core Copilot Engine for risk assessment and agent orchestration
pub struct CopilotEngine {
    pub risk_level: RiskLevel,
    pub alert_queue: AlertQueue,
    pub last_vision_analysis: Option<AnalysisResult>,
    pub last_telemetry_event: Option<EmergencyEvent>,
    pub hazard_flag: bool,
}

impl CopilotEngine {
    pub fn new() -> Self {
        Self {
            risk_level: RiskLevel::Low,
            alert_queue: AlertQueue::new(),
            last_vision_analysis: None,
            last_telemetry_event: None,
            hazard_flag: false,
        }
    }

    /// Fuses AI detections, telemetry, and Driver Monitoring System (DMS) status to update risk level
    pub fn update_risk_assessment(&mut self) {
        let mut new_risk = RiskLevel::Low;

        // Check vision analysis and driver-monitoring status
        if let Some(vision) = &self.last_vision_analysis {
            if !vision.alerts.is_empty() {
                new_risk = RiskLevel::Medium;

                // If many detections or serious alerts
                if vision.detections.len() > 5 || vision.alerts.iter().any(|a: &String| a.contains("🚨")) {
                    new_risk = RiskLevel::High;
                }
            }

            // Explicitly handle Driver Monitoring System (DMS) status
            if let Some(dms) = &vision.dms_status {
                if dms.is_drowsy && dms.is_distracted {
                    new_risk = RiskLevel::Critical;
                } else if dms.is_drowsy {
                    if new_risk < RiskLevel::High {
                        new_risk = RiskLevel::High;
                    }
                } else if dms.is_distracted || dms.is_yawning {
                    if new_risk < RiskLevel::Medium {
                        new_risk = RiskLevel::Medium;
                    }
                }

                if dms.seatbelt_state == crate::domain::seatbelt::SeatbeltState::Unbuckled {
                    if new_risk == RiskLevel::High {
                        new_risk = RiskLevel::Critical;
                    } else if new_risk < RiskLevel::High {
                        new_risk = RiskLevel::High;
                    }
                }
            }
        }

        // Check telemetry (takes precedence for immediate physical threats)
        if let Some(telemetry) = &self.last_telemetry_event {
            match telemetry {
                EmergencyEvent::CrashDetected { .. } => {
                    new_risk = RiskLevel::Critical;
                }
                EmergencyEvent::TheftDetected { .. } => {
                    if self.risk_level < RiskLevel::High {
                        new_risk = RiskLevel::High;
                    }
                }
            }
        }

        // Integrate V2V hazard flags
        if self.hazard_flag {
            if new_risk < RiskLevel::High {
                new_risk = RiskLevel::High;
            }
        }

        self.risk_level = new_risk;
    }

    /// Orchestration: Processes inputs and populates the alert queue
    pub fn process_cycle(&mut self) {
        self.update_risk_assessment();

        // Convert V2V hazard flags to alerts
        if self.hazard_flag {
            self.alert_queue.push(Alert {
                id: format!("v2v_hazard_{}", Utc::now().timestamp_micros()),
                severity: AlertSeverity::Emergency,
                message: "V2V ROAD HAZARD DETECTED AHEAD!".to_string(),
                source: "V2VMeshAgent".to_string(),
                timestamp: Utc::now().timestamp_millis(),
            });
        }

        // Convert vision alerts to domain alerts
        if let Some(vision) = &self.last_vision_analysis {
            for v_alert in &vision.alerts {
                let severity = if v_alert.contains('🚨') {
                    AlertSeverity::Emergency
                } else if v_alert.contains("⚠️") {
                    AlertSeverity::Warning
                } else {
                    AlertSeverity::Info
                };

                self.alert_queue.push(Alert {
                    id: format!("vision_{}", Utc::now().timestamp_micros()),
                    severity,
                    message: v_alert.clone(),
                    source: "VisionAgent".to_string(),
                    timestamp: Utc::now().timestamp_millis(),
                });
            }
        }

        // Convert telemetry events to domain alerts
        if let Some(telemetry) = &self.last_telemetry_event {
            let (severity, message) = match telemetry {
                EmergencyEvent::CrashDetected { g_force } => (
                    AlertSeverity::Emergency,
                    format!("Impact detected! G-Force: {:.1}", g_force)
                ),
                EmergencyEvent::TheftDetected { movement } => (
                    AlertSeverity::Warning,
                    format!("Suspicious movement: {:.2}", movement)
                ),
            };

            self.alert_queue.push(Alert {
                id: format!("telemetry_{}", Utc::now().timestamp_micros()),
                severity,
                message,
                source: "TelemetryAgent".to_string(),
                timestamp: Utc::now().timestamp_millis(),
            });
        }

        // Clear consumed inputs
        self.last_vision_analysis = None;
        self.last_telemetry_event = None;
    }

    pub fn ingest_vision_analysis(&mut self, analysis: AnalysisResult) {
        self.last_vision_analysis = Some(analysis);
    }

    pub fn ingest_telemetry_event(&mut self, event: EmergencyEvent) {
        self.last_telemetry_event = Some(event);
    }

    pub fn ingest_v2v_hazard(&mut self, has_hazard: bool) {
        self.hazard_flag = has_hazard;
    }

    pub fn get_next_alert(&mut self) -> Option<Alert> {
        self.alert_queue.pop()
    }
}

/// Intent routing enum for the voice agent
#[derive(Debug, PartialEq, Eq, Clone, serde::Serialize)]
pub enum VoiceIntent {
    GetStatus,
    GetAlerts,
    GetDiagnostics,
    Unknown,
}

/// Standalone GarageVoiceAgent representing the Voice Agent loop (STT -> intent -> TTS)
#[derive(Debug, Default)]
pub struct GarageVoiceAgent {
    // Voice-agent configurations can go here
}

impl GarageVoiceAgent {
    pub fn new() -> Self {
        Self {}
    }

    /// Performs Speech-to-Text (STT) processing on input audio data
    pub fn speech_to_text(&self, audio_data: &[u8]) -> Result<String, String> {
        if audio_data.is_empty() {
            return Err("STT processing error: empty audio data".to_string());
        }

        // Simulating voice-to-text / STT conversion
        let text = if let Ok(s) = std::str::from_utf8(audio_data) {
            if s.chars().all(|c| c.is_alphanumeric() || c.is_whitespace() || c.is_ascii_punctuation()) {
                s.to_string()
            } else {
                // Simulated voice command based on length fallback
                if audio_data.len() % 3 == 0 {
                    "status".to_string()
                } else if audio_data.len() % 3 == 1 {
                    "alerts".to_string()
                } else {
                    "diagnostics".to_string()
                }
            }
        } else {
            // Simulated voice command based on length fallback
            if audio_data.len() % 3 == 0 {
                "status".to_string()
            } else if audio_data.len() % 3 == 1 {
                "alerts".to_string()
            } else {
                "diagnostics".to_string()
            }
        };

        Ok(text)
    }

    /// Performs Intent Routing based on voice input transcription text
    pub fn route_intent(&self, text: &str) -> VoiceIntent {
        let normalized = text.to_lowercase();
        if normalized.contains("status") {
            VoiceIntent::GetStatus
        } else if normalized.contains("alert") || normalized.contains("warning") {
            VoiceIntent::GetAlerts
        } else if normalized.contains("diagnostic") || normalized.contains("check") {
            VoiceIntent::GetDiagnostics
        } else {
            VoiceIntent::Unknown
        }
    }

    /// Performs Text-to-Speech (TTS) synthesis on response text
    pub fn text_to_speech(&self, text: &str) -> Vec<u8> {
        // Simulates TTS voice synthesis output
        text.as_bytes().to_vec()
    }

    /// Coordinates the full Voice Agent loop: STT -> Intent Routing -> TTS Reply
    pub fn process_voice_agent_loop(&self, audio_data: &[u8]) -> Result<String, String> {
        let transcribed_text = self.speech_to_text(audio_data)?;
        let intent = self.route_intent(&transcribed_text);

        let reply_text = match intent {
            VoiceIntent::GetStatus => "All systems are nominal. The copilot risk assessment is currently low.".to_string(),
            VoiceIntent::GetAlerts => "You have no active high-severity alerts in the copilot queue.".to_string(),
            VoiceIntent::GetDiagnostics => "Diagnostics check complete: OBD interface connection is stable.".to_string(),
            VoiceIntent::Unknown => format!("I detected the intent for '{}', but I'm not sure how to assist with that.", transcribed_text),
        };

        let tts_audio = self.text_to_speech(&reply_text);

        let response = serde_json::json!({
            "stt_transcription": transcribed_text,
            "intent": format!("{:?}", intent),
            "tts_reply_text": reply_text,
            "tts_audio_len": tts_audio.len()
        });

        Ok(response.to_string())
    }
}
