//! P2P Auction Queue with Priority Bidding.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Error types for the P2P Auction Queue
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuctionQueueError {
    AuctionNotFound,
    AuctionInactive,
    AuctionExpired,
    BidTooLow,
    BidderIsSeller,
    DuplicateBidder,
}

/// A bid placed on a P2P data auction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuctionBid {
    pub bidder_id: String,
    pub amount: u64,
    pub priority_fee: u64,
    pub reputation_score: u32,
    pub timestamp: i64,
}

impl AuctionBid {
    /// Calculate the deterministic priority score of this bid.
    /// Higher score means higher priority.
    pub fn priority_score(&self) -> u64 {
        self.amount
            .saturating_add(self.priority_fee.saturating_mul(12))
            .saturating_add((self.reputation_score as u64).saturating_mul(3))
    }
}

/// An active or completed P2P auction in the marketplace queue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct P2PAuction {
    pub auction_id: String,
    pub seller_id: String,
    pub category: String,
    pub min_price: u64,
    pub expires_at: i64,
    pub bids: Vec<AuctionBid>,
    pub is_active: bool,
}

impl P2PAuction {
    pub fn new(
        auction_id: String,
        seller_id: String,
        category: String,
        min_price: u64,
        expires_at: i64,
    ) -> Self {
        Self {
            auction_id,
            seller_id,
            category,
            min_price,
            expires_at,
            bids: Vec::new(),
            is_active: true,
        }
    }

    /// Retrieve the highest priority bid if any exist.
    pub fn highest_priority_bid(&self) -> Option<&AuctionBid> {
        self.bids.first()
    }
}

/// The stateful Auction Queue that manages P2P auctions and priority sorting of bids.
#[derive(Debug, Clone, Default)]
pub struct AuctionQueue {
    pub auctions: HashMap<String, P2PAuction>,
    pub nonce: u64,
}

impl AuctionQueue {
    pub fn new() -> Self {
        Self {
            auctions: HashMap::new(),
            nonce: 0,
        }
    }

    /// Create a new P2P auction in the queue.
    pub fn create_auction(
        &mut self,
        seller_id: String,
        category: String,
        min_price: u64,
        expires_at: i64,
    ) -> String {
        let auction_id = format!("auction_p2p_{}_{}", self.nonce, chrono::Utc::now().timestamp_millis());
        self.nonce += 1;

        let auction = P2PAuction::new(
            auction_id.clone(),
            seller_id,
            category,
            min_price,
            expires_at,
        );

        self.auctions.insert(auction_id.clone(), auction);
        auction_id
    }

    /// Place a bid on an existing auction. Bids are sorted by priority score descending.
    pub fn place_bid(
        &mut self,
        auction_id: &str,
        bidder_id: String,
        amount: u64,
        priority_fee: u64,
        reputation_score: u32,
        current_time: i64,
    ) -> Result<(), AuctionQueueError> {
        let auction = self.auctions.get_mut(auction_id).ok_or(AuctionQueueError::AuctionNotFound)?;

        if !auction.is_active {
            return Err(AuctionQueueError::AuctionInactive);
        }

        if current_time >= auction.expires_at {
            auction.is_active = false;
            return Err(AuctionQueueError::AuctionExpired);
        }

        if bidder_id == auction.seller_id {
            return Err(AuctionQueueError::BidderIsSeller);
        }

        if amount < auction.min_price {
            return Err(AuctionQueueError::BidTooLow);
        }

        // Clean out any pre-existing bids by this same bidder to allow updates
        auction.bids.retain(|b| b.bidder_id != bidder_id);

        let new_bid = AuctionBid {
            bidder_id,
            amount,
            priority_fee,
            reputation_score,
            timestamp: current_time,
        };

        // Insert and sort by priority score descending. If tied, sort by timestamp ascending (earlier bid wins)
        auction.bids.push(new_bid);
        auction.bids.sort_by(|a, b| {
            let p_a = a.priority_score();
            let p_b = b.priority_score();
            if p_a != p_b {
                p_b.cmp(&p_a) // Descending priority
            } else {
                a.timestamp.cmp(&b.timestamp) // Ascending timestamp
            }
        });

        Ok(())
    }

    /// Finalizes an auction, disabling it. Returns the winning bid if any.
    pub fn finalize_auction(
        &mut self,
        auction_id: &str,
        current_time: i64,
    ) -> Result<Option<AuctionBid>, AuctionQueueError> {
        let auction = self.auctions.get_mut(auction_id).ok_or(AuctionQueueError::AuctionNotFound)?;

        if !auction.is_active {
            return Err(AuctionQueueError::AuctionInactive);
        }

        auction.is_active = false;

        if current_time < auction.expires_at {
            // Can be finalized early by manual closing or just when matching triggers
        }

        Ok(auction.highest_priority_bid().cloned())
    }

    /// Cancel an active auction.
    pub fn cancel_auction(&mut self, auction_id: &str) -> Result<(), AuctionQueueError> {
        let auction = self.auctions.get_mut(auction_id).ok_or(AuctionQueueError::AuctionNotFound)?;
        if !auction.is_active {
            return Err(AuctionQueueError::AuctionInactive);
        }
        auction.is_active = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_bid_priority() {
        let mut queue = AuctionQueue::new();
        let seller = "seller_1".to_string();
        let auction_id = queue.create_auction(seller, "telemetry".to_string(), 100, 1000);

        let now = 100;
        // Bidder 1: Amount 120, Priority Fee 2, Reputation 100 => Priority = 120 + 24 + 300 = 444
        assert!(queue.place_bid(&auction_id, "bidder_1".to_string(), 120, 2, 100, now).is_ok());

        // Bidder 2: Amount 130, Priority Fee 0, Reputation 50 => Priority = 130 + 0 + 150 = 280
        assert!(queue.place_bid(&auction_id, "bidder_2".to_string(), 130, 0, 50, now).is_ok());

        // Bidder 3: Amount 100, Priority Fee 10, Reputation 80 => Priority = 100 + 120 + 240 = 460
        assert!(queue.place_bid(&auction_id, "bidder_3".to_string(), 100, 10, 80, now).is_ok());

        let auction = queue.auctions.get(&auction_id).unwrap();
        assert_eq!(auction.bids.len(), 3);

        // First place should be Bidder 3 (Priority 460)
        assert_eq!(auction.bids[0].bidder_id, "bidder_3");
        // Second place should be Bidder 1 (Priority 444)
        assert_eq!(auction.bids[1].bidder_id, "bidder_1");
        // Third place should be Bidder 2 (Priority 280)
        assert_eq!(auction.bids[2].bidder_id, "bidder_2");

        // Try bidding after expiration
        let res_expired = queue.place_bid(&auction_id, "bidder_4".to_string(), 200, 5, 100, 1001);
        assert_eq!(res_expired.unwrap_err(), AuctionQueueError::AuctionExpired);
    }

    #[test]
    fn test_finalize_and_cancel() {
        let mut queue = AuctionQueue::new();
        let seller = "seller_1".to_string();
        let auction_id = queue.create_auction(seller, "location".to_string(), 50, 500);

        // Place a bid
        assert!(queue.place_bid(&auction_id, "bidder_x".to_string(), 60, 1, 90, 200).is_ok());

        // Finalize manual
        let winning_bid = queue.finalize_auction(&auction_id, 300).unwrap();
        assert!(winning_bid.is_some());
        assert_eq!(winning_bid.unwrap().bidder_id, "bidder_x");

        // Try to cancel finalized auction
        let res_cancel = queue.cancel_auction(&auction_id);
        assert_eq!(res_cancel.unwrap_err(), AuctionQueueError::AuctionInactive);
    }
}
