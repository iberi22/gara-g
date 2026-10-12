use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::domain::dms::{DmsEngine, DmsAnalysis, Point3D};
use crate::domain::seatbelt::SeatbeltState;
use crate::infrastructure::seatbelt_detector::SeatbeltHeuristicDetector;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProcessingMode {
    LocalHeuristics,
    OnnxModel,
    ExternalApi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Detection {
    pub label: String,
    pub confidence: f32,
    pub bbox: Option<BoundingBox>,
}

/// Bounding box for detected objects
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Audio event detection result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioEvent {
    pub label: String,
    pub confidence: f32,
    pub timestamp_ms: u64,
    pub is_alert: bool,
}

/// Analysis result combining vision and audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub detections: Vec<Detection>,
    pub events: Vec<AudioEvent>,
    pub alerts: Vec<String>,
    pub processing_mode: String,
    pub dms_status: Option<DmsAnalysis>,
}

pub struct AiProcessor {
    pub latest_frame: std::sync::Arc<std::sync::Mutex<Option<(Vec<u8>, u32, u32)>>>,
    mode: ProcessingMode,
    external_api_enabled: AtomicBool,
    api_key: Option<String>,
    // Frame analysis state
    prev_frame_brightness: f32,
    motion_threshold: f32,
    // Audio analysis state
    audio_energy_threshold: f32,
    // DMS engine
    dms_engine: DmsEngine,
    // Mock data for ONNX/external fallback
    mock_detections: Vec<Detection>,
    seatbelt_detector: SeatbeltHeuristicDetector,
}

impl AiProcessor {
    pub fn new() -> Self {
        AiProcessor {
            mode: ProcessingMode::LocalHeuristics,
            external_api_enabled: AtomicBool::new(false),
            latest_frame: std::sync::Arc::new(std::sync::Mutex::new(None)),
            api_key: None,
            prev_frame_brightness: 0.0,
            motion_threshold: 30.0,
            audio_energy_threshold: 0.5,
            dms_engine: DmsEngine::new(),
            mock_detections: vec![
                Detection {
                    label: "car".to_string(),
                    confidence: 0.92,
                    bbox: Some(BoundingBox { x: 0.2, y: 0.3, width: 0.4, height: 0.4 }),
                },
                Detection {
                    label: "pedestrian".to_string(),
                    confidence: 0.85,
                    bbox: Some(BoundingBox { x: 0.7, y: 0.5, width: 0.1, height: 0.3 }),
                },
            ],
            seatbelt_detector: SeatbeltHeuristicDetector::new(),
        }
    }

    /// Enable external API fallback (requires user consent)
    pub fn enable_external_api(&mut self, api_key: String) {
        self.api_key = Some(api_key);
        self.external_api_enabled.store(true, Ordering::SeqCst);
    }

    /// Disable external API
    pub fn disable_external_api(&mut self) {
        self.external_api_enabled.store(false, Ordering::SeqCst);
    }

    /// Analyze a video frame for objects and threats
    pub fn analyze_frame(&mut self, image_data: &[u8]) -> Result<String, String> {
        // Store frame for subsequent DMS analysis if needed.
        // In a real app we'd know the width/height. Assuming 640x480 for heuristics.
        {
            let mut guard = self.latest_frame.lock().unwrap();
            *guard = Some((image_data.to_vec(), 640, 480));
        }

        let mut result = AnalysisResult {
            detections: Vec::new(),
            events: Vec::new(),
            alerts: Vec::new(),
            processing_mode: "local_heuristics".to_string(),
            dms_status: None,
        };

        // === LOCAL HEURISTICS ===

        // 1. Calculate brightness
        let brightness = self.calculate_brightness(image_data);

        // 2. Motion detection (simple frame differencing if we had prev frame)
        if self.prev_frame_brightness > 0.0 {
            let diff = (brightness - self.prev_frame_brightness).abs();
            if diff > self.motion_threshold {
                result.events.push(AudioEvent {
                    label: "significant_motion".to_string(),
                    confidence: (diff / 100.0).min(1.0),
                    timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
                    is_alert: false,
                });
            }
        }
        self.prev_frame_brightness = brightness;

        // 3. Simple edge detection for large objects
        let edge_density = self.calculate_edge_density(image_data);
        if edge_density > 0.3 {
            result.detections.push(Detection {
                label: "high_visual_activity".to_string(),
                confidence: edge_density,
                bbox: None,
            });
        }

        // 4. Check for predominantly dark frame (possible obstruction)
        if brightness < 10.0 {
            result.alerts.push("🔴 Camera may be obstructed".to_string());
            result.detections.push(Detection {
                label: "possible_obstruction".to_string(),
                confidence: 0.9,
                bbox: None,
            });
        }

        // === ONNX MODEL (if enabled) ===
        #[cfg(feature = "onnx")]
        {
            if let Ok(onnx_detections) = self.run_onnx_detection(image_data) {
                result.detections.extend(onnx_detections);
                result.processing_mode = "onnx_model".to_string();
            }
        }

        // === EXTERNAL API FALLBACK ===
        // Only for complex scenes or when local detection confidence is low
        if self.external_api_enabled.load(Ordering::SeqCst)
           && result.detections.iter().all(|d| d.confidence < 0.5)
        {
            result.processing_mode = "hybrid_with_api_available".to_string();
        }

        serde_json::to_string(&result).map_err(|e| e.to_string())
    }

    /// Analyze audio buffer for safety-relevant sounds
    pub fn analyze_audio(&self, audio_data: &[u8]) -> Result<String, String> {
        let mut result = AnalysisResult {
            detections: Vec::new(),
            events: Vec::new(),
            alerts: Vec::new(),
            processing_mode: "local_heuristics".to_string(),
            dms_status: None,
        };

        // 1. Calculate audio energy (RMS)
        let energy = self.calculate_audio_energy(audio_data);

        // 2. Detect sudden loud sounds
        if energy > self.audio_energy_threshold {
            let event = AudioEvent {
                label: "loud_sound".to_string(),
                confidence: (energy / 1.0).min(1.0),
                timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
                is_alert: energy > 0.8,
            };

            if event.is_alert {
                result.alerts.push("🔊 Loud sound detected - possible emergency".to_string());
            }

            result.events.push(event);
        }

        serde_json::to_string(&result).map_err(|e| e.to_string())
    }

    // === HELPER METHODS ===

    fn calculate_brightness(&self, data: &[u8]) -> f32 {
        if data.is_empty() {
            return 0.0;
        }
        let sum: u64 = data.iter().map(|&b| b as u64).sum();
        (sum as f32) / (data.len() as f32)
    }

    fn calculate_edge_density(&self, data: &[u8]) -> f32 {
        if data.len() < 100 {
            return 0.0;
        }
        let mut edge_count = 0u32;
        for i in 1..data.len() {
            let diff = (data[i] as i32 - data[i-1] as i32).abs();
            if diff > 20 {
                edge_count += 1;
            }
        }
        (edge_count as f32) / (data.len() as f32)
    }

    fn calculate_audio_energy(&self, data: &[u8]) -> f32 {
        if data.is_empty() {
            return 0.0;
        }
        let sum_sq: f64 = data.iter()
            .map(|&b| {
                let normalized = (b as f64 - 128.0) / 128.0;
                normalized * normalized
            })
            .sum();
        (sum_sq / data.len() as f64).sqrt() as f32
    }

    /// Analyze Driver Monitoring System landmarks
    pub fn analyze_dms_landmarks(&mut self, landmarks: &[Point3D]) -> Result<String, String> {
        let mut dms_analysis = self.dms_engine.analyze(&landmarks);

        // Integrate real seatbelt detection if frame is available
        let latest_frame_guard = self.latest_frame.lock().unwrap();
        if let Some((frame, w, h)) = latest_frame_guard.as_ref() {
            if let (status, _) = self.seatbelt_detector.analyze_with_frame(frame, *w, *h, landmarks) { dms_analysis.seatbelt_state = match status { crate::infrastructure::seatbelt_detector::SeatbeltStatus::Fastened => crate::domain::seatbelt::SeatbeltState::Buckled, crate::infrastructure::seatbelt_detector::SeatbeltStatus::Unfastened => crate::domain::seatbelt::SeatbeltState::Unbuckled, _ => crate::domain::seatbelt::SeatbeltState::Unknown }; }
        } else {
            // Fallback to heuristic
            dms_analysis.seatbelt_state = self.seatbelt_detector.analyze(landmarks);
        }

        let mut result = AnalysisResult {
            detections: Vec::new(),
            events: Vec::new(),
            alerts: Vec::new(),
            processing_mode: "dms_engine".to_string(),
            dms_status: Some(dms_analysis.clone()),
        };

        if dms_analysis.is_drowsy {
            result.alerts.push("🥱 Drowsiness detected! Take a break.".to_string());
        }
        if dms_analysis.is_distracted {
            result.alerts.push("👀 Please keep your eyes on the road.".to_string());
        }
        if dms_analysis.is_yawning {
            result.alerts.push("🥱 Yawning detected. Fatigue warning.".to_string());
        }

        match dms_analysis.seatbelt_state {
            crate::domain::seatbelt::SeatbeltState::Unbuckled => {
                result.alerts.push("⚠️ Seatbelt unbuckled! Please fasten your seatbelt.".to_string());
            },
            _ => {}
        }

        serde_json::to_string(&result).map_err(|e| e.to_string())
    }

    fn detect_sustained_tone(&self, data: &[u8]) -> f32 {
        if data.len() < 200 {
            return 0.0;
        }
        // Check for periodic pattern (simplified autocorrelation)
        let chunk_size = 50;
        let chunks: Vec<f32> = data.chunks(chunk_size)
            .map(|chunk| self.calculate_audio_energy(chunk))
            .collect();

        if chunks.len() < 4 {
            return 0.0;
        }

        // Check energy variance - sustained tone has low variance
        let mean_energy: f32 = chunks.iter().sum::<f32>() / chunks.len() as f32;
        let variance: f32 = chunks.iter()
            .map(|&e| (e - mean_energy).powi(2))
            .sum::<f32>() / chunks.len() as f32;

        // Low variance + high energy = sustained tone
        if mean_energy > 0.3 && variance < 0.05 {
            1.0 - (variance * 10.0).min(1.0)
        } else {
            0.0
        }
    }

    // === ONNX RUNTIME (when feature enabled) ===

    #[cfg(feature = "onnx")]
    fn run_onnx_detection(&self, _image_data: &[u8]) -> Result<Vec<Detection>, String> {
        // TODO: Load and run YOLO-tiny or MobileNet ONNX model
        // This would use the `ort` crate for inference
        // For now, return empty as placeholder
        Ok(Vec::new())
    }
}

impl Default for AiProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_brightness_calculation() {
        let processor = AiProcessor::new();
        let dark = vec![10u8; 100];
        assert!(processor.calculate_brightness(&dark) < 20.0);
        let bright = vec![200u8; 100];
        assert!(processor.calculate_brightness(&bright) > 180.0);
    }

    #[test]
    fn test_audio_energy() {
        let processor = AiProcessor::new();
        let silent = vec![128u8; 100];
        assert!(processor.calculate_audio_energy(&silent) < 0.1);
        let loud: Vec<u8> = (0..100).map(|i| if i % 2 == 0 { 255 } else { 0 }).collect();
        assert!(processor.calculate_audio_energy(&loud) > 0.5);
    }
}
