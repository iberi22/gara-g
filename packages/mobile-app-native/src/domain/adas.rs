use serde::{Deserialize, Serialize};

/// Levels of warning for ADAS features (FCW, etc.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum WarningLevel {
    None,
    Advisory,
    Warning,
    Critical,
}

/// Bounding box for detected objects in ADAS
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct BoundingBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// Detected object from ADAS engine
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetectedObject {
    pub class: String,
    pub confidence: f32,
    pub bbox: BoundingBox,
}

/// Configuration for the ADAS engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdasConfig {
    pub model_path: String,
    pub confidence_threshold: f32,
    pub nms_threshold: f32,
    pub input_width: u32,
    pub input_height: u32,
}

impl Default for AdasConfig {
    fn default() -> Self {
        Self {
            model_path: "assets/models/yolov8n.onnx".to_string(),
            confidence_threshold: 0.25,
            nms_threshold: 0.45,
            input_width: 640,
            input_height: 640,
        }
    }
}
