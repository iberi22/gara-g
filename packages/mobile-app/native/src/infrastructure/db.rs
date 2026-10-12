//! Secure local vault for telemetry data
//!
//! This module handles the creation and management of an encrypted SQLite
//! database for storing sensitive telemetry data.

use anyhow::Result;
use rusqlite::{Connection, params};
use std::sync::Mutex;
use crate::protocol::SafetyPacket;
use once_cell::sync::Lazy;
use async_trait::async_trait;
use crate::domain::telemetry::{SensorData, TelemetryBatch};

use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce
};
use rand_core::{OsRng, RngCore};

// PBKDF2 imports
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

const DB_FILE: &str = "vault.db";
const KDF_ITERATIONS: u32 = 100_000;

// ============================================================================
// Global State
// ============================================================================

static DB: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));
static ENCRYPTION_KEY: Lazy<Mutex<Option<[u8; 32]>>> = Lazy::new(|| Mutex::new(None));

// ============================================================================
// Internal Helpers
// ============================================================================

/// Derive a secure key using PBKDF2-HMAC-SHA256
fn derive_key(key_bytes: &[u8], app_document_dir: &str) -> [u8; 32] {
    let mut derived_key = [0u8; 32];
    // Use app_document_dir as salt to ensure per-device uniqueness
    let salt = app_document_dir.as_bytes();

    pbkdf2_hmac::<Sha256>(key_bytes, salt, KDF_ITERATIONS, &mut derived_key);

    derived_key
}

// ============================================================================
// Public API
// ============================================================================

/// Initialize the database connection and encryption key
pub fn init_db(app_document_dir: String, key_bytes: Vec<u8>) -> Result<()> {
    if key_bytes.len() != 32 {
        return Err(anyhow::anyhow!("Encryption key must be exactly 32 bytes"));
    }

    // Derive strengthened key via PBKDF2
    let strengthened_key = derive_key(&key_bytes, &app_document_dir);

    let mut key_guard = ENCRYPTION_KEY.lock().unwrap();
    *key_guard = Some(strengthened_key);

    let db_path = format!("{}/{}", app_document_dir, DB_FILE);
    let conn = Connection::open(&db_path)?;

    // Apply SQLCipher encryption key
    let key_hex = hex::encode(&strengthened_key);
    conn.pragma_update(None, "key", &key_hex)?;

    // Create telemetry table if it doesn't exist
    conn.execute(
        "CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            payload BLOB NOT NULL,
            synced BOOLEAN DEFAULT 0
        )",
        [],
    )?;

    // Create KV store table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value BLOB NOT NULL
        )",
        [],
    )?;

    // Create telemetry log table for raw packets
    conn.execute(
        "CREATE TABLE IF NOT EXISTS telemetry_log (
            id INTEGER PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            packet_data BLOB NOT NULL,
            synced BOOLEAN DEFAULT 0
        )",
        [],
    )?;

    let mut db_guard = DB.lock().unwrap();
    *db_guard = Some(conn);

    Ok(())
}

/// Save a key-value pair (encrypted)
pub fn save_key(key: &str, value: &[u8]) -> Result<()> {
    let encrypted = encrypt(value)?;
    let db_guard = DB.lock().unwrap();
    if let Some(conn) = &*db_guard {
        conn.execute(
            "INSERT OR REPLACE INTO kv_store (key, value) VALUES (?1, ?2)",
            params![key, encrypted],
        )?;
    }
    Ok(())
}

/// Save a raw telemetry packet
pub fn save_telemetry_packet(packet: &SafetyPacket) -> Result<()> {
    let data = packet.to_bytes();
    let encrypted_payload = encrypt(&data)?;
    let timestamp = chrono::Utc::now().timestamp_millis();

    let db_guard = DB.lock().unwrap();
    if let Some(conn) = &*db_guard {
        conn.execute(
            "INSERT INTO telemetry_log (timestamp, packet_data) VALUES (?1, ?2)",
            params![timestamp, encrypted_payload],
        )?;
    }

    Ok(())
}

/// Read a value by key (decrypted)
pub fn read_key(key: &str) -> Result<Option<Vec<u8>>> {
    let db_guard = DB.lock().unwrap();
    if let Some(conn) = &*db_guard {
        let mut stmt = conn.prepare("SELECT value FROM kv_store WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;

        if let Some(row) = rows.next()? {
            let encrypted: Vec<u8> = row.get(0)?;
            let decrypted = decrypt(&encrypted)?;
            Ok(Some(decrypted))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

/// Log telemetry data
pub fn log_telemetry(data: Vec<u8>) -> Result<()> {
    let encrypted_payload = encrypt(&data)?;
    let timestamp = chrono::Utc::now().timestamp_millis();

    let db_guard = DB.lock().unwrap();
    if let Some(conn) = &*db_guard {
        conn.execute(
            "INSERT INTO telemetry (timestamp, payload) VALUES (?1, ?2)",
            params![timestamp, encrypted_payload],
        )?;
    }

    Ok(())
}

pub struct TelemetryRecord {
    pub id: i64,
    pub payload: Vec<u8>,
}

/// Read unsynced telemetry data
pub fn read_telemetry() -> Result<Vec<TelemetryRecord>> {
    let db_guard = DB.lock().unwrap();
    if let Some(conn) = &*db_guard {
        let mut stmt = conn.prepare("SELECT id, payload FROM telemetry WHERE synced = 0")?;
        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let payload: Vec<u8> = row.get(1)?;
            let decrypted = decrypt(&payload).map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
            Ok(TelemetryRecord { id, payload: decrypted })
        })?;

        let mut results = Vec::new();
        for row in rows {
            if let Ok(record) = row {
                results.push(record);
            }
        }
        Ok(results)
    } else {
        Ok(Vec::new())
    }
}

/// Mark telemetry records as synced
pub fn mark_telemetry_synced(ids: &[i64]) -> Result<()> {
    let mut db_guard = DB.lock().unwrap();
    if let Some(conn) = &mut *db_guard {
        let tx = conn.transaction()?;
        for id in ids {
            tx.execute("UPDATE telemetry SET synced = 1 WHERE id = ?1", params![id])?;
        }
        tx.commit()?;
    }
    Ok(())
}

// ============================================================================
// Database Adapter Implementation
// ============================================================================

#[async_trait]
pub trait DatabaseAdapter: Send + Sync {
    async fn store_telemetry(&self, data: SensorData) -> Result<()>;
    async fn query_telemetry(&self, start_time: i64, end_time: i64) -> Result<TelemetryBatch>;
}

pub struct SqliteDatabaseAdapter;

impl SqliteDatabaseAdapter {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl DatabaseAdapter for SqliteDatabaseAdapter {
    async fn store_telemetry(&self, data: SensorData) -> Result<()> {
        let serialized = bincode::serialize(&data)?;
        log_telemetry(serialized)?;
        Ok(())
    }

    async fn query_telemetry(&self, start_time: i64, end_time: i64) -> Result<TelemetryBatch> {
         let db_guard = DB.lock().unwrap();
        if let Some(conn) = &*db_guard {
            let mut stmt = conn.prepare("SELECT payload FROM telemetry WHERE timestamp >= ?1 AND timestamp <= ?2")?;
            let rows = stmt.query_map(params![start_time, end_time], |row| {
                let payload: Vec<u8> = row.get(0)?;
                let decrypted = decrypt(&payload).map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
                 // We try to deserialize as SensorData. If log_telemetry was used for something else, this might fail,
                 // but for the scope of this adapter, we assume it's used for SensorData.
                 let sensor_data: SensorData = bincode::deserialize(&decrypted).map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
                Ok(sensor_data)
            })?;

            let mut data_points = Vec::new();
            for row in rows {
                if let Ok(data) = row {
                    data_points.push(data);
                }
            }

            Ok(TelemetryBatch {
                id: [0u8; 32], // Placeholder
                data_points,
                merkle_root: [0u8; 32], // Placeholder
                created_at: chrono::Utc::now().timestamp_millis(),
            })

        } else {
             Ok(TelemetryBatch {
                id: [0u8; 32],
                data_points: vec![],
                merkle_root: [0u8; 32],
                created_at: chrono::Utc::now().timestamp_millis(),
            })
        }
    }
}

// ============================================================================
// Encryption / Decryption
// ============================================================================

fn encrypt(data: &[u8]) -> Result<Vec<u8>> {
    let key_guard = ENCRYPTION_KEY.lock().unwrap();
    let key = key_guard.as_ref().ok_or_else(|| anyhow::anyhow!("Encryption key not initialized"))?;

    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, data)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext
    let mut result = Vec::with_capacity(nonce.len() + ciphertext.len());
    result.extend_from_slice(nonce);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

fn decrypt(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < 24 {
        return Err(anyhow::anyhow!("Invalid encrypted data"));
    }

    let key_guard = ENCRYPTION_KEY.lock().unwrap();
    let key = key_guard.as_ref().ok_or_else(|| anyhow::anyhow!("Encryption key not initialized"))?;

    let cipher = XChaCha20Poly1305::new(key.into());
    let (nonce_bytes, ciphertext) = data.split_at(24);
    let nonce = XNonce::from_slice(nonce_bytes);

    let decrypted_payload = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

    Ok(decrypted_payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn temp_dir() -> String {
        let dir = std::env::temp_dir().join(format!("gara_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    #[test]
    fn test_encryption_enforced() {
        // Verify that the database is not accessible without the key
        let dir = temp_dir();
        let db_path = format!("{}/vault.db", dir);
        let test_key = [5u8; 32].to_vec();

        // 1. Initialize and write some data
        assert!(init_db(dir.clone(), test_key.clone()).is_ok());
        save_key("secret", b"hidden_value").unwrap();

        // Close connection by dropping the lock (actually DB is static, so we can't easily "close" it,
        // but we can try to open the file separately)
        {
            let mut db_guard = DB.lock().unwrap();
            *db_guard = None;
        }

        // 2. Try to open the same file without the key
        let conn = Connection::open(&db_path).unwrap();
        // This should fail because the header is encrypted
        let result: Result<String, _> = conn.query_row("SELECT name FROM sqlite_master", [], |r| r.get(0));
        assert!(result.is_err(), "Should not be able to read encrypted DB without key");

        // 3. Try to open with the WRONG key (directly, without KDF)
        let conn_wrong = Connection::open(&db_path).unwrap();
        let wrong_key_hex = hex::encode([7u8; 32]);
        conn_wrong.pragma_update(None, "key", &wrong_key_hex).unwrap();
        let result_wrong: Result<String, _> = conn_wrong.query_row("SELECT name FROM sqlite_master", [], |r| r.get(0));
        assert!(result_wrong.is_err(), "Should not be able to read with wrong key");

        // 4. Verify we can open it with the derived key
        let conn_ok = Connection::open(&db_path).unwrap();
        let ok_key = derive_key(&test_key, &dir);
        let ok_key_hex = hex::encode(ok_key);
        conn_ok.pragma_update(None, "key", &ok_key_hex).unwrap();
        let result_ok: Result<String, _> = conn_ok.query_row("SELECT name FROM sqlite_master", [], |r| r.get(0));
        assert!(result_ok.is_ok(), "Should be able to read with correctly derived key");

        // Cleanup
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_kv_store_roundtrip() {
        // Verify key-value storage and encryption roundtrip
        let dir = temp_dir();
        // Use a test key
        let test_key = [1u8; 32].to_vec();
        assert!(init_db(dir.clone(), test_key).is_ok());

        let key = "user_secret";
        let value = b"super_secret_payload_123";

        // Write
        assert!(save_key(key, value).is_ok());

        // Read back
        let read_result = read_key(key).unwrap();
        assert!(read_result.is_some());
        assert_eq!(read_result.unwrap(), value);

        // Read missing
        let missing = read_key("not_real").unwrap();
        assert!(missing.is_none());

        // Cleanup
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_telemetry_logging() {
        // Verify telemetry logging and retrieval
        let dir = temp_dir();
        // Use a test key
        let test_key = [1u8; 32].to_vec();
        assert!(init_db(dir.clone(), test_key).is_ok());

        let data = vec![1, 2, 3, 4, 5];

        // Log data
        assert!(log_telemetry(data.clone()).is_ok());

        // Read back (decrypted)
        let entries = read_telemetry().unwrap();
        assert!(!entries.is_empty());

        // Check if our data is in there (might be others if tests ran in parallel on same DB, but we use temp dirs)
        // However, 'init_db' switches the GLOBAL 'DB' variable.
        // Race conditions are possible if parallel.
        // We assume valid logic for now.
        let found = entries.iter().any(|e| e.payload == data);
        assert!(found, "Telemetry entry not found");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_save_and_read_telemetry_packet() {
        use crate::protocol::{SafetyPacket, MsgType};
        // Setup
        let dir = temp_dir();
        let test_key = [2u8; 32].to_vec();
        assert!(init_db(dir.clone(), test_key).is_ok());

        // Create a dummy packet
        let packet = SafetyPacket {
            magic: b'G',
            version: 2,
            msg_type: MsgType::Heartbeat,
            network_id: 0,
            hop_count: 0,
            max_hops: 5,
            temp_id: 98765,
            timestamp: 1234567890,
            lat: 12345678,
            lon: 87654321,
            speed_cms: 1500,
            heading: 180,
            events: 1,
        };

        // Save the packet
        assert!(save_telemetry_packet(&packet).is_ok());

        // Read it back (requires a new function or modification)
        // For now, we query the DB directly to verify encryption/storage
        let db_guard = DB.lock().unwrap();
        if let Some(conn) = &*db_guard {
            let mut stmt = conn.prepare("SELECT packet_data FROM telemetry_log").unwrap();
            let mut rows = stmt.query([]).unwrap();
            let row = rows.next().unwrap().unwrap();
            let encrypted_data: Vec<u8> = row.get(0).unwrap();

            // Decrypt and deserialize
            let decrypted_data = decrypt(&encrypted_data).unwrap();
            let decoded_packet: SafetyPacket = bincode::deserialize(&decrypted_data).unwrap();

            assert_eq!(decoded_packet.temp_id, packet.temp_id);
            assert_eq!(decoded_packet.lat, packet.lat);
        } else {
            panic!("DB not initialized");
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_telemetry_sync_marking() {
        // Setup
        let dir = temp_dir();
        let test_key = [3u8; 32].to_vec();
        assert!(init_db(dir.clone(), test_key).is_ok());

        let data1 = vec![10, 20, 30];
        let data2 = vec![40, 50, 60];

        // Log two entries
        assert!(log_telemetry(data1.clone()).is_ok());
        assert!(log_telemetry(data2.clone()).is_ok());

        // Read back and find the ID of the first entry
        let entries_before_sync = read_telemetry().unwrap();
        assert_eq!(entries_before_sync.len(), 2);
        let entry_to_sync = entries_before_sync.iter().find(|e| e.payload == data1).unwrap();

        // Mark the first entry as synced
        assert!(mark_telemetry_synced(&[entry_to_sync.id]).is_ok());

        // Read again, should only get the second entry
        let entries_after_sync = read_telemetry().unwrap();
        assert_eq!(entries_after_sync.len(), 1);
        assert_eq!(entries_after_sync[0].payload, data2);

        // Cleanup
        let _ = fs::remove_dir_all(dir);
    }
}
