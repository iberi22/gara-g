use serde::{Deserialize, Serialize};
use crate::ai_processor::Detection;

/// Sign type for speed limits
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignType {
    SpeedLimit,
    Stop,
    Yield,
    Other,
}

/// Represents a detected speed limit sign
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedSign {
    pub value: u32,
    pub confidence: f32,
    pub sign_type: SignType,
}

pub struct SpeedSignDetector;

impl SpeedSignDetector {
    /// Extracts speed signs from a list of detections
    pub fn extract_signs(objects: &[Detection]) -> Vec<SpeedSign> {
        objects.iter()
            .filter_map(|d| {
                // Look for labels like "speed_limit_50", "limit_30", etc.
                if d.label.contains("speed_limit") || d.label.contains("limit") {
                    let value = d.label.chars()
                        .filter(|c: &char| c.is_digit(10))
                        .collect::<String>()
                        .parse::<u32>()
                        .ok();

                    value.map(|v| SpeedSign {
                        value: v,
                        confidence: d.confidence,
                        sign_type: SignType::SpeedLimit,
                    })
                } else if d.label == "stop_sign" {
                    Some(SpeedSign {
                        value: 0,
                        confidence: d.confidence,
                        sign_type: SignType::Stop,
                    })
                } else {
                    None
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_processor::Detection;

    #[test]
    fn test_extract_signs() {
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
            Detection {
                label: "car".to_string(),
                confidence: 0.9,
                bbox: None,
            },
            Detection {
                label: "speed_limit_invalid".to_string(),
                confidence: 0.5,
                bbox: None,
            },
        ];

        let signs = SpeedSignDetector::extract_signs(&detections);
        assert_eq!(signs.len(), 2);

        assert_eq!(signs[0].value, 50);
        assert!((signs[0].confidence - 0.95).abs() < f32::EPSILON);

        assert_eq!(signs[1].value, 30);
        assert!((signs[1].confidence - 0.8).abs() < f32::EPSILON);
    }
}
