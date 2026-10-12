//! User preferences for opting into notification types and filtering by distance and category.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OptInPreferences {
    pub notifications_enabled: bool,
    pub categories: Vec<String>,
    pub min_distance_km: f64,
    pub max_distance_km: f64,
}

impl Default for OptInPreferences {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            categories: vec![
                "new_listings".to_string(),
                "price_drops".to_string(),
                "deals".to_string(),
            ],
            min_distance_km: 0.0,
            max_distance_km: 50.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::marketplace_use_cases::{
        P2PNotificationRelayUseCase, MarketplaceListing,
    };

    #[test]
    fn test_opt_in_preferences_default() {
        let prefs = OptInPreferences::default();
        assert!(prefs.notifications_enabled);
        assert_eq!(prefs.categories.len(), 3);
        assert!(prefs.categories.contains(&"new_listings".to_string()));
        assert!(prefs.categories.contains(&"price_drops".to_string()));
        assert!(prefs.categories.contains(&"deals".to_string()));
        assert_eq!(prefs.min_distance_km, 0.0);
        assert_eq!(prefs.max_distance_km, 50.0);
    }

    #[test]
    fn test_process_and_relay_success() {
        let prefs = OptInPreferences::default();
        let use_case = P2PNotificationRelayUseCase::new();

        let listing = MarketplaceListing {
            id: "listing_123".to_string(),
            category: "new_listings".to_string(),
            price_gara: 500_000,
            distance_km: 12.5,
            title: "NYC High-Density Traffic Dataset".to_string(),
        };

        let result = use_case.process_and_relay(&prefs, &listing);
        assert!(result.is_some());

        let notification = result.unwrap();
        assert_eq!(notification.listing_id, "listing_123");
        assert!(notification.is_relayed);
        assert!(notification.message.contains("NYC High-Density Traffic Dataset"));
        assert!(notification.message.contains("new_listings"));
    }

    #[test]
    fn test_process_and_relay_ignored_when_disabled() {
        let mut prefs = OptInPreferences::default();
        prefs.notifications_enabled = false;
        let use_case = P2PNotificationRelayUseCase::new();

        let listing = MarketplaceListing {
            id: "listing_123".to_string(),
            category: "new_listings".to_string(),
            price_gara: 500_000,
            distance_km: 12.5,
            title: "NYC High-Density Traffic Dataset".to_string(),
        };

        let result = use_case.process_and_relay(&prefs, &listing);
        assert!(result.is_none());
    }

    #[test]
    fn test_process_and_relay_ignored_on_category_mismatch() {
        let prefs = OptInPreferences::default();
        let use_case = P2PNotificationRelayUseCase::new();

        let listing = MarketplaceListing {
            id: "listing_123".to_string(),
            category: "untracked_category".to_string(),
            price_gara: 500_000,
            distance_km: 12.5,
            title: "NYC High-Density Traffic Dataset".to_string(),
        };

        let result = use_case.process_and_relay(&prefs, &listing);
        assert!(result.is_none());
    }

    #[test]
    fn test_process_and_relay_ignored_on_distance_out_of_bounds() {
        let prefs = OptInPreferences::default();
        let use_case = P2PNotificationRelayUseCase::new();

        // Out of bounds: 75.0 km (default max is 50.0)
        let listing_far = MarketplaceListing {
            id: "listing_far".to_string(),
            category: "new_listings".to_string(),
            price_gara: 500_000,
            distance_km: 75.0,
            title: "NYC High-Density Traffic Dataset".to_string(),
        };

        let result_far = use_case.process_and_relay(&prefs, &listing_far);
        assert!(result_far.is_none());

        // Out of bounds: -5.0 km (default min is 0.0)
        let listing_negative = MarketplaceListing {
            id: "listing_neg".to_string(),
            category: "new_listings".to_string(),
            price_gara: 500_000,
            distance_km: -5.0,
            title: "NYC High-Density Traffic Dataset".to_string(),
        };

        let result_neg = use_case.process_and_relay(&prefs, &listing_negative);
        assert!(result_neg.is_none());
    }
}
