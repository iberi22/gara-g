//! Wallet and rewards use cases

use crate::domain::v2v::{V2VWallet, RewardTracker};
use anyhow::Result;

/// Use Case: Claim earned rewards
pub struct ClaimRewardsUseCase<'a> {
    tracker: &'a RewardTracker
}

impl<'a> ClaimRewardsUseCase<'a> {
    pub fn new(tracker: &'a RewardTracker) -> Self {
        Self { tracker }
    }

    pub fn execute(&self, wallet: &V2VWallet) -> Result<u64> {
        // 1. Calculate pending rewards
        let pending_rewards = self.tracker.get_pending(&wallet.public_key);

        // 2. Generate claim transaction (mocked)
        println!("Generating claim transaction for {} GARA...", pending_rewards);

        // 3. Return claimable amount
        Ok(pending_rewards)
    }
}

/// Use Case: Get wallet status
pub struct GetWalletStatusUseCase<'a> {
    tracker: &'a RewardTracker
}

impl<'a> GetWalletStatusUseCase<'a> {
     pub fn new(tracker: &'a RewardTracker) -> Self {
        Self { tracker }
    }

    pub fn execute(&self, wallet: &V2VWallet) -> WalletStatus {
        // Return balance, pending rewards, etc.
        WalletStatus {
            balance: 0, // Mocked balance
            pending_rewards: self.tracker.get_pending(&wallet.public_key),
            total_data_sold: 0, // Mocked
        }
    }
}

#[derive(Debug, Clone)]
pub struct WalletStatus {
    pub balance: u64,
    pub pending_rewards: u64,
    pub total_data_sold: u64,
}
