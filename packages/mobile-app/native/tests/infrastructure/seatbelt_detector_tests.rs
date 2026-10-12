use native::infrastructure::seatbelt_detector::{SeatbeltHeuristicDetector, SeatbeltStatus};
use native::domain::dms::Point3D;

fn fastened_keypoints() -> Vec<Point3D> {
    let mut kps = vec![Point3D { x: 0.0, y: 0.0, z: 0.0 }; 33];
    kps[11] = Point3D { x: 0.40, y: 0.35, z: 0.10 }; // left_shoulder
    kps[12] = Point3D { x: 0.60, y: 0.35, z: 0.10 }; // right_shoulder
    kps[23] = Point3D { x: 0.40, y: 0.60, z: 0.30 }; // left_hip
    kps[24] = Point3D { x: 0.60, y: 0.60, z: 0.30 }; // right_hip
    kps
}

#[test]
fn test_heuristic_fastened() {
    let detector = SeatbeltHeuristicDetector::new();
    let kps = fastened_keypoints();
    // Use analyze which returns SeatbeltState
    let state = detector.analyze(&kps);
    assert_eq!(state, native::domain::seatbelt::SeatbeltState::Buckled);
}

#[test]
fn test_no_person() {
    let detector = SeatbeltHeuristicDetector::new();
    let kps = vec![Point3D { x: 0.0, y: 0.0, z: 0.0 }; 33];
    let state = detector.analyze(&kps);
    assert_eq!(state, native::domain::seatbelt::SeatbeltState::Unknown); // DriverAbsent in status maps to Unknown in state for now
}

#[test]
fn test_too_few_keypoints() {
    let detector = SeatbeltHeuristicDetector::new();
    let kps = vec![Point3D { x: 0.0, y: 0.0, z: 0.0 }; 20];
    let state = detector.analyze(&kps);
    assert_eq!(state, native::domain::seatbelt::SeatbeltState::Unknown);
}

#[test]
fn test_analyze_with_confidence() {
    let detector = SeatbeltHeuristicDetector::new();
    let kps = vec![(0.40f32, 0.35f32, 0.10f32); 33];
    let (status, confidence) = detector.analyze_with_confidence(&kps);
    assert_eq!(status, SeatbeltStatus::Fastened);
    assert!(confidence >= 0.4);
}

#[test]
fn test_status_methods() {
    assert!(SeatbeltStatus::Fastened.is_fastened());
    assert!(SeatbeltStatus::Unfastened.is_unfastened());
    assert!(SeatbeltStatus::DriverAbsent.is_driver_absent());
}

#[test]
fn test_seatbelt_fastened_with_frame_integration() {
    let detector = SeatbeltHeuristicDetector::new();
    let landmarks = fastened_keypoints();
    let width = 100;
    let height = 100;
    let mut frame = vec![128u8; width * height * 3];

    // Draw a dark diagonal line (the belt)
    for i in 0..100 {
        let idx = (i * width + i) * 3;
        if idx + 2 < frame.len() {
            frame[idx] = 0;
            frame[idx+1] = 0;
            frame[idx+2] = 0;
        }
    }

    let (status, confidence) = detector.analyze_with_frame(&frame, width as u32, height as u32, &landmarks);
    assert_eq!(status, SeatbeltStatus::Fastened);
    assert!(confidence > 0.0);
}
