use native::ai_processor::{BoundingBox, Detection};
use native::domain::speed_sign::{SignType, SpeedSignDetector};

#[test]
fn test_speed_limit_extraction_with_value() {
    let detections = vec![
        Detection {
            label: "speed_limit_50".to_string(),
            confidence: 0.95,
            bbox: None,
        },
        Detection {
            label: "limit_30".to_string(),
            confidence: 0.8,
            bbox: None,
        },
    ];

    let signs = SpeedSignDetector::extract_signs(&detections);
    assert_eq!(signs.len(), 2);
    assert_eq!(signs[0].value, 50);
    assert_eq!(signs[0].sign_type, SignType::SpeedLimit);
    assert!((signs[0].confidence - 0.95).abs() < 1e-6);
    assert_eq!(signs[1].value, 30);
    assert_eq!(signs[1].sign_type, SignType::SpeedLimit);
}

#[test]
fn test_stop_sign_extraction() {
    let detections = vec![Detection {
        label: "stop_sign".to_string(),
        confidence: 0.9,
        bbox: Some(BoundingBox {
            x: 0.3,
            y: 0.7,
            width: 0.15,
            height: 0.25,
        }),
    }];

    let signs = SpeedSignDetector::extract_signs(&detections);
    assert_eq!(signs.len(), 1);
    assert_eq!(signs[0].sign_type, SignType::Stop);
    assert_eq!(signs[0].value, 0);
}

#[test]
fn test_non_sign_detections_are_filtered() {
    let detections = vec![
        Detection {
            label: "car".to_string(),
            confidence: 0.9,
            bbox: None,
        },
        Detection {
            label: "pedestrian".to_string(),
            confidence: 0.85,
            bbox: None,
        },
    ];

    let signs = SpeedSignDetector::extract_signs(&detections);
    assert!(signs.is_empty());
}

#[test]
fn test_malformed_label_without_digits_is_filtered() {
    let detections = vec![
        Detection {
            label: "speed_limit_invalid".to_string(),
            confidence: 0.9,
            bbox: None,
        },
        Detection {
            label: "limit".to_string(),
            confidence: 0.9,
            bbox: None,
        },
    ];

    let signs = SpeedSignDetector::extract_signs(&detections);
    // "limit" contains "limit" but has no digits -> parse fails -> no sign
    assert!(signs.is_empty());
}

#[test]
fn test_empty_input() {
    let signs = SpeedSignDetector::extract_signs(&[]);
    assert!(signs.is_empty());
}