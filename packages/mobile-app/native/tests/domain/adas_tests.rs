use native::domain::adas::{AdasConfig, BoundingBox, DetectedObject, COCO_CLASSES};

#[test]
fn test_coco_classes_count() {
    assert_eq!(COCO_CLASSES.len(), 80);
}

#[test]
fn test_coco_first_and_last() {
    assert_eq!(COCO_CLASSES[0], "person");
    assert_eq!(COCO_CLASSES[79], "toothbrush");
}

#[test]
fn test_config_defaults() {
    let config = AdasConfig::default();
    assert_eq!(config.confidence_threshold, 0.5);
    assert_eq!(config.nms_iou_threshold, 0.45);
    assert!(config.model_path.is_none());
    assert_eq!(config.input_width, 640);
    assert_eq!(config.input_height, 640);
}

#[test]
fn test_bbox_default() {
    let bbox = BoundingBox::default();
    assert_eq!(bbox.x, 0.0);
    assert_eq!(bbox.y, 0.0);
    assert_eq!(bbox.w, 0.0);
    assert_eq!(bbox.h, 0.0);
}

#[test]
fn test_detected_object_default() {
    let obj = DetectedObject::default();
    assert_eq!(obj.class_id, 0);
    assert!(obj.class_name.is_empty());
    assert_eq!(obj.confidence, 0.0);
    assert_eq!(obj.bbox, BoundingBox::default());
}

#[test]
fn test_detected_object_creation() {
    let obj = DetectedObject {
        class_id: 2,
        class_name: "car".to_string(),
        confidence: 0.95,
        bbox: BoundingBox {
            x: 0.5,
            y: 0.5,
            w: 0.3,
            h: 0.4,
        },
    };
    assert_eq!(obj.class_id, 2);
    assert_eq!(obj.class_name, "car");
    assert!((obj.confidence - 0.95).abs() < 1e-6);
    assert_eq!(obj.bbox.x, 0.5);
}
