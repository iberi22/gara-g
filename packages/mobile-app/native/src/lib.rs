use crate::domain::speed_sign::{SpeedSign, SignType, SpeedSignDetector};
use crate::domain::adas::{AdasConfig, BoundingBox, DetectedObject};
pub use domain::adas::WarningLevel;
use infrastructure::collision_warning::{CollisionWarning, CollisionWarningConfig};
use infrastructure::adas_engine::AdasEngine;

mod frb_generated; /* AUTO INJECTED BY flutter_rust_bridge. This line may not be accurate, and you can change it according to your needs. */
pub mod api;
pub mod domain;
pub mod infrastructure;
pub mod application;
pub mod seatbelt;
pub mod video_recorder;
pub mod ai_processor;
pub mod protocol;
pub mod satellite;
pub mod depin;
pub mod dms_bridge;
