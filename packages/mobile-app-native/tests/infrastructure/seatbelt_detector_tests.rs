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

fn fastened_tuples() -> Vec<(f32, f32, f32)> {
    fastened_keypoints().iter().map(|p| (p.x, p.y, p.z)).collect()
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
    let kps = fastened_tuples();
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
    let mut frame = vec![255u8; width * height * 3]; // WHITE background (max contrast)

    // Draw a 3px diagonal band downward from each sample point of the segment
    // left_shoulder(40,35) -> right_hip(60,60). The detector's Sobel kernel
    // needs the sampled pixel to be the TOP EDGE of the band (gray above,
    // black below) to produce a strong magnitude.
    for i in 0..=20 {
        let t = i as f32 / 20.0;
        let cx = (40.0 + 20.0 * t) as i32;
        let cy = (35.0 + 25.0 * t) as i32;
        for dy in 0..=2 {
            let y = cy + dy;
            if y < height as i32 {
                let idx = ((y * width as i32 + cx) * 3) as usize;
                if idx + 2 < frame.len() {
                    frame[idx] = 0;
                    frame[idx + 1] = 0;
                    frame[idx + 2] = 0;
                }
            }
        }
    }

    let (status, confidence) = detector.analyze_with_frame(&frame, width as u32, height as u32, &landmarks);
    assert_eq!(status, SeatbeltStatus::Fastened);
    assert!(confidence > 0.0);
}
