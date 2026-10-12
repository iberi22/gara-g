//! Data Marketplace use cases

use crate::domain::anonymizer::Anonymizer;
use crate::domain::marketplace::{
    AnonymizedBatch, DataListing, MarketplaceTransaction, ParticipantReputation,
    TransactionStatus, DisputeResolution, haversine_distance,
};
use crate::domain::telemetry::TelemetryBatch;
use crate::domain::access_token::{AccessTokenManager, TokenScope};
use crate::domain::opt_in::OptInPreferences;
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Represents a listing on the DePIN marketplace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MarketplaceListing {
    pub id: String,
    pub category: String, // "new_listings", "price_drops", "deals"
    pub price_gara: u64,
    pub distance_km: f64,
    pub title: String,
}

/// Represents a notification relayed over the P2P mesh network.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeshNotification {
    pub listing_id: String,
    pub message: String,
    pub is_relayed: bool,
    pub timestamp: i64,
}

/// Use Case: Relaying marketplace notifications via P2P mesh network based on user opt-in preferences.
pub struct P2PNotificationRelayUseCase;

impl Default for P2PNotificationRelayUseCase {
    fn default() -> Self {
        Self::new()
    }
}

impl P2PNotificationRelayUseCase {
    pub fn new() -> Self {
        Self
    }

    /// Evaluates a marketplace listing against opt-in preferences.
    /// If there is a match, triggers a notification and prepares it for P2P relaying via mesh.
    pub fn process_and_relay(
        &self,
        preferences: &OptInPreferences,
        listing: &MarketplaceListing,
    ) -> Option<MeshNotification> {
        if !preferences.notifications_enabled {
            return None;
        }

        if !preferences.categories.contains(&listing.category) {
            return None;
        }

        if listing.distance_km < preferences.min_distance_km
            || listing.distance_km > preferences.max_distance_km
        {
            return None;
        }

        let message = format!(
            "Marketplace Alert: Match found for '{}' under category '{}' (Distance: {:.1} km, Price: {} GARA)",
            listing.title, listing.category, listing.distance_km, listing.price_gara
        );

        Some(MeshNotification {
            listing_id: listing.id.clone(),
            message,
            is_relayed: true,
            timestamp: chrono::Utc::now().timestamp_millis(),
        })
    }
}

/// Use Case: Prepare data batch for sale
pub struct PrepareDataForSaleUseCase<'a> {
    anonymizer: &'a Anonymizer,
}

impl<'a> PrepareDataForSaleUseCase<'a> {
    pub fn new(anonymizer: &'a Anonymizer) -> Self {
        Self { anonymizer }
    }

    /// Prepares data for sale without token check (legacy/unprotected path)
    pub fn execute(&self, raw_batch: Vec<u8>) -> Result<AnonymizedBatch> {
        // 1. Deserialize to TelemetryBatch
        let batch: TelemetryBatch = bincode::deserialize(&raw_batch)?;

        // 2. Apply k-anonymity via Anonymizer
        let mut anonymized_batch = self.anonymizer.anonymize_batch(&batch);

        // 3. Calculate data_credits value based on record_count
        anonymized_batch.price_gara = anonymized_batch.record_count * 10; // 10 GARA per record

        // 4. Generate merkle_proof
        let mut hasher = Sha256::new();
        hasher.update(bincode::serialize(&batch.data_points)?);
        anonymized_batch.data_hash.copy_from_slice(&hasher.finalize());
        // In a real implementation, a proper merkle proof would be generated.
        anonymized_batch.merkle_proof = vec![[0; 32]];

        // 5. Return AnonymizedBatch with all fields populated
        Ok(anonymized_batch)
    }

    /// Prepares data for sale verifying List scope and enforcing rate limiting.
    pub fn execute_with_token(
        &self,
        raw_batch: Vec<u8>,
        token_manager: &mut AccessTokenManager,
        token_id: &str,
    ) -> Result<AnonymizedBatch> {
        // Validate Token with List scope
        token_manager.validate_token(token_id, TokenScope::List)?;
        // Enforce rate limiting
        token_manager.check_rate_limit(token_id)?;

        self.execute(raw_batch)
    }
}

/// Use Case: Buy data package from the marketplace
pub struct BuyDataUseCase<'a> {
    token_manager: &'a mut AccessTokenManager,
}

impl<'a> BuyDataUseCase<'a> {
    pub fn new(token_manager: &'a mut AccessTokenManager) -> Self {
        Self { token_manager }
    }

    /// Purchases listed telemetry data package under Buy authorization.
    pub fn execute(&mut self, token_id: &str, batch_id: &str) -> Result<String> {
        // Validate Buy scope
        self.token_manager.validate_token(token_id, TokenScope::Buy)?;
        // Enforce rate limiting
        self.token_manager.check_rate_limit(token_id)?;

        Ok(format!("Successfully bought batch {} using token {}", batch_id, token_id))
    }
}

/// Use Case: Arbitrate marketplace disputes
pub struct ArbitrateDisputeUseCase<'a> {
    token_manager: &'a mut AccessTokenManager,
}

impl<'a> ArbitrateDisputeUseCase<'a> {
    pub fn new(token_manager: &'a mut AccessTokenManager) -> Self {
        Self { token_manager }
    }

    /// Resolves disputes in the marketplace under Arbitrate authorization.
    pub fn execute(&mut self, token_id: &str, dispute_id: &str, resolution: &str) -> Result<String> {
        // Validate Arbitrate scope
        self.token_manager.validate_token(token_id, TokenScope::Arbitrate)?;
        // Enforce rate limiting
        self.token_manager.check_rate_limit(token_id)?;

        Ok(format!(
            "Dispute {} resolved: {}. Authorized by token {}",
            dispute_id, resolution, token_id
        ))
    }
}

/// Dynamic manager for the consumer-producer marketplace.
pub struct MarketplaceManager {
    pub listings: HashMap<String, DataListing>,
    pub transactions: HashMap<String, MarketplaceTransaction>,
    pub reputations: HashMap<String, ParticipantReputation>,
}

impl Default for MarketplaceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MarketplaceManager {
    pub fn new() -> Self {
        Self {
            listings: HashMap::new(),
            transactions: HashMap::new(),
            reputations: HashMap::new(),
        }
    }

    pub fn get_or_create_reputation(&mut self, participant_id: String) -> &mut ParticipantReputation {
        self.reputations
            .entry(participant_id.clone())
            .or_insert_with(|| ParticipantReputation::new(participant_id))
    }

    pub fn create_listing(
        &mut self,
        producer_id: String,
        price_gara: u64,
        latitude: f64,
        longitude: f64,
        category: String,
        description: String,
    ) -> Result<DataListing> {
        let listing_id = uuid::Uuid::new_v4().to_string();
        let listing = DataListing {
            listing_id: listing_id.clone(),
            producer_id: producer_id.clone(),
            price_gara,
            latitude,
            longitude,
            category,
            description,
            created_at: chrono::Utc::now().timestamp(),
        };

        // Ensure producer has reputation tracked
        self.get_or_create_reputation(producer_id);

        self.listings.insert(listing_id, listing.clone());
        Ok(listing)
    }

    pub fn discover_listings(
        &self,
        category: Option<String>,
        lat: Option<f64>,
        lon: Option<f64>,
        max_distance_meters: Option<f64>,
    ) -> Vec<DataListing> {
        let mut results: Vec<(f64, DataListing)> = self
            .listings
            .values()
            .filter(|listing| {
                if let Some(ref cat) = category {
                    if listing.category != *cat {
                        return false;
                    }
                }
                if let (Some(l_lat), Some(l_lon)) = (lat, lon) {
                    let dist = haversine_distance(l_lat, l_lon, listing.latitude, listing.longitude);
                    if let Some(max_dist) = max_distance_meters {
                        if dist > max_dist {
                            return false;
                        }
                    }
                }
                true
            })
            .map(|listing| {
                let dist = if let (Some(l_lat), Some(l_lon)) = (lat, lon) {
                    haversine_distance(l_lat, l_lon, listing.latitude, listing.longitude)
                } else {
                    0.0
                };
                (dist, listing.clone())
            })
            .collect();

        // Sort by proximity if coordinates were provided
        if lat.is_some() && lon.is_some() {
            results.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        }

        results.into_iter().map(|(_, listing)| listing).collect()
    }

    pub fn request_transaction(&mut self, listing_id: String, consumer_id: String) -> Result<MarketplaceTransaction> {
        let listing = self
            .listings
            .get(&listing_id)
            .ok_or_else(|| anyhow::anyhow!("Listing not found"))?
            .clone();

        let transaction_id = uuid::Uuid::new_v4().to_string();
        let transaction = MarketplaceTransaction {
            transaction_id: transaction_id.clone(),
            listing_id,
            consumer_id: consumer_id.clone(),
            producer_id: listing.producer_id,
            price_gara: listing.price_gara,
            status: TransactionStatus::Requested,
            data_payload: None,
            updated_at: chrono::Utc::now().timestamp(),
        };

        self.get_or_create_reputation(consumer_id);

        self.transactions.insert(transaction_id, transaction.clone());
        Ok(transaction)
    }

    pub fn accept_transaction(&mut self, transaction_id: String, producer_id: String) -> Result<MarketplaceTransaction> {
        let tx = self
            .transactions
            .get_mut(&transaction_id)
            .ok_or_else(|| anyhow::anyhow!("Transaction not found"))?;

        if tx.producer_id != producer_id {
            return Err(anyhow::anyhow!("Unauthorized: caller is not the producer of this listing"));
        }

        if tx.status != TransactionStatus::Requested {
            return Err(anyhow::anyhow!("Invalid status: transaction cannot be accepted in its current state"));
        }

        tx.status = TransactionStatus::Accepted;
        tx.updated_at = chrono::Utc::now().timestamp();
        Ok(tx.clone())
    }

    pub fn pay_transaction(&mut self, transaction_id: String, consumer_id: String) -> Result<MarketplaceTransaction> {
        let tx = self
            .transactions
            .get_mut(&transaction_id)
            .ok_or_else(|| anyhow::anyhow!("Transaction not found"))?;

        if tx.consumer_id != consumer_id {
            return Err(anyhow::anyhow!("Unauthorized: caller is not the consumer of this transaction"));
        }

        if tx.status != TransactionStatus::Accepted {
            return Err(anyhow::anyhow!("Invalid status: transaction cannot be paid before it is accepted"));
        }

        tx.status = TransactionStatus::Paid;
        tx.updated_at = chrono::Utc::now().timestamp();
        Ok(tx.clone())
    }

    pub fn deliver_transaction(
        &mut self,
        transaction_id: String,
        producer_id: String,
        data_payload: String,
    ) -> Result<MarketplaceTransaction> {
        let tx = self
            .transactions
            .get_mut(&transaction_id)
            .ok_or_else(|| anyhow::anyhow!("Transaction not found"))?;

        if tx.producer_id != producer_id {
            return Err(anyhow::anyhow!("Unauthorized: caller is not the producer of this transaction"));
        }

        if tx.status != TransactionStatus::Paid {
            return Err(anyhow::anyhow!("Invalid status: transaction cannot be delivered before payment"));
        }

        tx.status = TransactionStatus::Delivered;
        tx.data_payload = Some(data_payload);
        tx.updated_at = chrono::Utc::now().timestamp();
        Ok(tx.clone())
    }

    pub fn confirm_transaction(&mut self, transaction_id: String, consumer_id: String) -> Result<MarketplaceTransaction> {
        let (producer_id, _price) = {
            let tx = self
                .transactions
                .get(&transaction_id)
                .ok_or_else(|| anyhow::anyhow!("Transaction not found"))?;

            if tx.consumer_id != consumer_id {
                return Err(anyhow::anyhow!("Unauthorized: caller is not the consumer of this transaction"));
            }

            if tx.status != TransactionStatus::Delivered {
                return Err(anyhow::anyhow!("Invalid status: transaction cannot be confirmed before delivery"));
            }
            (tx.producer_id.clone(), tx.price_gara)
        };

        // Update producer reputation upon successful transaction
        let rep = self.get_or_create_reputation(producer_id);
        rep.update_score(10); // +10 reputation for a successful sale
        rep.successful_sales += 1;

        // Update status
        let tx = self.transactions.get_mut(&transaction_id).unwrap();
        tx.status = TransactionStatus::Confirmed;
        tx.updated_at = chrono::Utc::now().timestamp();

        Ok(tx.clone())
    }

    pub fn flag_dispute(&mut self, transaction_id: String, participant_id: String) -> Result<MarketplaceTransaction> {
        // First check validity and get participant_id
        {
            let tx = self
                .transactions
                .get(&transaction_id)
                .ok_or_else(|| anyhow::anyhow!("Transaction not found"))?;

            if tx.consumer_id != participant_id && tx.producer_id != participant_id {
                return Err(anyhow::anyhow!("Unauthorized: caller is not a participant in this transaction"));
            }

            if tx.status == TransactionStatus::Confirmed || tx.status == TransactionStatus::Resolved {
                return Err(anyhow::anyhow!("Invalid status: cannot dispute a finalized transaction"));
            }
        }

        // Slightly penalize participant for causing/entering a dispute state
        let rep = self.get_or_create_reputation(participant_id);
        rep.update_score(-5);

        // Now fetch mut and update status
        let tx = self.transactions.get_mut(&transaction_id).unwrap();
        tx.status = TransactionStatus::Disputed;
        tx.updated_at = chrono::Utc::now().timestamp();

        Ok(tx.clone())
    }

    pub fn resolve_dispute(
        &mut self,
        transaction_id: String,
        resolution: DisputeResolution,
        _arbiter_id: String,
    ) -> Result<MarketplaceTransaction> {
        let (consumer_id, producer_id) = {
            let tx = self
                .transactions
                .get(&transaction_id)
                .ok_or_else(|| anyhow::anyhow!("Transaction not found"))?;

            if tx.status != TransactionStatus::Disputed {
                return Err(anyhow::anyhow!("Invalid status: transaction is not currently in dispute"));
            }
            (tx.consumer_id.clone(), tx.producer_id.clone())
        };

        // Apply reputation updates based on the resolution
        match resolution {
            DisputeResolution::RefundConsumer => {
                let prod_rep = self.get_or_create_reputation(producer_id);
                prod_rep.update_score(-50); // Severe reputation drop for bad delivery

                let cons_rep = self.get_or_create_reputation(consumer_id);
                cons_rep.update_score(5); // Restore consumer's reputation for valid dispute
            }
            DisputeResolution::ReleaseToProducer => {
                let prod_rep = self.get_or_create_reputation(producer_id);
                prod_rep.update_score(10);
                prod_rep.successful_sales += 1;

                let cons_rep = self.get_or_create_reputation(consumer_id);
                cons_rep.update_score(-15); // Penalize consumer for filing false dispute
            }
        }

        // Now modify the transaction
        let tx = self.transactions.get_mut(&transaction_id).unwrap();
        tx.status = TransactionStatus::Resolved;
        tx.updated_at = chrono::Utc::now().timestamp();
        if let DisputeResolution::RefundConsumer = resolution {
            tx.data_payload = None;
        }

        Ok(tx.clone())
    }
}
