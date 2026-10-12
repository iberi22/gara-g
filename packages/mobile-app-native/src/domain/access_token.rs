//! Access Token Module for mobile-app-native.
//!
//! Handles token generation, scope checking, revocation, and rate limiting per token.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Target actions in the marketplace requiring authorization.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TokenScope {
    /// Action to list telemetry or other data packages for sale.
    List,
    /// Action to buy listed data packages.
    Buy,
    /// Action to arbitrate disputes within the marketplace.
    Arbitrate,
}

/// Cryptographic Access Token representation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessToken {
    /// Unique identifier for the token.
    pub token_id: String,
    /// Authorized client or user ID.
    pub client_id: String,
    /// Authorized operations.
    pub scopes: Vec<TokenScope>,
    /// Issue timestamp (Unix epoch in seconds).
    pub issued_at: u64,
    /// Expiration timestamp (Unix epoch in seconds, 0 for permanent).
    pub expires_at: u64,
    /// Maximum allowed requests per window.
    pub rate_limit_max: u32,
    /// Sliding window duration in seconds.
    pub rate_limit_window_secs: u64,
}

impl AccessToken {
    /// Check if the token is expired given the current Unix time in seconds.
    pub fn is_expired(&self, current_time: u64) -> bool {
        self.expires_at > 0 && current_time >= self.expires_at
    }

    /// Check if the token has the required scope.
    pub fn has_scope(&self, required_scope: TokenScope) -> bool {
        self.scopes.contains(&required_scope)
    }
}

/// Keeps track of timestamps of requests for sliding-window rate limiting.
#[derive(Debug, Clone, Default)]
pub struct RateLimitTracker {
    /// Timestamps of requests in milliseconds.
    pub requests: Vec<u64>,
}

/// Access Token System manager.
#[derive(Debug, Clone, Default)]
pub struct AccessTokenManager {
    /// Active access tokens indexed by token ID.
    pub tokens: HashMap<String, AccessToken>,
    /// Blacklisted token IDs and revocation times.
    pub revoked_tokens: HashMap<String, u64>,
    /// Request history per token ID.
    pub rate_limits: HashMap<String, RateLimitTracker>,
}

/// Validation and processing errors for the Access Token System.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenValidationError {
    /// Token not found in the manager.
    NotFound,
    /// Token has expired.
    Expired,
    /// Token has been revoked.
    Revoked,
    /// Token does not possess the required scope.
    InsufficientScope,
    /// Token has exceeded its rate limit.
    RateLimitExceeded,
}

impl std::fmt::Display for TokenValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenValidationError::NotFound => write!(f, "Access token not found"),
            TokenValidationError::Expired => write!(f, "Access token has expired"),
            TokenValidationError::Revoked => write!(f, "Access token has been revoked"),
            TokenValidationError::InsufficientScope => write!(f, "Insufficient scope for action"),
            TokenValidationError::RateLimitExceeded => write!(f, "Rate limit exceeded"),
        }
    }
}

impl std::error::Error for TokenValidationError {}

impl AccessTokenManager {
    /// Creates a new, empty `AccessTokenManager`.
    pub fn new() -> Self {
        Self {
            tokens: HashMap::new(),
            revoked_tokens: HashMap::new(),
            rate_limits: HashMap::new(),
        }
    }

    /// Generate and register a new access token.
    pub fn generate_token(
        &mut self,
        client_id: String,
        scopes: Vec<TokenScope>,
        expires_in_secs: u64,
        rate_limit_max: u32,
        rate_limit_window_secs: u64,
    ) -> AccessToken {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let token_id = uuid::Uuid::new_v4().to_string();
        let expires_at = if expires_in_secs > 0 { now + expires_in_secs } else { 0 };

        let token = AccessToken {
            token_id: token_id.clone(),
            client_id,
            scopes,
            issued_at: now,
            expires_at,
            rate_limit_max,
            rate_limit_window_secs,
        };

        self.tokens.insert(token_id, token.clone());
        token
    }

    /// Validate token existence, expiration, revocation, and scope.
    pub fn validate_token(&self, token_id: &str, required_scope: TokenScope) -> Result<(), TokenValidationError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        if self.revoked_tokens.contains_key(token_id) {
            return Err(TokenValidationError::Revoked);
        }

        let token = self.tokens.get(token_id).ok_or(TokenValidationError::NotFound)?;

        if token.is_expired(now) {
            return Err(TokenValidationError::Expired);
        }

        if !token.has_scope(required_scope) {
            return Err(TokenValidationError::InsufficientScope);
        }

        Ok(())
    }

    /// Checks and updates the sliding-window rate limit for a token.
    pub fn check_rate_limit(&mut self, token_id: &str) -> Result<(), TokenValidationError> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let token = self.tokens.get(token_id).ok_or(TokenValidationError::NotFound)?;

        if token.rate_limit_max == 0 || token.rate_limit_window_secs == 0 {
            // Dynamic check: 0 limit or window disables rate limiting for this token
            return Ok(());
        }

        let tracker = self.rate_limits.entry(token_id.to_string()).or_default();

        let window_start = now_ms.saturating_sub(token.rate_limit_window_secs * 1000);
        tracker.requests.retain(|&t| t >= window_start);

        if tracker.requests.len() >= token.rate_limit_max as usize {
            return Err(TokenValidationError::RateLimitExceeded);
        }

        tracker.requests.push(now_ms);
        Ok(())
    }

    /// Revokes an existing access token by adding it to the blacklist.
    pub fn revoke_token(&mut self, token_id: &str) -> Result<(), TokenValidationError> {
        if !self.tokens.contains_key(token_id) {
            return Err(TokenValidationError::NotFound);
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        self.revoked_tokens.insert(token_id.to_string(), now);
        Ok(())
    }
}

#[cfg(test)]
#[path = "../../tests/application/access_token_tests.rs"]
mod tests;
