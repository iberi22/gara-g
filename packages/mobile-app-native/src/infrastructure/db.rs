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

    // La clave y la conexion se publican JUNTAS al final, con el guardia de
    // ENCRYPTION_KEY vivo hasta que la conexion esta dentro: asi ningun escritor
    // puede cifrar con la clave nueva y escribirla en la conexion vieja (o en
    // ninguna), y un fallo de `open`/`PRAGMA key`/`CREATE TABLE` deja intactas la
    // clave y la conexion anteriores.
    //
    // Este orden (ENCRYPTION_KEY y luego DB) no cierra el ciclo ABBA porque los
    // lectores copian el ciphertext y SUELTAN DB antes de descifrar: ningun
    // camino mantiene DB mientras pide ENCRYPTION_KEY (ver read_key,
    // read_telemetry y query_telemetry).
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

    {
        let mut key_guard = ENCRYPTION_KEY.lock().unwrap();
        *key_guard = Some(strengthened_key);
        let mut db_guard = DB.lock().unwrap();
        *db_guard = Some(conn);
    } // DB drops first, then ENCRYPTION_KEY

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
    // El ciphertext se copia bajo DB y el guardia se suelta ANTES de descifrar:
    // descifrar toma ENCRYPTION_KEY y ningun camino puede tener DB mientras pide
    // la clave (seria la mitad del ciclo ABBA con init_db).
    let encrypted: Option<Vec<u8>> = {
        let db_guard = DB.lock().unwrap();
        if let Some(conn) = &*db_guard {
            let mut stmt = conn.prepare("SELECT value FROM kv_store WHERE key = ?1")?;
            let mut rows = stmt.query(params![key])?;
            match rows.next()? {
                Some(row) => Some(row.get(0)?),
                None => None,
            }
        } else {
            None
        }
    };

    match encrypted {
        Some(ciphertext) => Ok(Some(decrypt(&ciphertext)?)),
        None => Ok(None),
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
    // Igual que read_key: se copian los ciphertext bajo DB, se suelta el guardia
    // y se descifra despues. Mientras DB vive no se toca ENCRYPTION_KEY.
    let encrypted: Vec<(i64, Vec<u8>)> = {
        let db_guard = DB.lock().unwrap();
        if let Some(conn) = &*db_guard {
            let mut stmt = conn.prepare("SELECT id, payload FROM telemetry WHERE synced = 0")?;
            let rows = stmt.query_map([], |row| {
                let id: i64 = row.get(0)?;
                let payload: Vec<u8> = row.get(1)?;
                Ok((id, payload))
            })?;

            let mut collected = Vec::new();
            for row in rows {
                if let Ok(item) = row {
                    collected.push(item);
                }
            }
            collected
        } else {
            Vec::new()
        }
    };

    // Mismo comportamiento que antes: una fila que no descifra se omite.
    let mut results = Vec::new();
    for (id, payload) in encrypted {
        if let Ok(decrypted) = decrypt(&payload) {
            results.push(TelemetryRecord { id, payload: decrypted });
        }
    }
    Ok(results)
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
        // Los ciphertext se copian bajo DB y el guardia se suelta antes de
        // descifrar: descifrar toma ENCRYPTION_KEY y este camino no puede tener
        // DB a la vez (ver read_key). No hay `.await` bajo el guardia.
        let encrypted: Vec<Vec<u8>> = {
            let db_guard = DB.lock().unwrap();
            if let Some(conn) = &*db_guard {
                let mut stmt = conn.prepare("SELECT payload FROM telemetry WHERE timestamp >= ?1 AND timestamp <= ?2")?;
                let rows = stmt.query_map(params![start_time, end_time], |row| {
                    let payload: Vec<u8> = row.get(0)?;
                    Ok(payload)
                })?;

                let mut collected = Vec::new();
                for row in rows {
                    if let Ok(payload) = row {
                        collected.push(payload);
                    }
                }
                collected
            } else {
                Vec::new()
            }
        };

        // Se intenta deserializar como SensorData. Si `log_telemetry` se uso para
        // otra cosa, la fila se omite (mismo comportamiento que antes).
        let mut data_points = Vec::new();
        for payload in encrypted {
            if let Ok(decrypted) = decrypt(&payload) {
                if let Ok(sensor_data) = bincode::deserialize::<SensorData>(&decrypted) {
                    data_points.push(sensor_data);
                }
            }
        }

        Ok(TelemetryBatch {
            id: [0u8; 32], // Placeholder
            data_points,
            merkle_root: [0u8; 32], // Placeholder
            created_at: chrono::Utc::now().timestamp_millis(),
        })
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

    /// Los tests comparten el estado GLOBAL del modulo (`DB` y `ENCRYPTION_KEY`) y cargo
    /// los corre en hilos paralelos: mientras uno llama a `init_db` con su directorio,
    /// otro puede quedarse con esa misma conexion y esa misma clave, y las aserciones de
    /// ambos pasan a depender del orden. Este candado los pone en fila (no cambia lo que
    /// comprueban).
    static DB_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        DB_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn temp_dir() -> String {
        let dir = std::env::temp_dir().join(format!("gara_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    #[test]
    fn test_encryption_enforced() {
        let _serial = serial();
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
        let _serial = serial();
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
        let _serial = serial();
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
        let _serial = serial();
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
        let encrypted_data: Vec<u8> = {
            let db_guard = DB.lock().unwrap();
            if let Some(conn) = &*db_guard {
                let mut stmt = conn.prepare("SELECT packet_data FROM telemetry_log").unwrap();
                let mut rows = stmt.query([]).unwrap();
                let row = rows.next().unwrap().unwrap();
                row.get(0).unwrap()
            } else {
                panic!("DB not initialized");
            }
        };

        // Decrypt and deserialize con DB ya libre: descifrar toma ENCRYPTION_KEY y
        // ningun camino mantiene DB mientras pide la clave.
        let decrypted_data = decrypt(&encrypted_data).unwrap();
        let decoded_packet: SafetyPacket = bincode::deserialize(&decrypted_data).unwrap();

        assert_eq!(decoded_packet.temp_id, packet.temp_id);
        assert_eq!(decoded_packet.lat, packet.lat);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_telemetry_sync_marking() {
        let _serial = serial();
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

    /// `init_db` (publica clave y conexion), los lectores (`read_key`,
    /// `read_telemetry`, `query_telemetry`) y los escritores (`save_key`,
    /// `log_telemetry`) comparten los dos candados globales. Cuando `init_db`
    /// mantenia ENCRYPTION_KEY mientras tomaba DB y los lectores tomaban DB
    /// mientras descifraban (ENCRYPTION_KEY), dos hilos se quedaban bloqueados
    /// para siempre: era el cuelgue de los tests de este modulo.
    ///
    /// Este test los mete a pelear a proposito. Si el ciclo vuelve, uno de los
    /// hilos no avisa por el canal y salta el `recv_timeout`: el fallo se ve
    /// como panic del test, no como un cuelgue del binario.
    #[test]
    fn test_init_db_concurrent_with_readers_and_writers_does_not_deadlock() {
        let _serial = serial();
        use std::sync::mpsc;
        use std::time::Duration;

        const INIT_ITERATIONS: usize = 20;
        const CHURN_ITERATIONS: usize = 20;
        const CHURN_THREADS: usize = 4;
        const BUDGET: Duration = Duration::from_secs(60);

        let (done_tx, done_rx) = mpsc::channel::<&'static str>();

        // Hilo que publica clave y conexion una y otra vez, con claves distintas.
        let init_done = done_tx.clone();
        let init = std::thread::spawn(move || {
            for i in 0..INIT_ITERATIONS {
                let dir = temp_dir();
                let key = vec![(i as u8).wrapping_add(1); 32];
                assert!(init_db(dir.clone(), key).is_ok(), "init_db fallo en la iteracion {i}");
                // El fichero se puede borrar aunque la conexion siga abierta.
                let _ = fs::remove_dir_all(&dir);
            }
            init_done.send("init_db").unwrap();
        });

        // Hilos de lectores/escritores: leen, cifran y escriben sin parar
        // mientras el otro hilo reinicia el vault.
        let mut churn = Vec::new();
        for t in 0..CHURN_THREADS {
            let churn_done = done_tx.clone();
            churn.push(std::thread::spawn(move || {
                let adapter = SqliteDatabaseAdapter::new();
                let rt = tokio::runtime::Builder::new_current_thread()
                    .build()
                    .expect("runtime de tokio para query_telemetry");
                let carga = vec![t as u8; 4 * 1024];
                for i in 0..CHURN_ITERATIONS {
                    let _ = read_key("churn");
                    let _ = rt.block_on(adapter.query_telemetry(0, i64::MAX));
                    let _ = log_telemetry(carga.clone());
                    let _ = read_telemetry();
                    let _ = save_key("churn", &carga[..carga.len() - i % carga.len()]);
                }
                churn_done.send("lectores/escritores").unwrap();
            }));
        }

        for _ in 0..CHURN_THREADS + 1 {
            let who = done_rx.recv_timeout(BUDGET).unwrap_or_else(|_| {
                panic!(
                    "deadlock: init_db y los lectores/escritores no terminaron en {} s",
                    BUDGET.as_secs()
                )
            });
            assert!(who == "init_db" || who == "lectores/escritores");
        }

        init.join().expect("el hilo de init_db panicó");
        for hilo in churn {
            hilo.join().expect("un hilo de lectores/escritores panicó");
        }

        // Con el vaiven terminado, el vault sigue usable: lo que se escribe
        // despues de un init se descifra con la clave que publico ese init.
        let dir = temp_dir();
        let key = [9u8; 32].to_vec();
        assert!(init_db(dir.clone(), key).is_ok());
        let payload = b"post-init";
        assert!(save_key("post_init", payload).is_ok());
        assert_eq!(read_key("post_init").unwrap(), Some(payload.to_vec()));

        let _ = fs::remove_dir_all(dir);
    }

    /// Version determinista del test anterior: no espera a que la carrera se
    /// de, comprueba la invariante en el momento exacto.
    ///
    /// Un lector puede tener DB en la mano, pero no puede pedir ENCRYPTION_KEY
    /// mientras la tiene: eso es la mitad del ciclo ABBA. Aqui el test se queda
    /// con la clave y lanza el lector; si el lector suelta DB antes de
    /// descifrar, DB vuelve a estar libre. Si la mantiene, `DB.try_lock()`
    /// nunca entra y el test falla.
    fn assert_reader_no_toma_db_y_clave_a_la_vez(
        quien: &str,
        lector: impl FnOnce() + Send + 'static,
    ) {
        use std::time::Duration;

        let key_guard = ENCRYPTION_KEY.lock().unwrap();
        let hilo = std::thread::spawn(lector);

        // Margen para que el lector arranque y llegue al descifrado (que es
        // donde espera la clave). Sin esto el primer `try_lock` entra antes de
        // que el hilo haga nada y el test pasaria sin comprobar nada.
        std::thread::sleep(Duration::from_millis(100));

        let mut db_libre = false;
        for _ in 0..400 {
            if let Ok(guard) = DB.try_lock() {
                drop(guard);
                db_libre = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }

        drop(key_guard);
        hilo.join().expect("el hilo lector panicó");

        assert!(
            db_libre,
            "`{quien}` mantiene DB mientras espera ENCRYPTION_KEY (ciclo ABBA)"
        );
    }

    #[test]
    fn test_readers_do_not_hold_db_while_taking_the_key() {
        let _serial = serial();
        let dir = temp_dir();
        assert!(init_db(dir.clone(), [6u8; 32].to_vec()).is_ok());
        assert!(save_key("probe", b"probe-value").is_ok());
        assert!(log_telemetry(vec![7u8; 512]).is_ok());

        assert_reader_no_toma_db_y_clave_a_la_vez("read_key", || {
            let _ = read_key("probe");
        });
        assert_reader_no_toma_db_y_clave_a_la_vez("read_telemetry", || {
            let _ = read_telemetry();
        });

        let adapter = SqliteDatabaseAdapter::new();
        assert_reader_no_toma_db_y_clave_a_la_vez("query_telemetry", move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .build()
                .expect("runtime de tokio");
            let _ = rt.block_on(adapter.query_telemetry(0, i64::MAX));
        });

        let _ = fs::remove_dir_all(dir);
    }
}
