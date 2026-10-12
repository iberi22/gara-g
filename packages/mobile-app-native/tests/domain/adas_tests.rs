use native::domain::adas::{AdasConfig, BoundingBox, DetectedObject, WarningLevel};

#[test]
fn test_config_defaults() {
    let config = AdasConfig::default();
    assert_eq!(config.model_path, "assets/models/yolov8n.onnx");
    assert_eq!(config.confidence_threshold, 0.25);
    assert_eq!(config.nms_threshold, 0.45);
    assert_eq!(config.input_width, 640);
    assert_eq!(config.input_height, 640);
}

#[test]
fn test_config_serde_roundtrip() {
    let config = AdasConfig::default();
    let json = serde_json::to_string(&config).expect("serialize AdasConfig");
    let back: AdasConfig = serde_json::from_str(&json).expect("deserialize AdasConfig");
    assert_eq!(back.model_path, config.model_path);
    assert_eq!(back.nms_threshold, config.nms_threshold);
    assert_eq!(back.input_width, config.input_width);
}

#[test]
fn test_bbox_construction_and_eq() {
    let bbox = BoundingBox {
        x: 0.5,
        y: 0.5,
        w: 0.3,
        h: 0.4,
    };
    let same = BoundingBox {
        x: 0.5,
        y: 0.5,
        w: 0.3,
        h: 0.4,
    };
    assert_eq!(bbox, same);
    let other = BoundingBox {
        x: 0.1,
        ..bbox
    };
    assert_ne!(bbox, other);
}

#[test]
fn test_detected_object_creation() {
    let obj = DetectedObject {
        class: "car".to_string(),
        confidence: 0.95,
        bbox: BoundingBox {
            x: 0.5,
            y: 0.5,
            w: 0.3,
            h: 0.4,
        },
    };
    assert_eq!(obj.class, "car");
    assert!((obj.confidence - 0.95).abs() < 1e-6);
    assert_eq!(obj.bbox.x, 0.5);
    assert_eq!(obj.bbox.h, 0.4);
}

#[test]
fn test_detected_object_serde_roundtrip() {
    let obj = DetectedObject {
        class: "person".to_string(),
        confidence: 0.88,
        bbox: BoundingBox {
            x: 0.1,
            y: 0.2,
            w: 0.4,
            h: 0.6,
        },
    };
    let json = serde_json::to_string(&obj).expect("serialize DetectedObject");
    let back: DetectedObject = serde_json::from_str(&json).expect("deserialize DetectedObject");
    assert_eq!(back, obj);
}

#[test]
fn test_warning_level_ordering() {
    assert!(WarningLevel::None < WarningLevel::Advisory);
    assert!(WarningLevel::Advisory < WarningLevel::Warning);
    assert!(WarningLevel::Warning < WarningLevel::Critical);
    assert_eq!(
        vec![
            WarningLevel::Critical,
            WarningLevel::None,
            WarningLevel::Warning,
            WarningLevel::Advisory
        ]
        .into_iter()
        .min(),
        Some(WarningLevel::None)
    );
}