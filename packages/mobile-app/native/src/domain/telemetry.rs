//! Telemetry module for accident and theft detection.

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::Sender;

const CRASH_DETECTION_THRESHOLD_G: f64 = 10.0;
const THEFT_DETECTION_THRESHOLD_MOVEMENT: f64 = 0.5;

/// Represents the state of Sentinel Mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SentinelState {
    Disarmed,
    Armed,
    Triggered { timestamp: i64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GeoPoint {
    pub lat: f64,
    pub lon: f64,
    pub accuracy: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TelemetryBatch {
    pub id: [u8; 32],
    pub data_points: Vec<SensorData>,
    pub merkle_root: [u8; 32],
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AccelerometerData {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GyroscopeData {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Represents a sensor reading.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SensorData {
    pub timestamp: i64,
    pub vehicle_id: [u8; 32],
    pub speed: f64,
    pub rpm: u32,
    pub fuel_level: f64,
    pub location: Option<GeoPoint>,
    pub obd_codes: Vec<String>,
    pub accelerometer: Option<AccelerometerData>,
    pub gyroscope: Option<GyroscopeData>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationError {
    InvalidSpeed,
    InvalidRpm,
    InvalidFuelLevel,
    MissingTimestamp,
}

impl SensorData {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.timestamp == 0 {
            return Err(ValidationError::MissingTimestamp);
        }
        if self.speed < 0.0 || self.speed > 500.0 { // Assuming 500km/h max, test used 500.0 as invalid
            return Err(ValidationError::InvalidSpeed);
        }
        if self.fuel_level < 0.0 || self.fuel_level > 1.0 {
            return Err(ValidationError::InvalidFuelLevel);
        }
        Ok(())
    }
}

/// Represents an emergency event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EmergencyEvent {
    CrashDetected { g_force: f64 },
    TheftDetected { movement: f64 },
}

/// Manages the state and logic for telemetry.
pub struct Telemetry {
    pub sentinel_state: SentinelState,
    event_sender: Sender<EmergencyEvent>,
}

impl Telemetry {
    /// Creates a new Telemetry instance.
    pub fn new(event_sender: Sender<EmergencyEvent>) -> Self {
        Self {
            sentinel_state: SentinelState::Disarmed,
            event_sender,
        }
    }

    /// Returns the current sentinel state.
    pub fn get_sentinel_state(&self) -> SentinelState {
        self.sentinel_state
    }

    /// Arms Sentinel Mode.
    pub fn arm_sentinel(&mut self) {
        self.sentinel_state = SentinelState::Armed;
    }

    /// Disarms Sentinel Mode.
    pub fn disarm_sentinel(&mut self) {
        self.sentinel_state = SentinelState::Disarmed;
    }

    /// Processes accelerometer data for crash detection.
    pub async fn process_accelerometer_data(&self, data: SensorData) {
        if let Some(accel) = data.accelerometer {
             // Ignore vertical G-force to avoid false positives from bumps
            let horizontal_g_force = (accel.x.powi(2) + accel.y.powi(2)).sqrt() / 9.81;

            if horizontal_g_force > CRASH_DETECTION_THRESHOLD_G {
                let event = EmergencyEvent::CrashDetected {
                    g_force: horizontal_g_force,
                };
                self.event_sender.send(event).await.ok();
            }
        }
    }

    /// Processes gyroscope data for theft detection.
    pub async fn process_gyroscope_data(&mut self, data: SensorData) {
        if self.sentinel_state == SentinelState::Armed {
            if let Some(gyro) = data.gyroscope {
                 let movement = gyro.x.abs() + gyro.y.abs() + gyro.z.abs();
                if movement > THEFT_DETECTION_THRESHOLD_MOVEMENT {
                    self.sentinel_state = SentinelState::Triggered {
                        timestamp: data.timestamp,
                    };
                    let event = EmergencyEvent::TheftDetected { movement };
                    self.event_sender.send(event).await.ok();
                }
            }
        }
    }
}

// ---- New Telemetry Structures for Marketplace ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryDataPoint {
    pub timestamp: i64, // Exact unix timestamp ms
    pub latitude: f64,
    pub longitude: f64,
    pub speed: f32, // meters per second
    pub road_type: RoadType,
    pub weather: WeatherConditions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadType {
    Highway,
    Urban,
    Rural,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WeatherConditions {
    Clear,
    Rain,
    Snow,
    Fog,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryExportBatch {
    pub id: String, // uuid for the batch
    pub vin: String, // Vehicle Identification Number
    pub driver_id: String, // Internal driver identifier
    pub data_points: Vec<TelemetryDataPoint>,
}
