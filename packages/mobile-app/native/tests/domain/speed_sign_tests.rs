use native::domain::speed_sign::{SpeedSignDetector, DetectedObject, SignType};

#[test]
fn test_speed_limit_start_extraction() {
    let detector = SpeedSignDetector::new();
    let objects = vec![
        DetectedObject {
            label: "speed_limit_60".to_string(),
            confidence: 0.92,
            bbox: [0.5, 0.5, 0.2, 0.3],
            metadata: None,
        },
    ];

    let signs = detector.process(&objects);
    assert_eq!(signs.len(), 1);
    assert_eq!(signs[0].value_kmh, 60);
    assert_eq!(signs[0].sign_type, SignType::LimitStart);
    assert!((signs[0].confidence - 0.92).abs() < 1e-6);
}

#[test]
fn test_speed_limit_end_extraction() {
    let detector = SpeedSignDetector::new();
    let objects = vec![
        DetectedObject {
            label: "speed_limit_end".to_string(),
            confidence: 0.85,
            bbox: [0.5, 0.5, 0.2, 0.3],
            metadata: None,
        },
    ];

    let signs = detector.process(&objects);
    assert_eq!(signs.len(), 1);
    assert_eq!(signs[0].value_kmh, 0);
    assert_eq!(signs[0].sign_type, SignType::LimitEnd);
}

#[test]
fn test_other_sign_types() {
    let detector = SpeedSignDetector::new();
    let objects = vec![
        DetectedObject {
            label: "stop_sign".to_string(),
            confidence: 0.90,
            bbox: [0.3, 0.7, 0.15, 0.25],
            metadata: None,
        },
        DetectedObject {
            label: "no_entry".to_string(),
            confidence: 0.88,
            bbox: [0.8, 0.3, 0.1, 0.2],
            metadata: None,
        },
        DetectedObject {
            label: "no_overtake".to_string(),
            confidence: 0.82,
            bbox: [0.6, 0.4, 0.12, 0.22],
            metadata: None,
        },
    ];

    let signs = detector.process(&objects);
    assert_eq!(signs.len(), 3);
    assert_eq!(signs[0].sign_type, SignType::Stop);
    assert_eq!(signs[1].sign_type, SignType::NoEntry);
    assert_eq!(signs[2].sign_type, SignType::NoOvertake);
}

#[test]
fn test_low_confidence_filtering() {
    let detector = SpeedSignDetector::new();
    let objects = vec![
        DetectedObject {
            label: "speed_limit_50".to_string(),
            confidence: 0.35, // threshold is 0.4
            bbox: [0.5, 0.5, 0.2, 0.3],
            metadata: None,
        },
    ];

    let signs = detector.process(&objects);
    assert!(signs.is_empty());
}

#[test]
fn test_malformed_label() {
    let detector = SpeedSignDetector::new();
    let objects = vec![
        DetectedObject {
            label: "speed_limit_notanumber".to_string(),
            confidence: 0.9,
            bbox: [0.5, 0.5, 0.2, 0.3],
            metadata: None,
        },
        DetectedObject {
            label: "unknown_label".to_string(),
            confidence: 0.9,
            bbox: [0.5, 0.5, 0.2, 0.3],
            metadata: None,
        },
    ];

    let signs = detector.process(&objects);
    assert!(signs.is_empty());
}

#[test]
fn test_empty_input() {
    let detector = SpeedSignDetector::new();
    let signs = detector.process(&[]);
    assert!(signs.is_empty());
}
