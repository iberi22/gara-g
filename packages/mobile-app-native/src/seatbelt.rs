//! Seatbelt Detection Module
//!
//! Detects whether the vehicle driver/passengers have their seatbelt fastened
//! using MediaPipe Pose keypoint analysis via `SeatbeltHeuristicDetector`.
//!
//! Integrates with the existing logging and alert system.
//! Maintains a state machine for alert generation.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use crate::domain::dms::Point3D;

use crate::infrastructure::seatbelt_detector::{
    SeatbeltHeuristicDetector,
    SeatbeltStatus,
};

/// Result of a single seatbelt detection frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionResult {
    /// Whether the driver's seatbelt is fastened.
    pub fastened: bool,
    /// Confidence score in [0.0, 1.0].
    pub confidence: f64,
    /// Whether a driver is present in the frame.
    pub driver_present: bool,
}

impl DetectionResult {
    pub fn default_unfastened() -> Self {
        Self {
            fastened: false,
            confidence: 0.0,
            driver_present: false,
        }
    }

    pub fn default_fastened() -> Self {
        Self {
            fastened: true,
            confidence: 1.0,
            driver_present: false,
        }
    }
}

/// Alert severity levels.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

/// A seatbelt-related alert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeatbeltAlert {
    pub message: String,
    pub severity: AlertSeverity,
    pub timestamp_ms: i64,
}

/// Event emitted to the UI stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SeatbeltEvent {
    Fastened { confidence: f64 },
    Unfastened { duration_ms: i64, confidence: f64 },
    DriverAbsent,
    AlertGenerated(SeatbeltAlert),
    StateChange { state: String, reason: String },
}

/// Engine state enumeration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SeatbeltState {
    Monitoring,
    Alerted,
    Error(String),
}

impl Default for SeatbeltState {
    fn default() -> Self {
        Self::Monitoring
    }
}

/// Seatbelt detector engine.
///
/// Maintains state across frames: tracks how long the seatbelt has been
/// unfastened, generates alerts when thresholds are exceeded, and
/// communicates with the Flutter UI via an event sink.
///
/// Uses `SeatbeltHeuristicDetector` for the actual frame analysis.
pub struct SeatbeltDetector {
    /// Current detection state.
    state: SeatbeltState,
    /// Whether the seatbelt is currently fastened.
    fastened: bool,
    /// Confidence of the current detection.
    confidence: f64,
    /// Whether a driver is present.
    driver_present: bool,
    /// Timestamp (Instant) when the unfastened period started.
    unfastened_since: Option<Instant>,
    /// Duration threshold in seconds before triggering an alert.
    alert_threshold_secs: u64,
    /// Minimum confidence to accept a frame detection.
    min_confidence: f64,
    /// Number of consecutive frames lost (for robust state machine).
    lost_frames: u32,
    /// Maximum consecutive lost frames before resetting state.
    max_lost_frames: u32,
    /// Event sink channel (tokio mpsc) for push to the bridge.
    event_tx: Option<tokio::sync::mpsc::UnboundedSender<SeatbeltEvent>>,
    /// The heuristic keypoint-based detector.
    heuristic_detector: SeatbeltHeuristicDetector,
}

impl Default for SeatbeltDetector {
    fn default() -> Self {
        Self {
            state: SeatbeltState::Monitoring,
            fastened: true,
            confidence: 1.0,
            driver_present: false,
            unfastened_since: None,
            alert_threshold_secs: 5,
            min_confidence: 0.5,
            lost_frames: 0,
            max_lost_frames: 10,
            event_tx: None,
            heuristic_detector: SeatbeltHeuristicDetector::new(),
        }
    }
}

impl SeatbeltDetector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Attach an event sender so the detector can push events to the bridge.
    pub fn set_event_sender(&mut self, tx: tokio::sync::mpsc::UnboundedSender<SeatbeltEvent>) {
        self.event_tx = Some(tx);
    }

    /// Set the alert threshold in seconds.
    pub fn set_alert_threshold(&mut self, secs: u64) {
        self.alert_threshold_secs = secs;
    }

    /// Set the unfastened threshold on the heuristic detector.
    pub fn set_unfastened_threshold(&mut self, threshold: f32) {
        self.heuristic_detector = SeatbeltHeuristicDetector {
            unfastened_threshold: threshold,
            ..self.heuristic_detector
        };
    }

    /// Process a single camera frame and return the detection result.
    ///
    /// Uses `SeatbeltHeuristicDetector::analyze()` on keypoint data.
    ///
    /// # Arguments
    /// * `frame` - Raw image bytes. In a full implementation these would be
    ///   preprocessed into keypoints. For the Rust-native path, we decode
    ///   keypoints from the frame bytes when possible, or fall back to
    ///   keypoint-based analysis.
    /// * `width` - Frame width in pixels.
    /// * `height` - Frame height in pixels.
    ///
    /// # Returns
    /// A `DetectionResult` for the current frame.
    pub fn detect(&mut self, frame: &[u8], width: u32, height: u32) -> DetectionResult {
        // Try to extract keypoints from frame bytes.
        // Format: first 4 bytes = count as u32 LE, then 4*33*3 = 396 bytes of f32 triplets.
        // If frame is too small, fall back to hash-based placeholder.
        let keypoints = if frame.len() >= 4 + 33 * 3 * 4 {
            Self::decode_keypoints(frame)
        } else {
            None
        };

        let (status, confidence) = if let Some(ref kps) = keypoints {
            let points: Vec<Point3D> = kps.iter().map(|&(x,y,z)| Point3D {x,y,z}).collect();
            self.heuristic_detector.analyze_with_frame(frame, width, height, &points)
        } else {
            // Fallback: legacy hash-based placeholder for non-keypoint frames
            self.detect_placeholder(frame, width, height)
        };

        match status {
            SeatbeltStatus::Fastened => {
                self.fastened = true;
                self.driver_present = true;
                self.confidence = confidence as f64;
            }
            SeatbeltStatus::Unfastened => {
                self.fastened = false;
                self.driver_present = true;
                self.confidence = confidence as f64;
            }
            SeatbeltStatus::DriverAbsent => {
                self.fastened = true;
                self.driver_present = false;
                self.confidence = 0.0;
            }
            SeatbeltStatus::Unknown => {
                self.confidence = (self.confidence * 0.5).max(0.1);
            }
        }

        DetectionResult {
            fastened: self.fastened,
            confidence: self.confidence,
            driver_present: self.driver_present,
        }
    }

    /// Decode MediaPipe Pose keypoints from raw byte buffer.
    ///
    /// Format: [u32 LE: count] [f32 LE: x0, y0, z0] [f32 LE: x1, y1, z1] ...
    fn decode_keypoints(data: &[u8]) -> Option<Vec<(f32, f32, f32)>> {
        if data.len() < 4 {
            return None;
        }
        let count = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let expected_len = 4 + count * 3 * 4;
        if data.len() < expected_len || count > 33 || count == 0 {
            return None;
        }

        let mut keypoints = Vec::with_capacity(count);
        for i in 0..count {
            let offset = 4 + i * 12;
            if offset + 12 > data.len() {
                break;
            }
            let x = f32::from_le_bytes([
                data[offset], data[offset + 1], data[offset + 2], data[offset + 3],
            ]);
            let y = f32::from_le_bytes([
                data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7],
            ]);
            let z = f32::from_le_bytes([
                data[offset + 8], data[offset + 9], data[offset + 10], data[offset + 11],
            ]);
            keypoints.push((x, y, z));
        }

        Some(keypoints)
    }

    /// Fallback placeholder detection for frames without keypoints.
    /// Uses a simple hash of frame bytes to get pseudo-random variation.
    fn detect_placeholder(&self, frame: &[u8], width: u32, height: u32) -> (SeatbeltStatus, f32) {
        let driver_present = !frame.is_empty() && width >= 320 && height >= 240;

        if !driver_present {
            return (SeatbeltStatus::DriverAbsent, 0.0);
        }

        let hash: u64 = frame.iter()
            .take(100)
            .fold(0u64, |acc, &b| acc.wrapping_mul(31).wrapping_add(b as u64));

        let simulated_unfastened = hash % 13 == 0;
        let confidence = if simulated_unfastened {
            SeatbeltStatus::Unfastened
        } else {
            SeatbeltStatus::Fastened
        };
        let conf_value = 0.85 + (hash as f64 % 1500.0) / 10000.0;

        (confidence, conf_value as f32)
    }

    /// Process keypoints directly (no frame bytes).
    /// This is the primary entry point when keypoints are already extracted
    /// by MediaPipe on the Flutter side.
    pub fn detect_from_keypoints(&mut self, keypoints: &[(f32, f32, f32)]) -> DetectionResult {
        let (status, confidence) = self.heuristic_detector.analyze_with_confidence(keypoints);

        match status {
            SeatbeltStatus::Fastened => {
                self.fastened = true;
                self.driver_present = true;
                self.confidence = confidence as f64;
            }
            SeatbeltStatus::Unfastened => {
                self.fastened = false;
                self.driver_present = true;
                self.confidence = confidence as f64;
            }
            SeatbeltStatus::DriverAbsent => {
                self.fastened = true;
                self.driver_present = false;
                self.confidence = 0.0;
            }
            SeatbeltStatus::Unknown => {
                self.confidence = (self.confidence * 0.5).max(0.1);
            }
        }

        DetectionResult {
            fastened: self.fastened,
            confidence: self.confidence,
            driver_present: self.driver_present,
        }
    }

    /// Run the state machine after each detection.
    ///
    /// Returns the current state and alerts that should be emitted.
    pub fn update_state(&mut self) -> (SeatbeltState, Option<SeatbeltAlert>) {
        let now = Instant::now();

        if !self.driver_present {
            // Driver not present: reset state, no alert.
            self.state = SeatbeltState::Monitoring;
            self.unfastened_since = None;
            self.lost_frames = 0;
            self.emit_event(SeatbeltEvent::DriverAbsent);
            return (self.state.clone(), None);
        }

        if self.confidence < self.min_confidence {
            self.lost_frames += 1;
            if self.lost_frames > self.max_lost_frames {
                // Too many low-confidence frames: reset.
                self.state = SeatbeltState::Monitoring;
                self.unfastened_since = None;
                self.lost_frames = 0;
            }
            return (self.state.clone(), None);
        }

        self.lost_frames = 0;

        if !self.fastened {
            // Seatbelt is unfastened.
            if self.unfastened_since.is_none() {
                self.unfastened_since = Some(now);
                self.emit_event(SeatbeltEvent::Unfastened {
                    duration_ms: 0,
                    confidence: self.confidence,
                });
            }

            let elapsed = now.duration_since(self.unfastened_since.unwrap());
            let elapsed_ms = elapsed.as_millis() as i64;

            if elapsed >= Duration::from_secs(self.alert_threshold_secs) {
                if self.state != SeatbeltState::Alerted {
                    self.state = SeatbeltState::Alerted;
                    let alert = SeatbeltAlert {
                        message: format!(
                            "¡Cinturón de seguridad desabrochado por más de {} segundos!",
                            self.alert_threshold_secs
                        ),
                        severity: AlertSeverity::Critical,
                        timestamp_ms: chrono::Utc::now().timestamp_millis(),
                    };
                    self.emit_event(SeatbeltEvent::AlertGenerated(alert.clone()));
                    return (self.state.clone(), Some(alert));
                }
            } else {
                // Still within grace period — emit informational event.
                self.state = SeatbeltState::Monitoring;
                self.emit_event(SeatbeltEvent::Unfastened {
                    duration_ms: elapsed_ms,
                    confidence: self.confidence,
                });
            }
        } else {
            // Seatbelt is fastened.
            if self.unfastened_since.is_some() {
                // Transition from unfastened to fastened.
                let elapsed = now.duration_since(self.unfastened_since.unwrap());
                if elapsed >= Duration::from_secs(self.alert_threshold_secs) {
                    self.emit_event(SeatbeltEvent::StateChange {
                        state: "re-fastened".to_string(),
                        reason: format!("After {} ms unfastened", elapsed.as_millis()),
                    });
                }
                self.unfastened_since = None;
            }

            self.state = SeatbeltState::Monitoring;
            self.emit_event(SeatbeltEvent::Fastened {
                confidence: self.confidence,
            });
        }

        (self.state.clone(), None)
    }

    /// Process a complete frame: detect + update state.
    pub fn process_frame(&mut self, frame: &[u8], width: u32, height: u32) -> (DetectionResult, SeatbeltState, Option<SeatbeltAlert>) {
        let result = self.detect(frame, width, height);
        let (state, alert) = self.update_state();
        (result, state, alert)
    }

    /// Process keypoints directly: detect + update state.
    pub fn process_keypoints(&mut self, keypoints: &[(f32, f32, f32)]) -> (DetectionResult, SeatbeltState, Option<SeatbeltAlert>) {
        let result = self.detect_from_keypoints(keypoints);
        let (state, alert) = self.update_state();
        (result, state, alert)
    }

    /// Get the current state.
    pub fn current_state(&self) -> &SeatbeltState {
        &self.state
    }

    /// Get current seatbelt status.
    pub fn is_fastened(&self) -> bool {
        self.fastened
    }

    fn emit_event(&self, event: SeatbeltEvent) {
        if let Some(ref tx) = self.event_tx {
            let _ = tx.send(event);
        }
    }

    /// Reset the detector to initial state.
    pub fn reset(&mut self) {
        self.state = SeatbeltState::Monitoring;
        self.fastened = true;
        self.confidence = 1.0;
        self.driver_present = false;
        self.unfastened_since = None;
        self.lost_frames = 0;
    }
}

/// FFI-friendly result for seatbelt detection.
///
/// Mirrors `DetectionResult` but uses plain types suitable for C FFI.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SeatbeltResult {
    pub fastened: bool,
    pub confidence: f64,
    pub driver_present: bool,
    pub alerted: bool,
}

impl From<&DetectionResult> for SeatbeltResult {
    fn from(r: &DetectionResult) -> Self {
        Self {
            fastened: r.fastened,
            confidence: r.confidence,
            driver_present: r.driver_present,
            alerted: false, // Updated separately
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::seatbelt_detector::SeatbeltStatus;

    #[test]
    fn test_detection_result_defaults() {
        let unfastened = DetectionResult::default_unfastened();
        assert!(!unfastened.fastened);
        assert_eq!(unfastened.confidence, 0.0);

        let fastened = DetectionResult::default_fastened();
        assert!(fastened.fastened);
        assert_eq!(fastened.confidence, 1.0);
    }

    #[test]
    fn test_seatbelt_detector_initial_state() {
        let detector = SeatbeltDetector::new();
        assert!(detector.is_fastened());
        assert_eq!(*detector.current_state(), SeatbeltState::Monitoring);
        assert_eq!(detector.alert_threshold_secs, 5);
    }

    #[test]
    fn test_detect_no_driver() {
        let mut detector = SeatbeltDetector::new();
        let frame: [u8; 0] = [];
        let result = detector.detect(&frame, 0, 0);
        assert!(!result.driver_present);
        assert!(result.fastened); // Default to safe
    }

    #[test]
    fn test_detect_driver_present_placeholder() {
        let mut detector = SeatbeltDetector::new();
        let frame = vec![0u8; 640 * 480 * 3]; // Simulate a 640x480 RGB frame (no keypoints header)
        let result = detector.detect(&frame, 640, 480);
        assert!(result.driver_present);
    }

    #[test]
    fn test_decode_keypoints_normal() {
        // Build a byte buffer for 33 keypoints
        let count: u32 = 33;
        let mut data = Vec::new();
        data.extend_from_slice(&count.to_le_bytes());
        for i in 0..33 {
            data.extend_from_slice(&((i as f32 * 0.01).to_le_bytes())); // x
            data.extend_from_slice(&((i as f32 * 0.02 + 0.5).to_le_bytes())); // y
            data.extend_from_slice(&(0.0f32.to_le_bytes())); // z
        }

        let kps = SeatbeltDetector::decode_keypoints(&data);
        assert!(kps.is_some());
        let kps = kps.unwrap();
        assert_eq!(kps.len(), 33);
        assert!((kps[0].0 - 0.0).abs() < 1e-6);
        assert!((kps[1].0 - 0.01).abs() < 1e-6);
    }

    #[test]
    fn test_decode_keypoints_truncated() {
        let data = vec![33u8, 0, 0, 0, 1, 2, 3]; // Only 1 keypoint worth of data
        let kps = SeatbeltDetector::decode_keypoints(&data);
        assert!(kps.is_none() || kps.unwrap().len() <= 1);
    }

    #[test]
    fn test_decode_keypoints_empty() {
        let data: Vec<u8> = vec![];
        let kps = SeatbeltDetector::decode_keypoints(&data);
        assert!(kps.is_none());
    }

    #[test]
    fn test_detect_from_keypoints_fastened() {
        let mut detector = SeatbeltDetector::new();
        let kps = fastened_keypoints_for_detector();
        let result = detector.detect_from_keypoints(&kps);
        assert!(result.driver_present);
        assert!(result.fastened, "Expected fastened for pose keypoints with belt diagonal");
        assert!(result.confidence >= 0.4);
    }

    #[test]
    fn test_detect_from_keypoints_unfastened() {
        let mut detector = SeatbeltDetector::new();
        let kps = unfastened_keypoints_for_detector();
        let result = detector.detect_from_keypoints(&kps);
        assert!(result.driver_present);
        assert!(!result.fastened, "Expected unfastened for narrow hip+blocking pose");
    }

    #[test]
    fn test_detect_from_keypoints_absent() {
        let mut detector = SeatbeltDetector::new();
        let kps = vec![(0.0, 0.0, 0.0); 33];
        let result = detector.detect_from_keypoints(&kps);
        assert!(!result.driver_present, "No driver present for zeroed keypoints");
        assert!(result.fastened); // Default safe
    }

    #[test]
    fn test_state_machine_no_driver() {
        let mut detector = SeatbeltDetector::new();
        let frame: [u8; 0] = [];
        detector.detect(&frame, 0, 0);
        let (state, alert) = detector.update_state();
        assert_eq!(state, SeatbeltState::Monitoring);
        assert!(alert.is_none());
    }

    #[test]
    fn test_state_machine_unfastened_alert() {
        let mut detector = SeatbeltDetector::new();
        // Force driver present, unfastened, high confidence
        detector.driver_present = true;
        detector.fastened = false;
        detector.confidence = 0.9;

        // Set very short threshold for testing
        detector.alert_threshold_secs = 0;

        let (state, alert) = detector.update_state();
        assert_eq!(state, SeatbeltState::Alerted);
        assert!(alert.is_some());

        let alert = alert.unwrap();
        assert_eq!(alert.severity, AlertSeverity::Critical);
        assert!(alert.message.contains("Cinturón"));
    }

    #[test]
    fn test_state_machine_fastened_after_unfastened() {
        let mut detector = SeatbeltDetector::new();
        detector.driver_present = true;
        detector.fastened = false;
        detector.confidence = 0.9;

        // Start unfastened period but don't cross threshold
        let (state, alert) = detector.update_state();
        assert_eq!(state, SeatbeltState::Monitoring);
        assert!(alert.is_none());

        // Now fasten
        detector.fastened = true;
        let (state, alert) = detector.update_state();
        assert_eq!(state, SeatbeltState::Monitoring);
        assert!(alert.is_none());
        assert!(detector.unfastened_since.is_none());
    }

    #[test]
    fn test_process_frame_integration() {
        let mut detector = SeatbeltDetector::new();
        let frame = vec![128u8; 640 * 480 * 3];

        let (result, state, alert) = detector.process_frame(&frame, 640, 480);
        assert!(result.driver_present);
        assert_eq!(state, SeatbeltState::Monitoring);
        if !result.fastened {
            assert_eq!(state, SeatbeltState::Monitoring);
        }
        assert!(alert.is_none());
    }

    #[test]
    fn test_fastened_after_long_unfastened() {
        let mut detector = SeatbeltDetector::new();
        detector.driver_present = true;
        detector.fastened = false;
        detector.confidence = 0.9;

        // Simulate unfastened past threshold (use zero threshold)
        detector.alert_threshold_secs = 0;
        let (state, alert) = detector.update_state();
        assert_eq!(state, SeatbeltState::Alerted);
        assert!(alert.is_some());

        // Now fasten — back to monitoring
        detector.fastened = true;
        let (state, _alert) = detector.update_state();
        assert_eq!(state, SeatbeltState::Monitoring);
    }

    #[test]
    fn test_low_confidence_reset() {
        let mut detector = SeatbeltDetector::new();
        detector.driver_present = true;
        detector.fastened = false;
        detector.confidence = 0.1; // Below min_confidence (0.5)
        detector.min_confidence = 0.5;

        // Run many update cycles
        for _ in 0..5 {
            let (_state, _alert) = detector.update_state();
        }
        assert!(detector.lost_frames > 0);

        // Exceed max_lost_frames
        for _ in 0..6 {
            let (_state, _alert) = detector.update_state();
        }

        // Should have reset
        assert_eq!(detector.lost_frames, 0);
        assert!(detector.unfastened_since.is_none());
    }

    #[test]
    fn test_seatbelt_result_conversion() {
        let result = DetectionResult {
            fastened: true,
            confidence: 0.95,
            driver_present: true,
        };
        let ffi: SeatbeltResult = (&result).into();
        assert!(ffi.fastened);
        assert!((ffi.confidence - 0.95).abs() < 1e-6);
        assert!(ffi.driver_present);
        assert!(!ffi.alerted);
    }

    #[test]
    fn test_reset() {
        let mut detector = SeatbeltDetector::new();
        detector.driver_present = true;
        detector.fastened = false;
        detector.confidence = 0.9;
        detector.alert_threshold_secs = 0;
        detector.update_state();
        assert_eq!(*detector.current_state(), SeatbeltState::Alerted);

        detector.reset();
        assert!(detector.is_fastened());
        assert_eq!(*detector.current_state(), SeatbeltState::Monitoring);
        assert!(detector.unfastened_since.is_none());
    }

    #[test]
    fn test_emit_event_does_not_panic() {
        let mut detector = SeatbeltDetector::new();
        // Without an event_tx, emit_event should be a no-op.
        detector.driver_present = true;
        detector.fastened = false;
        detector.confidence = 0.9;
        detector.alert_threshold_secs = 0;
        let (_state, alert) = detector.update_state();
        // Alert should still be returned even without a channel.
        assert!(alert.is_some());
    }

    #[test]
    fn test_set_alert_threshold() {
        let mut detector = SeatbeltDetector::new();
        detector.set_alert_threshold(10);
        assert_eq!(detector.alert_threshold_secs, 10);
    }

    #[test]
    fn test_process_keypoints_integration() {
        let mut detector = SeatbeltDetector::new();
        let kps = fastened_keypoints_for_detector();
        let (result, state, alert) = detector.process_keypoints(&kps);
        assert!(result.driver_present);
        assert!(result.fastened);
        assert_eq!(state, SeatbeltState::Monitoring);
        assert!(alert.is_none());
    }

    #[test]
    fn test_set_unfastened_threshold() {
        let mut detector = SeatbeltDetector::new();
        detector.set_unfastened_threshold(0.6);
        assert!((detector.heuristic_detector.unfastened_threshold - 0.6).abs() < 1e-6);
    }

    // --- Helper: fastened keypoints for state machine tests ---
    fn fastened_keypoints_for_detector() -> Vec<(f32, f32, f32)> {
        let mut kps = vec![(0.0, 0.0, 0.0); 33];
        kps[0] = (0.5, 0.25, 0.0);
        kps[1] = (0.46, 0.24, 0.05);
        kps[2] = (0.54, 0.24, 0.05);
        kps[3] = (0.43, 0.25, 0.08);
        kps[4] = (0.57, 0.25, 0.08);
        kps[11] = (0.40, 0.35, 0.10);
        kps[12] = (0.60, 0.35, 0.10);
        kps[13] = (0.35, 0.50, 0.15);
        kps[14] = (0.65, 0.50, 0.15);
        kps[15] = (0.32, 0.60, 0.20);
        kps[16] = (0.68, 0.60, 0.20);
        kps[23] = (0.40, 0.60, 0.30);
        kps[24] = (0.60, 0.60, 0.30);
        kps[25] = (0.42, 0.78, 0.40);
        kps[26] = (0.58, 0.78, 0.40);
        kps[27] = (0.43, 0.92, 0.50);
        kps[28] = (0.57, 0.92, 0.50);
        kps
    }

    fn unfastened_keypoints_for_detector() -> Vec<(f32, f32, f32)> {
        let mut kps = vec![(0.0, 0.0, 0.0); 33];
        kps[0] = (0.5, 0.20, 0.0);
        kps[11] = (0.40, 0.30, 0.10);
        kps[12] = (0.60, 0.30, 0.10);
        kps[13] = (0.42, 0.40, 0.15);
        kps[14] = (0.58, 0.40, 0.15);
        kps[15] = (0.44, 0.50, 0.20);
        kps[16] = (0.56, 0.50, 0.20);
        kps[23] = (0.35, 0.55, 0.25);
        kps[24] = (0.65, 0.55, 0.25);
        kps[25] = (0.40, 0.75, 0.35);
        kps[26] = (0.60, 0.75, 0.35);
        kps[27] = (0.42, 0.90, 0.45);
        kps[28] = (0.58, 0.90, 0.45);
        kps
    }
}
