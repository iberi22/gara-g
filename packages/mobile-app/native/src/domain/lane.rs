use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneMarking {
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lane {
    pub confidence: f32,
    pub x_position: f32,
    pub markings: Vec<LaneMarking>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneState {
    pub left_lane: Option<Lane>,
    pub right_lane: Option<Lane>,
    pub departure_warning: bool,
}
