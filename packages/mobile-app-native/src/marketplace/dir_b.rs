//! Directory B - App Improvement Data Pipeline (marketplace_dir_b_AppImprovement).
//!
//! Handles client-side anonymization, k-anonymity checks, Differential Privacy noise,
//! and DAO voting simulation for data purchases funded by the community treasury.
//!
//! Grep patterns:
//! - marketplace_dir_b|AppImprovement
//! - marketplace_dir_b|AppImprovement

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sha2::{Sha256, Digest};

/// Raw diagnostic telemetry record before anonymization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawTelemetryRecord {
    pub vehicle_id: String,
    pub timestamp: i64,
    pub speed: f64,
    pub latitude: f64,
    pub longitude: f64,
    pub obd_dtc_codes: Vec<String>,
}

/// An anonymized diagnostic telemetry record ready for ML model training.
/// Grep pattern: marketplace_dir_b|AppImprovement
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnonymizedTelemetryRecord {
    pub vehicle_pseudonym: String,
    pub timestamp_hour_bucket: i64, // Timestamps bucketed to the hour to prevent timing attacks
    pub speed_dp: f64,             // Speed with Differential Privacy noise
    pub latitude_rounded: f64,     // Rounded to 3 decimal places (~111m precision)
    pub longitude_rounded: f64,    // Rounded to 3 decimal places
    pub has_obd_issue: bool,       // Binary flag instead of specific DTC codes for privacy
}

/// Status of the Directory B App Improvement proposal/purchase flow.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AppImprovementStatus {
    Prepared,
    ProposalSubmitted,
    Voting,
    Approved,
    Rejected,
    Paid,
}

/// A packaged dataset for App Improvement Directory B.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppImprovementDataset {
    pub dataset_id: String,
    pub creator_id: String,
    pub records: Vec<AnonymizedTelemetryRecord>,
    pub dataset_hash: String,
    pub price_gara: u64,
    pub description: String,
    pub status: AppImprovementStatus,
    pub data_uri: String, // CID or IPFS/P2P storage URI
}

/// Configuration parameters for the Differential Privacy & k-Anonymity pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirBPipelineConfig {
    pub k: usize,               // k-anonymity threshold
    pub epsilon: f64,           // privacy budget (for Laplace noise)
    pub speed_sensitivity: f64, // sensitivity of speed query
}

impl Default for DirBPipelineConfig {
    fn default() -> Self {
        Self {
            k: 3,
            epsilon: 1.0,
            speed_sensitivity: 5.0,
        }
    }
}

/// Directory B - App Improvement Data Pipeline.
pub struct DirBPipeline {
    pub config: DirBPipelineConfig,
}

impl DirBPipeline {
    pub fn new(config: DirBPipelineConfig) -> Self {
        Self { config }
    }

    /// Process raw diagnostic records to create an anonymized dataset if k-anonymity is met.
    /// The location grouping key is rounded latitude & longitude to 3 decimal places.
    pub fn process_records(&self, records: &[RawTelemetryRecord]) -> Option<Vec<AnonymizedTelemetryRecord>> {
        // Enforce k-anonymity: group by rounded locations.
        // If a group has fewer than k records, those are completely dropped.
        let mut groups: HashMap<String, Vec<&RawTelemetryRecord>> = HashMap::new();
        for rec in records {
            let lat_rounded = (rec.latitude * 1000.0).round() / 1000.0;
            let lon_rounded = (rec.longitude * 1000.0).round() / 1000.0;
            let key = format!("{:.3},{:.3}", lat_rounded, lon_rounded);
            groups.entry(key).or_default().push(rec);
        }

        let mut anonymized_records = Vec::new();

        for (_key, group) in groups {
            // Drop groups that violate k-anonymity
            if group.len() < self.config.k {
                continue;
            }

            for rec in group {
                // 1. Redact vehicle ID using SHA-256
                let mut hasher = Sha256::new();
                hasher.update(rec.vehicle_id.as_bytes());
                let vehicle_pseudonym = hex::encode(hasher.finalize());

                // 2. Hour bucket timestamp (bucketing to nearest hour in seconds, e.g. 3600s)
                let timestamp_hour_bucket = rec.timestamp - (rec.timestamp % 3600);

                // 3. Add Laplace noise to speed
                let noise = self.generate_laplace_noise();
                let speed_dp = (rec.speed + noise).max(0.0); // speeds can't be negative

                // 4. Round lat/lon to 3 decimal places
                let latitude_rounded = (rec.latitude * 1000.0).round() / 1000.0;
                let longitude_rounded = (rec.longitude * 1000.0).round() / 1000.0;

                // 5. Binary flag for OBD Issue
                let has_obd_issue = !rec.obd_dtc_codes.is_empty();

                anonymized_records.push(AnonymizedTelemetryRecord {
                    vehicle_pseudonym,
                    timestamp_hour_bucket,
                    speed_dp,
                    latitude_rounded,
                    longitude_rounded,
                    has_obd_issue,
                });
            }
        }

        if anonymized_records.is_empty() {
            None
        } else {
            Some(anonymized_records)
        }
    }

    /// Generates Laplace noise based on epsilon and sensitivity parameters.
    fn generate_laplace_noise(&self) -> f64 {
        let scale = self.config.speed_sensitivity / self.config.epsilon;
        let u: f64 = rand::random::<f64>() - 0.5;
        -scale * u.signum() * (1.0 - 2.0 * u.abs()).ln()
    }
}

/// Simulated Community DAO & Registry for App Improvement datasets (Directory B).
pub struct DirBRegistry {
    pub datasets: HashMap<String, AppImprovementDataset>,
    pub treasury_balance_gara: u64,
}

impl DirBRegistry {
    pub fn new(initial_treasury_gara: u64) -> Self {
        Self {
            datasets: HashMap::new(),
            treasury_balance_gara: initial_treasury_gara,
        }
    }

    /// Register a newly prepared App Improvement dataset.
    pub fn register_dataset(
        &mut self,
        creator_id: String,
        records: Vec<AnonymizedTelemetryRecord>,
        description: String,
        price_gara: u64,
        data_uri: String,
    ) -> Result<String, String> {
        if records.is_empty() {
            return Err("Cannot register an empty dataset".to_string());
        }

        // Generate dataset ID based on hash of records representation
        let mut hasher = Sha256::new();
        hasher.update(description.as_bytes());
        for rec in &records {
            hasher.update(rec.vehicle_pseudonym.as_bytes());
            hasher.update(&rec.timestamp_hour_bucket.to_le_bytes());
            hasher.update(&rec.speed_dp.to_le_bytes());
        }
        let dataset_hash = hex::encode(hasher.finalize());
        let dataset_id = format!("ds_dir_b_{}", &dataset_hash[..16]);

        let dataset = AppImprovementDataset {
            dataset_id: dataset_id.clone(),
            creator_id,
            records,
            dataset_hash,
            price_gara,
            description,
            status: AppImprovementStatus::Prepared,
            data_uri,
        };

        self.datasets.insert(dataset_id.clone(), dataset);
        Ok(dataset_id)
    }

    /// Submit dataset to DAO for community purchase voting.
    pub fn submit_proposal(&mut self, dataset_id: &str) -> Result<(), String> {
        let dataset = self.datasets.get_mut(dataset_id).ok_or_else(|| "Dataset not found".to_string())?;
        if dataset.status != AppImprovementStatus::Prepared {
            return Err("Dataset is not in Prepared status".to_string());
        }

        dataset.status = AppImprovementStatus::ProposalSubmitted;
        Ok(())
    }

    /// Transition dataset status to active voting.
    pub fn start_voting(&mut self, dataset_id: &str) -> Result<(), String> {
        let dataset = self.datasets.get_mut(dataset_id).ok_or_else(|| "Dataset not found".to_string())?;
        if dataset.status != AppImprovementStatus::ProposalSubmitted {
            return Err("No submitted proposal found for this dataset".to_string());
        }

        dataset.status = AppImprovementStatus::Voting;
        Ok(())
    }

    /// Resolve voting results (DAO vote outcome).
    pub fn resolve_vote(&mut self, dataset_id: &str, approved: bool) -> Result<(), String> {
        let dataset = self.datasets.get_mut(dataset_id).ok_or_else(|| "Dataset not found".to_string())?;
        if dataset.status != AppImprovementStatus::Voting {
            return Err("Dataset is not currently in the Voting phase".to_string());
        }

        if approved {
            dataset.status = AppImprovementStatus::Approved;
        } else {
            dataset.status = AppImprovementStatus::Rejected;
        }
        Ok(())
    }

    /// Pay the developer/creator from the treasury for approved datasets.
    pub fn execute_treasury_payout(&mut self, dataset_id: &str) -> Result<String, String> {
        let (price_gara, creator_id) = {
            let dataset = self.datasets.get(dataset_id).ok_or_else(|| "Dataset not found".to_string())?;
            if dataset.status != AppImprovementStatus::Approved {
                return Err("Dataset is not approved for purchase".to_string());
            }
            (dataset.price_gara, dataset.creator_id.clone())
        };

        // Enforce Treasury Spending Limits (e.g. max 1,000,000 GARA per dataset purchase)
        const SPENDING_LIMIT_CAP: u64 = 1_000_000;
        if price_gara > SPENDING_LIMIT_CAP {
            return Err("Purchase exceeds individual spending cap limit of 1,000,000 GARA".to_string());
        }

        if self.treasury_balance_gara < price_gara {
            return Err("Insufficient funds in GARA community treasury".to_string());
        }

        self.treasury_balance_gara -= price_gara;

        let dataset = self.datasets.get_mut(dataset_id).unwrap();
        dataset.status = AppImprovementStatus::Paid;

        Ok(format!(
            "Successfully paid {} GARA to creator {} for dataset {}. Data access granted: {}",
            price_gara, creator_id, dataset_id, dataset.data_uri
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dir_b_pipeline_k_anonymity_filtering() {
        let config = DirBPipelineConfig {
            k: 3,
            epsilon: 1.0,
            speed_sensitivity: 1.0,
        };
        let pipeline = DirBPipeline::new(config);

        // Group 1 (Madrid coords) has 3 records -> meets k-anonymity (k=3)
        // Group 2 (Barcelona coords) has 2 records -> fails k-anonymity, should be filtered out
        let records = vec![
            RawTelemetryRecord {
                vehicle_id: "veh_1".to_string(),
                timestamp: 1623456000,
                speed: 45.0,
                latitude: 40.416823,
                longitude: -3.703811,
                obd_dtc_codes: vec!["P0300".to_string()],
            },
            RawTelemetryRecord {
                vehicle_id: "veh_2".to_string(),
                timestamp: 1623456100,
                speed: 50.0,
                latitude: 40.417001,
                longitude: -3.704002,
                obd_dtc_codes: vec![],
            },
            RawTelemetryRecord {
                vehicle_id: "veh_3".to_string(),
                timestamp: 1623456200,
                speed: 48.0,
                latitude: 40.416550,
                longitude: -3.703550,
                obd_dtc_codes: vec![],
            },
            RawTelemetryRecord {
                vehicle_id: "veh_4".to_string(),
                timestamp: 1623456000,
                speed: 60.0,
                latitude: 41.385064,
                longitude: 2.173404,
                obd_dtc_codes: vec![],
            },
            RawTelemetryRecord {
                vehicle_id: "veh_5".to_string(),
                timestamp: 1623456100,
                speed: 62.0,
                latitude: 41.385200,
                longitude: 2.173600,
                obd_dtc_codes: vec![],
            },
        ];

        let processed = pipeline.process_records(&records).expect("Should process records");

        // Out of 5 records, only Group 1 (3 records) meets k=3. Group 2 (2 records) should be dropped.
        assert_eq!(processed.len(), 3);

        for rec in &processed {
            // Confirm coordinates are rounded to 3 decimal places (approx 40.417 and -3.704)
            assert_eq!(rec.latitude_rounded, 40.417);
            assert_eq!(rec.longitude_rounded, -3.704);

            // Vehicle pseudonyms must be randomized/hashed (not match plain "veh_1")
            assert_ne!(rec.vehicle_pseudonym, "veh_1");
            assert_ne!(rec.vehicle_pseudonym, "veh_2");
            assert_ne!(rec.vehicle_pseudonym, "veh_3");
            assert_eq!(rec.vehicle_pseudonym.len(), 64); // SHA-256 hex string

            // Timestamp hour bucket check (1623456000 % 3600 = 0, so should be 1623456000)
            assert_eq!(rec.timestamp_hour_bucket, 1623456000);

            // Speed should be fuzzily perturbed (not exactly original speeds)
            // It can be any f64, we just check DP speed is positive
            assert!(rec.speed_dp >= 0.0);
        }

        // Check OBD issues flag mapping (veh_1 had codes, veh_2 and veh_3 did not)
        let has_obd_count = processed.iter().filter(|r| r.has_obd_issue).count();
        assert_eq!(has_obd_count, 1);
    }

    #[test]
    fn test_dir_b_pipeline_k_anonymity_entirely_dropped() {
        let config = DirBPipelineConfig {
            k: 5,
            epsilon: 1.0,
            speed_sensitivity: 1.0,
        };
        let pipeline = DirBPipeline::new(config);

        let records = vec![
            RawTelemetryRecord {
                vehicle_id: "veh_1".to_string(),
                timestamp: 1623456000,
                speed: 45.0,
                latitude: 40.416823,
                longitude: -3.703811,
                obd_dtc_codes: vec![],
            },
        ];

        let processed = pipeline.process_records(&records);
        assert!(processed.is_none());
    }

    #[test]
    fn test_dir_b_registry_and_dao_payout_lifecycle() {
        let mut registry = DirBRegistry::new(100_000); // 100k GARA treasury
        let creator = "dev_author_1".to_string();

        let records = vec![
            AnonymizedTelemetryRecord {
                vehicle_pseudonym: "pseudonym_abc".to_string(),
                timestamp_hour_bucket: 1623456000,
                speed_dp: 44.5,
                latitude_rounded: 40.417,
                longitude_rounded: -3.704,
                has_obd_issue: false,
            }
        ];

        let ds_id = registry.register_dataset(
            creator.clone(),
            records,
            "Anonymized Madrid engine performance dataset v1".to_string(),
            5000, // price = 5000 GARA
            "ipfs://QmSomeHashDirectoryB".to_string(),
        ).expect("Registration should succeed");

        // Try voting / payout before submission
        assert!(registry.start_voting(&ds_id).is_err());
        assert!(registry.execute_treasury_payout(&ds_id).is_err());

        // Submit proposal
        registry.submit_proposal(&ds_id).unwrap();
        assert_eq!(registry.datasets.get(&ds_id).unwrap().status, AppImprovementStatus::ProposalSubmitted);

        // Start voting
        registry.start_voting(&ds_id).unwrap();
        assert_eq!(registry.datasets.get(&ds_id).unwrap().status, AppImprovementStatus::Voting);

        // Approve proposal
        registry.resolve_vote(&ds_id, true).unwrap();
        assert_eq!(registry.datasets.get(&ds_id).unwrap().status, AppImprovementStatus::Approved);

        // Execute payout from treasury
        let payout_msg = registry.execute_treasury_payout(&ds_id).unwrap();
        assert!(payout_msg.contains("Successfully paid"));
        assert!(payout_msg.contains("ipfs://QmSomeHashDirectoryB"));

        // Check registry state
        assert_eq!(registry.datasets.get(&ds_id).unwrap().status, AppImprovementStatus::Paid);
        assert_eq!(registry.treasury_balance_gara, 95_000); // 100k - 5k = 95k GARA left
    }

    #[test]
    fn test_dir_b_registry_rejected_proposal() {
        let mut registry = DirBRegistry::new(50_000);
        let creator = "dev_author_2".to_string();

        let records = vec![
            AnonymizedTelemetryRecord {
                vehicle_pseudonym: "pseudonym_xyz".to_string(),
                timestamp_hour_bucket: 1623456000,
                speed_dp: 30.2,
                latitude_rounded: 41.385,
                longitude_rounded: 2.173,
                has_obd_issue: true,
            }
        ];

        let ds_id = registry.register_dataset(
            creator,
            records,
            "Anonymized Barcelona diagnostics".to_string(),
            1000,
            "ipfs://QmRejectedHash".to_string(),
        ).unwrap();

        registry.submit_proposal(&ds_id).unwrap();
        registry.start_voting(&ds_id).unwrap();

        // Reject
        registry.resolve_vote(&ds_id, false).unwrap();
        assert_eq!(registry.datasets.get(&ds_id).unwrap().status, AppImprovementStatus::Rejected);

        // Payout should fail
        assert!(registry.execute_treasury_payout(&ds_id).is_err());
        assert_eq!(registry.treasury_balance_gara, 50_000); // balance intact
    }

    #[test]
    fn test_dir_b_registry_spending_limit_exceeded() {
        let mut registry = DirBRegistry::new(2_000_000);
        let creator = "dev_author_3".to_string();

        let records = vec![
            AnonymizedTelemetryRecord {
                vehicle_pseudonym: "pseudonym_limit".to_string(),
                timestamp_hour_bucket: 1623456000,
                speed_dp: 20.0,
                latitude_rounded: 12.0,
                longitude_rounded: 34.0,
                has_obd_issue: false,
            }
        ];

        // Register with price exceeding limit (e.g. 1,000,001 GARA)
        let ds_id = registry.register_dataset(
            creator,
            records,
            "Dataset exceeding spending limit".to_string(),
            1_000_001,
            "ipfs://QmExceeded".to_string(),
        ).unwrap();

        registry.submit_proposal(&ds_id).unwrap();
        registry.start_voting(&ds_id).unwrap();
        registry.resolve_vote(&ds_id, true).unwrap();

        // Payout should fail due to individual limit
        let payout_res = registry.execute_treasury_payout(&ds_id);
        assert!(payout_res.is_err());
        assert!(payout_res.unwrap_err().contains("exceeds individual spending cap limit"));
        assert_eq!(registry.treasury_balance_gara, 2_000_000); // treasury intact
    }
}
