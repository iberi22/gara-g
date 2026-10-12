use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceRecord {
    pub hex_id: u64,
    pub timestamp: u64,
    pub price: u64,         // in smallest GARA unit
    pub volume: u64,        // number of data submissions
}

pub struct DataValuationPredictor {
    /// Historical price records per hex per time slot
    pub history: HashMap<u64, Vec<PriceRecord>>,
    /// Window size for moving average (in epochs)
    pub window_size: usize,
}

impl DataValuationPredictor {
    pub fn new(window_size: usize) -> Self {
        Self {
            history: HashMap::new(),
            window_size,
        }
    }

    /// Get predicted price for a hex based on moving average (volume-weighted)
    pub fn predict_price(&self, hex_id: u64) -> Option<u64> {
        let records = self.history.get(&hex_id)?;
        if records.is_empty() {
            return None;
        }

        let window = if records.len() > self.window_size {
            &records[records.len() - self.window_size..]
        } else {
            &records[..]
        };

        let total_volume: u64 = window.iter().map(|r| r.volume).sum();
        if total_volume == 0 {
            // If all volumes are 0, fall back to simple average of prices
            let total_price: u64 = window.iter().map(|r| r.price).sum();
            return Some(total_price / window.len() as u64);
        }

        let weighted_price_sum: u128 = window.iter()
            .map(|r| r.price as u128 * r.volume as u128)
            .sum();

        Some((weighted_price_sum / total_volume as u128) as u64)
    }

    /// Get demand score (0-100) for a hex
    pub fn demand_score(&self, hex_id: u64) -> u8 {
        let records = match self.history.get(&hex_id) {
            Some(r) if !r.is_empty() => r,
            _ => return 0,
        };

        let current_volume = records.last().unwrap().volume;

        let window = if records.len() > self.window_size {
            &records[records.len() - self.window_size..]
        } else {
            &records[..]
        };

        let avg_volume = window.iter().map(|r| r.volume).sum::<u64>() as f64 / window.len() as f64;

        if avg_volume == 0.0 {
            return if current_volume > 0 { 100 } else { 0 };
        }

        let score = (current_volume as f64 / avg_volume * 50.0) as u64;
        score.min(100) as u8
    }

    /// Record a new price observation
    pub fn record_price(&mut self, record: PriceRecord) {
        let entry = self.history.entry(record.hex_id).or_insert_with(Vec::new);
        entry.push(record);

        // Keep history size manageable (optionally)
        // For now, we only care about the window_size for calculations
        // but we might want to prune very old records.
        if entry.len() > self.window_size * 2 {
             entry.drain(0..entry.len() - self.window_size * 2);
        }
    }

    /// Calculate volatility index for a hex (std_dev of prices in window)
    pub fn volatility(&self, hex_id: u64) -> f64 {
        let records = match self.history.get(&hex_id) {
            Some(r) if !r.is_empty() => r,
            _ => return 0.0,
        };

        let window = if records.len() > self.window_size {
            &records[records.len() - self.window_size..]
        } else {
            &records[..]
        };

        let prices: Vec<f64> = window.iter().map(|r| r.price as f64).collect();
        let mean = prices.iter().sum::<f64>() / prices.len() as f64;
        let variance = prices.iter()
            .map(|p| {
                let diff = p - mean;
                diff * diff
            })
            .sum::<f64>() / prices.len() as f64;

        variance.sqrt()
    }
}
