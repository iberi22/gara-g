use serde::{Deserialize, Serialize};
use crate::domain::seatbelt::SeatbeltState;
pub use copilot::driver_monitor::{
    DriverMonitor, Point3D as CopilotPoint3D, HeadPose as CopilotHeadPose,
    DmsEventSeverity as CopilotDmsEventSeverity, DmsEvent as CopilotDmsEvent,
    DmsAnalysis as CopilotDmsAnalysis,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Point3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl From<&Point3D> for CopilotPoint3D {
    fn from(p: &Point3D) -> Self {
        CopilotPoint3D {
            x: p.x,
            y: p.y,
            z: p.z,
        }
    }
}

impl From<&CopilotPoint3D> for Point3D {
    fn from(p: &CopilotPoint3D) -> Self {
        Point3D {
            x: p.x,
            y: p.y,
            z: p.z,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeadPose {
    pub pitch: f32,
    pub yaw: f32,
    pub roll: f32,
}

impl From<CopilotHeadPose> for HeadPose {
    fn from(hp: CopilotHeadPose) -> Self {
        HeadPose {
            pitch: hp.pitch,
            yaw: hp.yaw,
            roll: hp.roll,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DmsEventSeverity {
    Info,
    Warning,
    Critical,
}

impl From<CopilotDmsEventSeverity> for DmsEventSeverity {
    fn from(s: CopilotDmsEventSeverity) -> Self {
        match s {
            CopilotDmsEventSeverity::Info => DmsEventSeverity::Info,
            CopilotDmsEventSeverity::Warning => DmsEventSeverity::Warning,
            CopilotDmsEventSeverity::Critical => DmsEventSeverity::Critical,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DmsEvent {
    pub id: String,
    pub event_type: String,
    pub severity: DmsEventSeverity,
    pub message: String,
    pub timestamp: i64,
}

impl From<CopilotDmsEvent> for DmsEvent {
    fn from(e: CopilotDmsEvent) -> Self {
        DmsEvent {
            id: e.id,
            event_type: e.event_type,
            severity: DmsEventSeverity::from(e.severity),
            message: e.message,
            timestamp: e.timestamp,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DmsAnalysis {
    pub ear_left: f32,
    pub ear_right: f32,
    pub mar: f32,
    pub drowsiness_score: f32,
    pub yawning_score: f32,
    pub head_pose: HeadPose,
    pub is_distracted: bool,
    pub is_drowsy: bool,
    pub is_yawning: bool,
    pub seatbelt_state: SeatbeltState,
}

pub struct DmsEngine {
    pub monitor: DriverMonitor,
}

impl DmsEngine {
    pub fn new() -> Self {
        Self {
            monitor: DriverMonitor::new(),
        }
    }

    pub fn analyze(&mut self, landmarks: &[Point3D]) -> DmsAnalysis {
        let copilot_landmarks: Vec<CopilotPoint3D> = landmarks.iter().map(CopilotPoint3D::from).collect();
        let timestamp = chrono::Utc::now().timestamp_millis();
        let (analysis, _event) = self.monitor.analyze(&copilot_landmarks, timestamp);

        DmsAnalysis {
            ear_left: analysis.ear_left,
            ear_right: analysis.ear_right,
            mar: analysis.mar,
            drowsiness_score: analysis.drowsiness_score,
            yawning_score: analysis.yawning_score,
            head_pose: HeadPose::from(analysis.head_pose),
            is_distracted: analysis.is_distracted,
            is_drowsy: analysis.is_drowsy,
            is_yawning: analysis.is_yawning,
            seatbelt_state: SeatbeltState::Unknown,
        }
    }

    pub fn analyze_with_event(&mut self, landmarks: &[Point3D], timestamp: i64) -> (DmsAnalysis, Option<DmsEvent>) {
        let copilot_landmarks: Vec<CopilotPoint3D> = landmarks.iter().map(CopilotPoint3D::from).collect();
        let (analysis, event) = self.monitor.analyze(&copilot_landmarks, timestamp);

        let dms_analysis = DmsAnalysis {
            ear_left: analysis.ear_left,
            ear_right: analysis.ear_right,
            mar: analysis.mar,
            drowsiness_score: analysis.drowsiness_score,
            yawning_score: analysis.yawning_score,
            head_pose: HeadPose::from(analysis.head_pose),
            is_distracted: analysis.is_distracted,
            is_drowsy: analysis.is_drowsy,
            is_yawning: analysis.is_yawning,
            seatbelt_state: SeatbeltState::Unknown,
        };

        (dms_analysis, event.map(DmsEvent::from))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dms_engine_copilot_integration() {
        let mut engine = DmsEngine::new();
        let mut landmarks = vec![Point3D { x: 0.0, y: 0.0, z: 0.0 }; 468];

        // Setup eyes (open)
        landmarks[362] = Point3D { x: 10.0, y: 10.0, z: 0.0 };
        landmarks[263] = Point3D { x: 20.0, y: 10.0, z: 0.0 };
        landmarks[385] = Point3D { x: 13.0, y: 12.0, z: 0.0 };
        landmarks[380] = Point3D { x: 13.0, y: 8.0, z: 0.0 };
        landmarks[387] = Point3D { x: 17.0, y: 12.0, z: 0.0 };
        landmarks[373] = Point3D { x: 17.0, y: 8.0, z: 0.0 };

        let result = engine.analyze(&landmarks);
        assert!(!result.is_drowsy);
        assert!(!result.is_distracted);
    }
}
