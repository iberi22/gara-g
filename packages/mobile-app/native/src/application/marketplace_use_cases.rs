//! Data Marketplace use cases

use crate::domain::anonymizer::Anonymizer;
use crate::domain::marketplace::AnonymizedBatch;
use crate::domain::telemetry::TelemetryBatch;
use anyhow::Result;
use sha2::{Digest, Sha256};

/// Use Case: Prepare data batch for sale
pub struct PrepareDataForSaleUseCase<'a> {
    anonymizer: &'a Anonymizer,
}

impl<'a> PrepareDataForSaleUseCase<'a> {
    pub fn new(anonymizer: &'a Anonymizer) -> Self {
        Self { anonymizer }
    }

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
}
