use crate::domain::dms::{DmsAnalysis, DmsEngine, DmsEvent, Point3D};
use std::sync::Mutex;
use once_cell::sync::Lazy;

static DMS_ENGINE: Lazy<Mutex<DmsEngine>> = Lazy::new(|| Mutex::new(DmsEngine::new()));

/// Processes MediaPipe face mesh landmarks (x, y, z triplets) and computes DMS analysis and safety events.
pub fn process_dms_landmarks(landmarks: Vec<f32>) -> Result<String, String> {
    if landmarks.len() % 3 != 0 {
        return Err("Invalid landmarks data: must be x,y,z triplets".to_string());
    }

    let points: Vec<Point3D> = landmarks
        .chunks(3)
        .map(|c| Point3D { x: c[0], y: c[1], z: c[2] })
        .collect();

    let mut engine = DMS_ENGINE.lock().unwrap();
    let timestamp = chrono::Utc::now().timestamp_millis();
    let (analysis, event) = engine.analyze_with_event(&points, timestamp);

    let json_result = serde_json::json!({
        "dms_status": analysis,
        "event": event,
    });

    Ok(json_result.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_dms_landmarks_bridge() {
        let mut landmarks = vec![0.0f32; 468 * 3];
        // Set eye landmarks
        landmarks[362 * 3] = 10.0; landmarks[362 * 3 + 1] = 10.0;
        landmarks[263 * 3] = 20.0; landmarks[263 * 3 + 1] = 10.0;
        landmarks[385 * 3] = 13.0; landmarks[385 * 3 + 1] = 12.0;
        landmarks[380 * 3] = 13.0; landmarks[380 * 3 + 1] = 8.0;
        landmarks[387 * 3] = 17.0; landmarks[387 * 3 + 1] = 12.0;
        landmarks[373 * 3] = 17.0; landmarks[373 * 3 + 1] = 8.0;

        let res = process_dms_landmarks(landmarks);
        assert!(res.is_ok());
        let json_str = res.unwrap();
        assert!(json_str.contains("dms_status"));
    }
}
