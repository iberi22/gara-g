/// Configuration for the ADAS engine
#[derive(Debug, Clone)]
pub struct AdasEngineConfig {
    pub model_path: String,
    pub confidence_threshold: f32,
    pub nms_threshold: f32,
    pub input_width: u32,
    pub input_height: u32,
}

impl Default for AdasEngineConfig {
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
