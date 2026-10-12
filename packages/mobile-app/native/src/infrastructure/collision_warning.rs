use crate::domain::adas::WarningLevel;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CollisionWarningConfig {
    pub critical_ttc: f32,
    pub warning_ttc: f32,
    pub advisory_ttc: f32,
}

impl Default for CollisionWarningConfig {
    fn default() -> Self {
        Self {
            critical_ttc: 1.5,
            warning_ttc: 2.5,
            advisory_ttc: 4.0,
        }
    }
}

pub struct CollisionWarning {
    config: CollisionWarningConfig,
}

impl CollisionWarning {
    pub fn new(config: CollisionWarningConfig) -> Self {
        Self { config }
    }

    pub fn evaluate(&self, speed: f32, target_speed: f32, distance: f32, angle: f32) -> (WarningLevel, f32) {
        if angle.abs() > 45.0 {
            return (WarningLevel::None, f32::INFINITY);
        }

        let relative_speed = speed - target_speed;
        if relative_speed <= 0.0 {
            return (WarningLevel::None, f32::INFINITY);
        }

        let ttc = distance / relative_speed;

        let level = if ttc < self.config.critical_ttc {
            WarningLevel::Critical
        } else if ttc < self.config.warning_ttc {
            WarningLevel::Warning
        } else if ttc < self.config.advisory_ttc {
            WarningLevel::Advisory
        } else {
            WarningLevel::None
        };

        (level, ttc)
    }

    pub fn evaluate_simple(_speed_kmh: f32, _distance_m: f32, ttc_s: f32) -> WarningLevel {
        if ttc_s <= 0.0 {
            WarningLevel::None
        } else if ttc_s < 1.5 {
            WarningLevel::Critical
        } else if ttc_s < 2.5 {
            WarningLevel::Warning
        } else if ttc_s < 4.0 {
            WarningLevel::Advisory
        } else {
            WarningLevel::None
        }
    }
}
