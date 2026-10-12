use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum SeatbeltState {
    Buckled,
    Unbuckled,
    Unknown,
}

impl Default for SeatbeltState {
    fn default() -> Self {
        Self::Unknown
    }
}
