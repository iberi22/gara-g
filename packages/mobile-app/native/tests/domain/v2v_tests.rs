
use native::domain::v2v::{MessageType, RewardTracker, RewardCalculation};

#[test]
fn test_v2v_message_types() {
    // Verify variants exist
    let _ = MessageType::Emergency;
    let _ = MessageType::QuickMessage;
    // Check serialization if needed, or just existence
}

#[test]
fn test_reward_tracker_accumulation() {
    let mut tracker = RewardTracker::new();
    let reward = RewardCalculation {
        base_reward: 10,
        multiplier: 1.0,
        final_reward: 10,
        dc_cost: 0,
        breakdown: "".to_string(),
    };
    tracker.add_reward("sender1", &reward);

    let (count, total) = tracker.stats();
    assert_eq!(count, 1);
    assert_eq!(total, 10);
}
