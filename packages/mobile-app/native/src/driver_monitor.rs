use serde::{Deserialize, Serialize};

/// Represents a 3D landmark point from offline MediaPipe face mesh analysis.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Point3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Represents the estimated head pose of the driver in degrees.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeadPose {
    pub pitch: f32, // Pitch (looking up/down)
    pub yaw: f32,   // Yaw (looking left/right)
    pub roll: f32,  // Roll (tilting head left/right)
}

/// Severity classification of a driver monitoring event.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DmsEventSeverity {
    Info,
    Warning,
    Critical,
}

/// Event detected by the Driver Monitoring System (DMS).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DmsEvent {
    pub id: String,
    pub event_type: String, // "drowsiness", "distraction", "yawning", "nominal"
    pub severity: DmsEventSeverity,
    pub message: String,
    pub timestamp: i64,
}

/// Full state analysis report from a single frame/cycle.
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
}

/// Core Driver Monitoring System (DMS) engine.
pub struct DriverMonitor {
    pub ear_threshold: f32,
    pub mar_threshold: f32,
    pub yaw_threshold: f32,
    pub pitch_threshold: f32,
    pub consecutive_drowsy_frames: u32,
    pub consecutive_distracted_frames: u32,
    pub drowsiness_trigger_limit: u32,
    pub distraction_trigger_limit: u32,
}

impl DriverMonitor {
    /// Creates a new DriverMonitor with default optimized thresholds.
    pub fn new() -> Self {
        Self {
            ear_threshold: 0.22,
            mar_threshold: 0.50,
            yaw_threshold: 25.0,
            pitch_threshold: 18.0,
            consecutive_drowsy_frames: 0,
            consecutive_distracted_frames: 0,
            drowsiness_trigger_limit: 5,
            distraction_trigger_limit: 4,
        }
    }

    /// Calculates the distance between two 3D points.
    pub fn distance(&self, p1: &Point3D, p2: &Point3D) -> f32 {
        ((p1.x - p2.x).powi(2) + (p1.y - p2.y).powi(2) + (p1.z - p2.z).powi(2)).sqrt()
    }

    /// Calculates Eye Aspect Ratio (EAR) given 6 landmarks of an eye.
    /// Landmark arrangement:
    ///   0: Left corner
    ///   1: Top-left
    ///   2: Top-right
    ///   3: Right corner
    ///   4: Bottom-right
    ///   5: Bottom-left
    pub fn calculate_ear(&self, eye: &[Point3D]) -> f32 {
        if eye.len() < 6 {
            return 0.3; // Default nominal EAR
        }
        let v1 = self.distance(&eye[1], &eye[5]);
        let v2 = self.distance(&eye[2], &eye[4]);
        let h = self.distance(&eye[0], &eye[3]);

        if h == 0.0 {
            return 0.0;
        }
        (v1 + v2) / (2.0 * h)
    }

    /// Calculates Mouth Aspect Ratio (MAR) given 8 landmarks of the mouth.
    /// Landmark arrangement:
    ///   0: Left corner
    ///   1: Top-inner-left
    ///   2: Top-inner-mid
    ///   3: Top-inner-right
    ///   4: Right corner
    ///   5: Bottom-inner-right
    ///   6: Bottom-inner-mid
    ///   7: Bottom-inner-left
    pub fn calculate_mar(&self, mouth: &[Point3D]) -> f32 {
        if mouth.len() < 8 {
            return 0.0;
        }
        let v1 = self.distance(&mouth[1], &mouth[7]);
        let v2 = self.distance(&mouth[2], &mouth[6]);
        let v3 = self.distance(&mouth[3], &mouth[5]);
        let h = self.distance(&mouth[0], &mouth[4]);

        if h == 0.0 {
            return 0.0;
        }
        (v1 + v2 + v3) / (2.0 * h)
    }

    /// Heuristically estimates the head pose using face landmarks.
    pub fn estimate_head_pose(&self, landmarks: &[Point3D]) -> HeadPose {
        if landmarks.len() < 5 {
            return HeadPose { pitch: 0.0, yaw: 0.0, roll: 0.0 };
        }

        // Landmark heuristic mapping:
        // Top forehead: 10, Nose tip: 4, Chin: 152, Leftmost face edge: 234, Rightmost face edge: 454
        let top = landmarks.get(10).unwrap_or(&landmarks[0]);
        let nose = landmarks.get(4).unwrap_or(&landmarks[0]);
        let chin = landmarks.get(152).unwrap_or(&landmarks[0]);
        let left = landmarks.get(234).unwrap_or(&landmarks[0]);
        let right = landmarks.get(454).unwrap_or(&landmarks[0]);

        // Yaw estimation: distance from nose to left/right bounds relative to total width
        let face_width = (right.x - left.x).abs();
        let face_center_x = (left.x + right.x) / 2.0;
        let yaw = if face_width > 0.0 {
            ((nose.x - face_center_x) / face_width) * 90.0
        } else {
            0.0
        };

        // Pitch estimation: nose position relative to vertical center of face
        let face_height = (chin.y - top.y).abs();
        let face_center_y = (top.y + chin.y) / 2.0;
        let pitch = if face_height > 0.0 {
            ((nose.y - face_center_y) / face_height) * 90.0
        } else {
            0.0
        };

        HeadPose { pitch, yaw, roll: 0.0 }
    }

    /// Analyzes the full suite of landmarks to estimate drowsiness, distraction, yawning, and generate events.
    pub fn analyze(&mut self, landmarks: &[Point3D], timestamp: i64) -> (DmsAnalysis, Option<DmsEvent>) {
        // MediaPipe indices:
        // Left Eye: 362, 385, 387, 263, 373, 380
        let ear_left = if landmarks.len() > 387 {
            self.calculate_ear(&[
                landmarks[362].clone(), landmarks[385].clone(), landmarks[387].clone(),
                landmarks[263].clone(), landmarks[373].clone(), landmarks[380].clone()
            ])
        } else {
            0.28
        };

        // Right Eye: 33, 160, 158, 133, 153, 144
        // Properly aligned vertical pairs: (160, 153) and (158, 144)
        let ear_right = if landmarks.len() > 160 {
            self.calculate_ear(&[
                landmarks[33].clone(), landmarks[160].clone(), landmarks[158].clone(),
                landmarks[133].clone(), landmarks[144].clone(), landmarks[153].clone()
            ])
        } else {
            0.28
        };

        // Mouth: 78, 81, 13, 311, 308, 402, 14, 178
        let mar = if landmarks.len() > 402 {
            self.calculate_mar(&[
                landmarks[78].clone(), landmarks[81].clone(), landmarks[13].clone(),
                landmarks[311].clone(), landmarks[308].clone(), landmarks[402].clone(),
                landmarks[14].clone(), landmarks[178].clone()
            ])
        } else {
            0.15
        };

        let head_pose = self.estimate_head_pose(landmarks);

        // Core boolean evaluations
        let is_drowsy_frame = ear_left < self.ear_threshold && ear_right < self.ear_threshold;
        let is_distracted_frame = head_pose.yaw.abs() > self.yaw_threshold || head_pose.pitch.abs() > self.pitch_threshold;
        let is_yawning = mar > self.mar_threshold;

        // Drowsiness temporal debouncer
        if is_drowsy_frame {
            self.consecutive_drowsy_frames += 1;
        } else {
            if self.consecutive_drowsy_frames > 0 {
                self.consecutive_drowsy_frames -= 1;
            }
        }

        // Distraction temporal debouncer
        if is_distracted_frame {
            self.consecutive_distracted_frames += 1;
        } else {
            if self.consecutive_distracted_frames > 0 {
                self.consecutive_distracted_frames -= 1;
            }
        }

        let is_drowsy = self.consecutive_drowsy_frames >= self.drowsiness_trigger_limit;
        let is_distracted = self.consecutive_distracted_frames >= self.distraction_trigger_limit;

        // Generate events based on detected states
        let mut event = None;
        if is_drowsy {
            event = Some(DmsEvent {
                id: format!("dms_drowsy_{}", timestamp),
                event_type: "drowsiness".to_string(),
                severity: DmsEventSeverity::Critical,
                message: "Critical Warning: Driver drowsiness detected! Wake up!".to_string(),
                timestamp,
            });
        } else if is_distracted {
            event = Some(DmsEvent {
                id: format!("dms_distract_{}", timestamp),
                event_type: "distraction".to_string(),
                severity: DmsEventSeverity::Warning,
                message: "Warning: Driver distraction detected. Keep eyes on road.".to_string(),
                timestamp,
            });
        } else if is_yawning {
            event = Some(DmsEvent {
                id: format!("dms_yawn_{}", timestamp),
                event_type: "yawning".to_string(),
                severity: DmsEventSeverity::Info,
                message: "Driver is yawning. Consider a rest break.".to_string(),
                timestamp,
            });
        }

        let drowsiness_score = (1.0 - ((ear_left + ear_right) / 2.0) / 0.3).max(0.0).min(1.0);
        let yawning_score = (mar / 0.8).max(0.0).min(1.0);

        let analysis = DmsAnalysis {
            ear_left,
            ear_right,
            mar,
            drowsiness_score,
            yawning_score,
            head_pose,
            is_distracted,
            is_drowsy,
            is_yawning,
        };

        (analysis, event)
    }
}
