use crate::domain::seatbelt::SeatbeltState;
use crate::domain::dms::Point3D;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SeatbeltStatus {
    Fastened,
    Unfastened,
    DriverAbsent,
    Unknown,
}

impl SeatbeltStatus {
    pub fn is_fastened(&self) -> bool {
        matches!(self, Self::Fastened)
    }
    pub fn is_unfastened(&self) -> bool {
        matches!(self, Self::Unfastened)
    }
    pub fn is_driver_absent(&self) -> bool {
        matches!(self, Self::DriverAbsent)
    }
}

pub struct SeatbeltHeuristicDetector {
    pub unfastened_threshold: f32,
}

impl SeatbeltHeuristicDetector {
    pub fn new() -> Self {
        Self {
            unfastened_threshold: 0.6,
        }
    }

    pub fn analyze(&self, landmarks: &[Point3D]) -> SeatbeltState {
        let (status, _) = self.analyze_with_confidence_internal(landmarks);
        match status {
            SeatbeltStatus::Fastened => SeatbeltState::Buckled,
            SeatbeltStatus::Unfastened => SeatbeltState::Unbuckled,
            _ => SeatbeltState::Unknown,
        }
    }

    pub fn analyze_with_confidence(&self, landmarks: &[(f32, f32, f32)]) -> (SeatbeltStatus, f32) {
        let points: Vec<Point3D> = landmarks.iter()
            .map(|&(x, y, z)| Point3D { x, y, z })
            .collect();
        self.analyze_with_confidence_internal(&points)
    }

    fn analyze_with_confidence_internal(&self, landmarks: &[Point3D]) -> (SeatbeltStatus, f32) {
        if landmarks.len() < 25 {
            return (SeatbeltStatus::Unknown, 0.0);
        }

        let l_shoulder = &landmarks[11];
        let r_shoulder = &landmarks[12];
        let l_hip = &landmarks[23];
        let _r_hip = &landmarks[24];

        if (l_shoulder.x == 0.0 && l_shoulder.y == 0.0) || (r_shoulder.x == 0.0 && r_shoulder.y == 0.0) {
            return (SeatbeltStatus::DriverAbsent, 0.0);
        }

        // Heuristic: Check if torso is visible and reasonably sized
        let torso_height = (l_hip.y - l_shoulder.y).abs();
        let torso_width = (r_shoulder.x - l_shoulder.x).abs();

        if torso_height < 0.1 || torso_width < 0.05 {
            return (SeatbeltStatus::Unknown, 0.2);
        }

        // Without frame data, we return a base confidence but assume fastened if visible
        // (Maintaining backward compatibility for keypoint-only stream)
        (SeatbeltStatus::Fastened, 0.4)
    }

    pub fn analyze_with_frame(&self, frame: &[u8], width: u32, height: u32, landmarks: &[Point3D]) -> (SeatbeltStatus, f32) {
        if landmarks.len() < 25 || frame.is_empty() {
             return self.analyze_with_confidence_internal(landmarks);
        }

        let l_shoulder = &landmarks[11];
        let r_hip = &landmarks[24];

        // Map normalized landmarks to pixel coordinates
        let x1 = (l_shoulder.x * width as f32) as i32;
        let y1 = (l_shoulder.y * height as f32) as i32;
        let x2 = (r_hip.x * width as f32) as i32;
        let y2 = (r_hip.y * height as f32) as i32;

        let belt_confidence = self.detect_diagonal_edge(frame, width, height, x1, y1, x2, y2);

        if belt_confidence >= self.unfastened_threshold {
            (SeatbeltStatus::Fastened, belt_confidence)
        } else {
            (SeatbeltStatus::Unfastened, belt_confidence)
        }
    }

    fn detect_diagonal_edge(&self, frame: &[u8], width: u32, height: u32, x1: i32, y1: i32, x2: i32, y2: i32) -> f32 {
        let steps = 20;
        let mut edge_sum = 0.0;
        let mut valid_samples = 0;

        let channels = if frame.len() as u32 >= width * height * 3 { 3 } else { 1 };

        for i in 0..steps {
            let t = i as f32 / steps as f32;
            let cx = x1 + ((x2 - x1) as f32 * t) as i32;
            let cy = y1 + ((y2 - y1) as f32 * t) as i32;

            if cx > 0 && cx < (width as i32 - 1) && cy > 0 && cy < (height as i32 - 1) {
                let get_pixel = |x: i32, y: i32| {
                    let base_idx = (y * width as i32 + x) as usize * channels as usize;
                    if channels == 3 {
                        // RGB to Gray approximation
                        frame[base_idx] as f32 * 0.299 + frame[base_idx + 1] as f32 * 0.587 + frame[base_idx + 2] as f32 * 0.114
                    } else {
                        frame[base_idx] as f32
                    }
                };

                // Sobel kernels
                let gx = -1.0 * get_pixel(cx - 1, cy - 1) + 1.0 * get_pixel(cx + 1, cy - 1)
                       - 2.0 * get_pixel(cx - 1, cy)   + 2.0 * get_pixel(cx + 1, cy)
                       - 1.0 * get_pixel(cx - 1, cy + 1) + 1.0 * get_pixel(cx + 1, cy + 1);

                let gy = -1.0 * get_pixel(cx - 1, cy - 1) - 2.0 * get_pixel(cx, cy - 1) - 1.0 * get_pixel(cx + 1, cy - 1)
                       + 1.0 * get_pixel(cx - 1, cy + 1) + 2.0 * get_pixel(cx, cy + 1) + 1.0 * get_pixel(cx + 1, cy + 1);

                let mag = (gx * gx + gy * gy).sqrt() / 1000.0;
                edge_sum += mag.min(1.0);
                valid_samples += 1;
            }
        }

        if valid_samples == 0 { return 0.0; }
        edge_sum / valid_samples as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_mock_landmarks() -> Vec<Point3D> {
        let mut landmarks = vec![Point3D { x: 0.0, y: 0.0, z: 0.0 }; 33];
        landmarks[11] = Point3D { x: 0.3, y: 0.3, z: 0.0 }; // Left shoulder
        landmarks[12] = Point3D { x: 0.7, y: 0.3, z: 0.0 }; // Right shoulder
        landmarks[23] = Point3D { x: 0.3, y: 0.7, z: 0.0 }; // Left hip
        landmarks[24] = Point3D { x: 0.7, y: 0.7, z: 0.0 }; // Right hip
        landmarks
    }

    #[test]
    fn test_seatbelt_fastened_with_frame() {
        let detector = SeatbeltHeuristicDetector::new();
        let landmarks = create_mock_landmarks();
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

    #[test]
    fn test_seatbelt_unfastened_with_frame() {
        let detector = SeatbeltHeuristicDetector::new();
        let landmarks = create_mock_landmarks();
        let width = 100;
        let height = 100;
        let frame = vec![128u8; width * height * 3]; // Uniform gray frame (no belt)

        let (status, confidence) = detector.analyze_with_frame(&frame, width as u32, height as u32, &landmarks);
        assert_eq!(status, SeatbeltStatus::Unfastened);
        assert!(confidence < 0.6);
    }

    #[test]
    fn test_driver_absent() {
        let detector = SeatbeltHeuristicDetector::new();
        let landmarks = vec![Point3D { x: 0.0, y: 0.0, z: 0.0 }; 33];
        let (status, _) = detector.analyze_with_confidence_internal(&landmarks);
        assert_eq!(status, SeatbeltStatus::DriverAbsent);
    }
}
