//! Standalone test runner for ADAS YOLOv8 engine.
//!
//! This exists because `cargo test` on the full crate fails due to a
//! pre-existing build issue with `espeak-rs-sys` (missing espeak-ng C library).
//! Run with: cargo test --no-default-features --test adas_tests

use native::domain::adas::*;
use native::infrastructure::adas_engine::*;

// ── Helper ──────────────────────────────────────────────────────────────────

fn make_test_config() -> AdasConfig {
    AdasConfig {
        confidence_threshold: 0.5,
        nms_iou_threshold: 0.45,
        model_path: None,
        input_width: 640,
        input_height: 640,
    }
}

// ── Preprocess Tests ────────────────────────────────────────────────────────

#[test]
fn test_preprocess_resize() {
    let config = make_test_config();
    let engine = AdasEngine::new(config).unwrap();

    // 1920x1080 synthetic RGB frame (solid gray)
    let (w, h) = (1920u32, 1080u32);
    let frame = vec![128u8; (w * h * 3) as usize];
    let tensor = engine.preprocess_internal(&frame, w, h);

    assert_eq!(tensor.len(), 3 * 640 * 640, "tensor should be 3x640x640");

    for &v in &tensor {
        assert!((v - 128.0 / 255.0).abs() < 0.01,
            "expected ~0.502 for gray input, got {v}");
    }
}

#[test]
fn test_preprocess_aspect_ratio() {
    let config = make_test_config();
    let engine = AdasEngine::new(config).unwrap();

    // Portrait: 1080x1920
    let (w, h) = (1080u32, 1920u32);
    let frame = vec![255u8; (w * h * 3) as usize];
    let tensor = engine.preprocess_internal(&frame, w, h);

    assert_eq!(tensor.len(), 3 * 640 * 640);
    for &v in &tensor {
        assert!(v >= 0.0 && v <= 1.0, "value {v} out of range [0,1]");
    }
}

// ── Postprocess Tests ───────────────────────────────────────────────────────

#[test]
fn test_postprocess_parse() {
    let config = make_test_config();
    let engine = AdasEngine::new(config).unwrap();

    let output = engine.mock_inference_internal();
    let objects = engine.postprocess_internal(&output);

    assert!(!objects.is_empty(), "should find at least some detections");
    assert!(objects.len() <= 5, "at most 5 synthetic detections");

    for obj in &objects {
        assert!(obj.confidence >= config.confidence_threshold,
            "detection {:.3} below threshold {}", obj.confidence, config.confidence_threshold);
        assert!(obj.bbox.w > 0.0 && obj.bbox.h > 0.0);
        assert!(obj.bbox.x >= 0.0 && obj.bbox.x <= 1.0);
        assert!(obj.bbox.y >= 0.0 && obj.bbox.y <= 1.0);
    }

    let has_car = objects.iter().any(|o| o.class_id == 2 && o.confidence > 0.8);
    assert!(has_car, "should detect at least one car (class 2)");
}

// ── NMS Tests ───────────────────────────────────────────────────────────────

#[test]
fn test_nms_overlap() {
    let config = make_test_config();
    let engine = AdasEngine::new(config).unwrap();

    let mut objects = vec![
        DetectedObject {
            class_id: 2, class_name: "car".to_string(), confidence: 0.9,
            bbox: BoundingBox { x: 0.5, y: 0.5, w: 0.4, h: 0.4 },
        },
        DetectedObject {
            class_id: 2, class_name: "car".to_string(), confidence: 0.8,
            bbox: BoundingBox { x: 0.55, y: 0.5, w: 0.4, h: 0.4 },
        },
    ];

    let iou = AdasEngine::iou_static(&objects[0].bbox, &objects[1].bbox);
    assert!(iou > 0.5, "IoU should be high, got {iou}");

    engine.nms_internal(&mut objects);
    assert_eq!(objects.len(), 1, "NMS should keep only one detection");
    assert_eq!(objects[0].confidence, 0.9, "higher confidence should survive");
}

#[test]
fn test_nms_different_classes() {
    let config = make_test_config();
    let engine = AdasEngine::new(config).unwrap();

    let mut objects = vec![
        DetectedObject {
            class_id: 2, class_name: "car".to_string(), confidence: 0.9,
            bbox: BoundingBox { x: 0.5, y: 0.5, w: 0.4, h: 0.4 },
        },
        DetectedObject {
            class_id: 0, class_name: "person".to_string(), confidence: 0.85,
            bbox: BoundingBox { x: 0.52, y: 0.5, w: 0.35, h: 0.35 },
        },
    ];

    let before = objects.len();
    engine.nms_internal(&mut objects);
    assert_eq!(objects.len(), before, "NMS per-class should keep different classes");
}

// ── Full pipeline tests ─────────────────────────────────────────────────────

#[test]
fn test_detect_empty_frame() {
    let config = make_test_config();
    let engine = AdasEngine::new(config).unwrap();

    let (w, h) = (640u32, 640u32);
    let frame = vec![255u8; (w * h * 3) as usize];
    let result = engine.detect(&frame, w, h);
    assert!(result.is_ok(), "detect should succeed with valid frame");
    let objects = result.unwrap();
    assert!(objects.len() <= 5, "at most 5 detections from mock backend");
}

#[test]
fn test_detect_frame_size_mismatch() {
    let config = make_test_config();
    let engine = AdasEngine::new(config).unwrap();

    let frame = vec![0u8; 100];
    let result = engine.detect(&frame, 640, 640);
    assert!(result.is_err(), "should error on mismatched frame size");
}
