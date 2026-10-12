use crate::domain::adas::{BoundingBox, DetectedObject};
use crate::infrastructure::adas_engine_config::AdasEngineConfig;
use ndarray::{Array, s, ArrayViewD, Ix1, ArrayView, IxDyn};
use ort::session::{Session, builder::SessionBuilder};
use ort::value::Value;
use std::sync::Mutex;

pub struct AdasEngine {
    config: AdasEngineConfig,
    session: Option<Mutex<Session>>,
    class_names: Vec<String>,
}

impl AdasEngine {
    pub fn new(config: AdasEngineConfig) -> Result<Self, String> {
        let session = if std::path::Path::new(&config.model_path).exists() {
            Some(Mutex::new(SessionBuilder::new()
                .map_err(|e| e.to_string())?
                .commit_from_file(&config.model_path)
                .map_err(|e| e.to_string())?))
        } else {
            None
        };

        // Standard COCO classes for YOLOv8
        let class_names = vec![
            "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
            "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
            "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
            "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
            "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
            "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
            "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
            "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
            "hair drier", "toothbrush",
        ]
        .into_iter()
        .map(|s| s.to_string())
        .collect();

        Ok(Self {
            config,
            session,
            class_names,
        })
    }

    pub fn detect(&self, frame: &[u8]) -> Vec<DetectedObject> {
        let mut session = match &self.session {
            Some(s) => s.lock().unwrap(),
            None => return Vec::new(),
        };

        // 1. Preprocessing
        let input_array = match self.preprocess(frame) {
            Ok(t) => t,
            Err(_) => return Vec::new(),
        };

        let input_tensor = match Value::from_array(input_array) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };

        // 2. Inference
        // In this version of ort, inputs! macro returns [SessionInputValue; N]
        let inputs = ort::inputs![input_tensor];
        let outputs = match session.run(inputs) {
            Ok(o) => o,
            Err(_) => return Vec::new(),
        };

        let output_tensor = match outputs[0].try_extract_tensor::<f32>() {
            Ok(t) => t,
            Err(_) => return Vec::new(),
        };

        // 3. Postprocessing
        let (shape, data) = output_tensor;
        let shape_vec: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
        let view = ArrayView::from_shape(IxDyn(&shape_vec), data).unwrap();
        self.postprocess(view).unwrap_or_default()
    }

    fn preprocess(&self, frame: &[u8]) -> Result<Array<f32, ndarray::Ix4>, String> {
        let width = self.config.input_width as usize;
        let height = self.config.input_height as usize;
        let channels = 3;

        if frame.len() != width * height * channels {
             return Err(format!("Invalid frame size: expected {}, got {}", width * height * channels, frame.len()));
        }

        let mut input = Array::zeros((1, channels, height, width));

        for c in 0..channels {
            for y in 0..height {
                for x in 0..width {
                    let pixel_idx = (y * width + x) * channels + c;
                    input[[0, c, y, x]] = frame[pixel_idx] as f32 / 255.0;
                }
            }
        }

        Ok(input)
    }

    fn postprocess(&self, output: ArrayViewD<f32>) -> Result<Vec<DetectedObject>, String> {
        // YOLOv8 output: [1, 84, 8400]
        let output = output.slice(s![0, .., ..]); // [84, 8400]
        let mut candidates = Vec::new();

        let num_anchors = output.shape()[1];
        let num_elements = output.shape()[0];

        for i in 0..num_anchors {
            let col = output.slice(s![.., i]);
            // Convert to Ix1 explicitly to ensure compatibility with ndarray methods
            let col = col.into_dimensionality::<Ix1>().map_err(|e| e.to_string())?;

            // Extract confidence and class
            let x_center = *col.get(0).ok_or("Invalid output format")?;
            let y_center = *col.get(1).ok_or("Invalid output format")?;
            let w = *col.get(2).ok_or("Invalid output format")?;
            let h = *col.get(3).ok_or("Invalid output format")?;

            let mut max_score = 0.0f32;
            let mut class_id = 0;

            // Classes start from index 4
            for idx in 4..num_elements {
                let score = *col.get(idx).ok_or("Invalid output format")?;
                if score > max_score {
                    max_score = score;
                    class_id = idx - 4;
                }
            }

            if max_score > self.config.confidence_threshold {
                let x = x_center - w / 2.0;
                let y = y_center - h / 2.0;

                candidates.push(DetectedObject {
                    class: self.class_names.get(class_id).cloned().unwrap_or_else(|| "unknown".to_string()),
                    confidence: max_score,
                    bbox: BoundingBox { x, y, w, h },
                });
            }
        }

        // Apply NMS
        let results = self.non_max_suppression(candidates, self.config.nms_threshold);

        Ok(results)
    }

    pub fn non_max_suppression(&self, mut candidates: Vec<DetectedObject>, iou_threshold: f32) -> Vec<DetectedObject> {
        candidates.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

        let mut kept = Vec::new();
        let mut ignored = vec![false; candidates.len()];

        for i in 0..candidates.len() {
            if ignored[i] {
                continue;
            }

            let best = &candidates[i];
            kept.push(best.clone());

            for j in i + 1..candidates.len() {
                if ignored[j] {
                    continue;
                }

                if self.calculate_iou(&best.bbox, &candidates[j].bbox) > iou_threshold {
                    ignored[j] = true;
                }
            }
        }

        kept
    }

    fn calculate_iou(&self, box1: &BoundingBox, box2: &BoundingBox) -> f32 {
        let x1 = box1.x.max(box2.x);
        let y1 = box1.y.max(box2.y);
        let x2 = (box1.x + box1.w).min(box2.x + box2.w);
        let y2 = (box1.y + box1.h).min(box2.y + box2.h);

        let intersection_w = (x2 - x1).max(0.0);
        let intersection_h = (y2 - y1).max(0.0);
        let intersection_area = intersection_w * intersection_h;

        let area1 = box1.w * box1.h;
        let area2 = box2.w * box2.h;
        let union_area = area1 + area2 - intersection_area;

        if union_area <= 0.0 {
            0.0
        } else {
            intersection_area / union_area
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::adas_engine_config::AdasEngineConfig;

    #[test]
    fn test_nms() {
        let config = AdasEngineConfig::default();
        let engine = AdasEngine::new(config).unwrap();

        let obj1 = DetectedObject {
            class: "car".to_string(),
            confidence: 0.9,
            bbox: BoundingBox { x: 100.0, y: 100.0, w: 50.0, h: 50.0 },
        };
        let obj2 = DetectedObject {
            class: "car".to_string(),
            confidence: 0.8,
            bbox: BoundingBox { x: 110.0, y: 110.0, w: 50.0, h: 50.0 }, // High overlap with obj1
        };
        let obj3 = DetectedObject {
            class: "person".to_string(),
            confidence: 0.7,
            bbox: BoundingBox { x: 300.0, y: 300.0, w: 20.0, h: 40.0 }, // No overlap
        };

        let candidates = vec![obj1.clone(), obj2, obj3.clone()];
        let results = engine.non_max_suppression(candidates, 0.5);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0], obj1);
        assert_eq!(results[1], obj3);
    }

    #[test]
    fn test_iou() {
        let config = AdasEngineConfig::default();
        let engine = AdasEngine::new(config).unwrap();

        let box1 = BoundingBox { x: 0.0, y: 0.0, w: 100.0, h: 100.0 };
        let box2 = BoundingBox { x: 50.0, y: 50.0, w: 100.0, h: 100.0 };

        let iou = engine.calculate_iou(&box1, &box2);
        assert!((iou - 0.142857).abs() < 0.0001);
    }

    #[test]
    fn test_postprocess_parsing() {
        let config = AdasEngineConfig {
            confidence_threshold: 0.5,
            ..Default::default()
        };
        let engine = AdasEngine::new(config).unwrap();

        // Create a mock output tensor [1, 84, 8400]
        let mut data = Array::zeros((1, 84, 8400));

        // Anchor 0: Car at (100, 100, 50, 50) with 0.9 confidence
        data[[0, 0, 0]] = 100.0; // x_center
        data[[0, 1, 0]] = 100.0; // y_center
        data[[0, 2, 0]] = 50.0;  // w
        data[[0, 3, 0]] = 50.0;  // h
        data[[0, 4 + 2, 0]] = 0.9; // car class is index 2 in COCO

        let detections = engine.postprocess(data.view().into_dyn()).unwrap();
        assert_eq!(detections.len(), 1);
        assert_eq!(detections[0].class, "car");
        assert_eq!(detections[0].confidence, 0.9);
        assert_eq!(detections[0].bbox.x, 75.0); // 100 - 50/2
        assert_eq!(detections[0].bbox.y, 75.0); // 100 - 50/2
    }
}
