//! Secure Multi-Party Escrow system for GARA Marketplace transactions.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Errors that can occur during Multi-Party Escrow operations
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MultiEscrowError {
    EscrowNotFound,
    AlreadyResolved,
    NotLocked,
    UnauthorizedParty,
    UnderDispute,
    NotUnderDispute,
    DuplicateApproval,
}

/// Represents the status of a multi-party escrow
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum EscrowStatus {
    Locked,
    Disputed,
    Released,
    Refunded,
}

/// Stateful representation of a multi-party escrow contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultiEscrowState {
    pub escrow_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub arbiters: Vec<String>,
    pub amount: u64,
    pub protocol_fee: u64,
    pub seller_payout: u64,
    pub approvals: HashSet<String>,
    pub status: EscrowStatus,
}

impl MultiEscrowState {
    /// Create a new escrow contract applying the 2.5% protocol/matching fee.
    pub fn new(
        escrow_id: String,
        buyer_id: String,
        seller_id: String,
        arbiters: Vec<String>,
        amount: u64,
    ) -> Self {
        // Platform matching fee is exactly 2.5%
        let protocol_fee = (amount * 25 + 500) / 1000;
        let seller_payout = amount.saturating_sub(protocol_fee);

        Self {
            escrow_id,
            buyer_id,
            seller_id,
            arbiters,
            amount,
            protocol_fee,
            seller_payout,
            approvals: HashSet::new(),
            status: EscrowStatus::Locked,
        }
    }
}

/// Stateful manager for GARA Multi-Party Escrows.
#[derive(Debug, Clone, Default)]
pub struct MultiEscrow {
    pub escrows: HashMap<String, MultiEscrowState>,
    pub nonce: u64,
}

impl MultiEscrow {
    pub fn new() -> Self {
        Self {
            escrows: HashMap::new(),
            nonce: 0,
        }
    }

    /// Initialize a new secure multi-party escrow lockup
    pub fn create_escrow(
        &mut self,
        buyer_id: String,
        seller_id: String,
        arbiters: Vec<String>,
        amount: u64,
    ) -> String {
        let escrow_id = format!("escrow_multi_{}_{}", self.nonce, chrono::Utc::now().timestamp_millis());
        self.nonce += 1;

        let state = MultiEscrowState::new(
            escrow_id.clone(),
            buyer_id,
            seller_id,
            arbiters,
            amount,
        );

        self.escrows.insert(escrow_id.clone(), state);
        escrow_id
    }

    /// Approve release of the escrow to the seller.
    /// If consensus threshold is met, the funds are automatically released.
    /// Threshold rules:
    /// - Both buyer and seller approve
    /// - Seller + at least one arbiter approve
    /// - At least two arbiters approve (if multiple arbiters are configured)
    pub fn approve_release(
        &mut self,
        escrow_id: &str,
        approver_id: String,
    ) -> Result<EscrowStatus, MultiEscrowError> {
        let escrow = self.escrows.get_mut(escrow_id).ok_or(MultiEscrowError::EscrowNotFound)?;

        if escrow.status != EscrowStatus::Locked && escrow.status != EscrowStatus::Disputed {
            return Err(MultiEscrowError::AlreadyResolved);
        }

        // Validate authority
        let is_buyer = approver_id == escrow.buyer_id;
        let is_seller = approver_id == escrow.seller_id;
        let is_arbiter = escrow.arbiters.contains(&approver_id);

        if !is_buyer && !is_seller && !is_arbiter {
            return Err(MultiEscrowError::UnauthorizedParty);
        }

        if escrow.approvals.contains(&approver_id) {
            return Err(MultiEscrowError::DuplicateApproval);
        }

        escrow.approvals.insert(approver_id);

        // Evaluate if release threshold has been satisfied
        let has_buyer_approval = escrow.approvals.contains(&escrow.buyer_id);
        let has_seller_approval = escrow.approvals.contains(&escrow.seller_id);
        let arbiter_approval_count = escrow.approvals.iter().filter(|id| escrow.arbiters.contains(id)).count();

        let mut should_release = false;

        if has_buyer_approval && has_seller_approval {
            should_release = true;
        } else if has_seller_approval && arbiter_approval_count >= 1 {
            should_release = true;
        } else if arbiter_approval_count >= 2 {
            should_release = true;
        } else if escrow.status == EscrowStatus::Disputed && arbiter_approval_count >= 1 {
            // Under dispute, a single arbiter approval is sufficient to override and release
            should_release = true;
        }

        if should_release {
            escrow.status = EscrowStatus::Released;
        }

        Ok(escrow.status)
    }

    /// File/raise a formal dispute over the escrowed transaction.
    pub fn raise_dispute(&mut self, escrow_id: &str, caller_id: &str) -> Result<(), MultiEscrowError> {
        let escrow = self.escrows.get_mut(escrow_id).ok_or(MultiEscrowError::EscrowNotFound)?;

        if escrow.status != EscrowStatus::Locked {
            return Err(MultiEscrowError::AlreadyResolved);
        }

        if caller_id != escrow.buyer_id && caller_id != escrow.seller_id {
            return Err(MultiEscrowError::UnauthorizedParty);
        }

        escrow.status = EscrowStatus::Disputed;
        Ok(())
    }

    /// Arbiter unilaterally resolves a dispute, choosing whether to release funds or refund.
    pub fn resolve_dispute_unilateral(
        &mut self,
        escrow_id: &str,
        arbiter_id: &str,
        release_to_seller: bool,
    ) -> Result<EscrowStatus, MultiEscrowError> {
        let escrow = self.escrows.get_mut(escrow_id).ok_or(MultiEscrowError::EscrowNotFound)?;

        if escrow.status != EscrowStatus::Disputed {
            return Err(MultiEscrowError::NotUnderDispute);
        }

        if !escrow.arbiters.contains(&arbiter_id.to_string()) {
            return Err(MultiEscrowError::UnauthorizedParty);
        }

        if release_to_seller {
            escrow.status = EscrowStatus::Released;
        } else {
            escrow.status = EscrowStatus::Refunded;
            escrow.protocol_fee = 0;
            escrow.seller_payout = 0;
        }

        Ok(escrow.status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_multi_party_escrow_success_path() {
        let mut me = MultiEscrow::new();
        let buyer = "buyer_123".to_string();
        let seller = "seller_456".to_string();
        let arbiters = vec!["arb_1".to_string(), "arb_2".to_string()];

        let escrow_id = me.create_escrow(buyer.clone(), seller.clone(), arbiters, 1000);

        // Check fee calculations (2.5%)
        let escrow = me.escrows.get(&escrow_id).unwrap();
        assert_eq!(escrow.protocol_fee, 25);
        assert_eq!(escrow.seller_payout, 975);
        assert_eq!(escrow.status, EscrowStatus::Locked);

        // Buyer approves release
        let status = me.approve_release(&escrow_id, buyer.clone()).unwrap();
        assert_eq!(status, EscrowStatus::Locked); // Not yet satisfied

        // Seller approves release
        let status = me.approve_release(&escrow_id, seller.clone()).unwrap();
        assert_eq!(status, EscrowStatus::Released); // Both buyer and seller approved -> released!
    }

    #[test]
    fn test_escrow_dispute_and_resolution() {
        let mut me = MultiEscrow::new();
        let buyer = "buyer_123".to_string();
        let seller = "seller_456".to_string();
        let arbiters = vec!["arb_1".to_string()];

        let escrow_id = me.create_escrow(buyer.clone(), seller.clone(), arbiters, 500);

        // Dispute raised by buyer
        assert!(me.raise_dispute(&escrow_id, &buyer).is_ok());
        let escrow = me.escrows.get(&escrow_id).unwrap();
        assert_eq!(escrow.status, EscrowStatus::Disputed);

        // Attempting to approve release while disputed without arbiter shouldn't release immediately
        let status = me.approve_release(&escrow_id, seller.clone()).unwrap();
        assert_eq!(status, EscrowStatus::Disputed);

        // Arbiter resolves unilateral as refund
        let final_status = me.resolve_dispute_unilateral(&escrow_id, "arb_1", false).unwrap();
        assert_eq!(final_status, EscrowStatus::Refunded);

        let escrow = me.escrows.get(&escrow_id).unwrap();
        assert_eq!(escrow.protocol_fee, 0); // No fees taken on refund
        assert_eq!(escrow.seller_payout, 0);
    }
}
