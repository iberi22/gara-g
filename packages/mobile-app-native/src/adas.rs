use crate::domain::adas::{AdasConfig, BoundingBox, DetectedObject, WarningLevel};
use crate::domain::lane::{Lane, LaneState};
use crate::domain::seatbelt::SeatbeltState;
use crate::infrastructure::adas_engine::AdasEngine;
use crate::infrastructure::collision_warning::{CollisionWarning, CollisionWarningConfig};
use crate::infrastructure::lane_tracker::LaneTracker;
use crate::infrastructure::seatbelt_detector::{SeatbeltHeuristicDetector, SeatbeltStatus};
use crate::domain::dms::Point3D;
use serde::{Deserialize, Serialize};

/// High-level summary of an ADAS frame analysis cycle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AdasFrameResult {
    pub detections: Vec<DetectedObject>,
    pub left_lane_visible: bool,
    pub right_lane_visible: bool,
    pub departure_warning: bool,
    pub collision_warning: WarningLevel,
    pub ttc_seconds: f32,
    pub seatbelt_state: SeatbeltState,
    pub alerts: Vec<String>,
}

/// Unified ADAS pipeline bringing together vision detection, lane tracking,
/// collision warning evaluation, and driver seatbelt monitoring.
pub struct AdasPipeline {
    pub engine: AdasEngine,
    pub lane_tracker: LaneTracker,
    pub collision_warning: CollisionWarning,
    pub seatbelt_detector: SeatbeltHeuristicDetector,
}

impl AdasPipeline {
    pub fn new(config: AdasConfig) -> Result<Self, String> {
        let engine = AdasEngine::new(config.into())?;
        let lane_tracker = LaneTracker::new();
        let collision_warning = CollisionWarning::new(CollisionWarningConfig::default());
        let seatbelt_detector = SeatbeltHeuristicDetector::new();

        Ok(Self {
            engine,
            lane_tracker,
            collision_warning,
            seatbelt_detector,
        })
    }

    /// Processes a camera frame along with speed, distance telemetry and optional facial/body landmarks.
    pub fn process_frame(
        &self,
        frame: &[u8],
        speed_kmh: f32,
        lead_distance_m: Option<f32>,
        landmarks: &[Point3D],
    ) -> AdasFrameResult {
        let mut alerts = Vec::new();

        // 1. Object Detection via YOLOv8 engine
        let detections = self.engine.detect(frame);
        for obj in &detections {
            if obj.class == "person" && obj.confidence > 0.6 {
                alerts.push("⚠️ Pedestrian detected in path!".to_string());
            }
        }

        // 2. Lane Tracking
        let lane_state = self.lane_tracker.process(frame);
        let left_lane_visible = lane_state.left_lane.is_some();
        let right_lane_visible = lane_state.right_lane.is_some();
        let departure_warning = lane_state.departure_warning;
        if departure_warning {
            alerts.push("⚠️ Lane departure warning: vehicle drifting!".to_string());
        }

        // 3. Collision Warning
        let (collision_warning, ttc_seconds) = if let Some(dist) = lead_distance_m {
            let (level, ttc) = self.collision_warning.evaluate(speed_kmh / 3.6, 0.0, dist, 0.0);
            (level, ttc)
        } else {
            (WarningLevel::None, f32::INFINITY)
        };

        if collision_warning >= WarningLevel::Warning {
            alerts.push(format!("🚨 Forward Collision Warning! TTC: {:.1}s", ttc_seconds));
        }

        // 4. Seatbelt Monitoring
        let seatbelt_state = if !frame.is_empty() && !landmarks.is_empty() {
            let (status, _) = self.seatbelt_detector.analyze_with_frame(frame, 640, 480, landmarks);
            match status {
                SeatbeltStatus::Fastened => SeatbeltState::Buckled,
                SeatbeltStatus::Unfastened => SeatbeltState::Unbuckled,
                _ => SeatbeltState::Unknown,
            }
        } else {
            self.seatbelt_detector.analyze(landmarks)
        };

        if seatbelt_state == SeatbeltState::Unbuckled {
            alerts.push("⚠️ Seatbelt unbuckled! Please fasten seatbelt.".to_string());
        }

        AdasFrameResult {
            detections,
            left_lane_visible,
            right_lane_visible,
            departure_warning,
            collision_warning,
            ttc_seconds,
            seatbelt_state,
            alerts,
        }
    }
}

impl From<AdasConfig> for crate::infrastructure::adas_engine_config::AdasEngineConfig {
    fn from(c: AdasConfig) -> Self {
        Self {
            model_path: c.model_path,
            confidence_threshold: c.confidence_threshold,
            nms_threshold: c.nms_threshold,
            input_width: c.input_width,
            input_height: c.input_height,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adas_pipeline_process_frame() {
        let config = AdasConfig::default();
        let pipeline = AdasPipeline::new(config).unwrap();

        let frame = vec![128u8; 640 * 480 * 3];
        let result = pipeline.process_frame(&frame, 60.0, Some(10.0), &[]);

        assert!(result.ttc_seconds < 10.0);
        assert_eq!(result.seatbelt_state, SeatbeltState::Unknown);
    }
}
