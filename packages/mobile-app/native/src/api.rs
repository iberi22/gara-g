//! Flutter API for V2V Communication
//!
//! This module exposes Rust functions to Flutter via flutter_rust_bridge.
//! All public functions here are automatically available in Dart.

use crate::domain::v2v::{
    V2VMessageType, QuickMessage, Position, V2VMessage, V2VWallet,
    RewardTracker, calculate_reward,
};
use crate::domain::marketplace::OptInPreferences;
use crate::application::copilot_use_cases::CopilotEngine;
use crate::ai_processor::{AiProcessor, AnalysisResult};
use crate::domain::dms::Point3D;
use crate::infrastructure::automotive;
use crate::infrastructure::db;
use crate::infrastructure::satellite::SatelliteModem;
use crate::domain::telemetry::{SensorData, Telemetry, AccelerometerData, GyroscopeData};
use crate::protocol::SafetyPacket;
use crate::domain::anonymizer; // Import the anonymizer coverage
use crate::domain::lorawan::LoraPacket;
use crate::domain::sigfox::SigfoxPacket;
use crate::infrastructure::sigfox_interface::SigfoxInterface;
use crate::infrastructure::lora_interface::{LoraInterface, LoraFrequency};
use crate::infrastructure::network_interface::{NetworkInterface, ConnectionStatus};
use crate::video_recorder::{VideoRecorder, RecorderCommand};
use std::sync::Mutex;
// use std::sync::Mutex as StdMutex; // Explicit alias to avoid confusion if needed
use once_cell::sync::Lazy;
use tokio::runtime::Runtime;
use tokio::sync::mpsc;
use tokio::sync::Mutex as TokioMutex;
use crate::frb_generated::StreamSink;
use anyhow::Result;
use reqwest;
use std::collections::{HashSet, VecDeque};
use serde_json::json;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use h3o::{CellIndex, LatLng, Resolution};

pub struct HeatmapCell {
    pub h3_index: String,
    pub weight: f64,
}

pub struct TelemetryDisplayData {
    pub speed: f64,
    pub heading: f64,
    pub altitude: f64,
    pub accuracy: f64,
    pub battery: f64,
    pub signal: f64,
    pub timestamp: i64,
}

struct ApiConfig {
    api_key: String,
    api_url: String,
}

// ============================================================================
// Mesh Relay Logic
// ============================================================================

const CACHE_MAX_SIZE: usize = 1000; // Store last 1000 packet IDs

pub struct PacketCache {
    ids: HashSet<u32>,
    order: VecDeque<u32>,
}

impl PacketCache {
    fn new() -> Self {
        Self {
            ids: HashSet::with_capacity(CACHE_MAX_SIZE),
            order: VecDeque::with_capacity(CACHE_MAX_SIZE),
        }
    }

    /// Checks if a packet ID is a duplicate. If not, stores it.
    /// Returns true if the packet is new, false if it's a duplicate.
    fn check_and_store(&mut self, id: u32) -> bool {
        if self.ids.contains(&id) {
            return false; // Duplicate
        }

        // Evict oldest if cache is full
        if self.order.len() >= CACHE_MAX_SIZE {
            if let Some(oldest_id) = self.order.pop_front() {
                self.ids.remove(&oldest_id);
            }
        }

        // Store new ID
        self.ids.insert(id);
        self.order.push_back(id);
        true // New packet
    }

    fn clear(&mut self) {
        self.ids.clear();
        self.order.clear();
    }
}


// ============================================================================
// Global State (managed by Rust, accessed from Flutter)
// ============================================================================

static RUNTIME: Lazy<Runtime> = Lazy::new(|| Runtime::new().unwrap());
static PACKET_CACHE: Lazy<Mutex<PacketCache>> = Lazy::new(|| Mutex::new(PacketCache::new()));
static WALLET: Lazy<Mutex<Option<V2VWallet>>> = Lazy::new(|| Mutex::new(None));
static REWARD_TRACKER: Lazy<Mutex<RewardTracker>> = Lazy::new(|| Mutex::new(RewardTracker::new()));
static AI_PROCESSOR: Lazy<Mutex<AiProcessor>> = Lazy::new(|| Mutex::new(AiProcessor::new()));
static COPILOT_ENGINE: Lazy<Mutex<CopilotEngine>> = Lazy::new(|| Mutex::new(CopilotEngine::new()));
static API_CONFIG: Lazy<Mutex<Option<ApiConfig>>> = Lazy::new(|| Mutex::new(None));
static OPT_IN_PREFERENCES: Lazy<Mutex<OptInPreferences>> = Lazy::new(|| Mutex::new(OptInPreferences::default()));
static MOCK_WALLET_BALANCE: Lazy<Mutex<u64>> = Lazy::new(|| Mutex::new(1000));

// Telemetry global state
static TELEMETRY: Lazy<TokioMutex<Option<Telemetry>>> = Lazy::new(|| TokioMutex::new(None));

// Gateway global state
static LORA_INTERFACE: Lazy<Mutex<LoraInterface>> = Lazy::new(|| Mutex::new(LoraInterface::new(LoraFrequency::EU868)));
static SIGFOX_INTERFACE: Lazy<Mutex<SigfoxInterface>> = Lazy::new(|| Mutex::new(SigfoxInterface::new()));
static SATELLITE_MODEM: Lazy<Mutex<SatelliteModem>> = Lazy::new(|| Mutex::new(SatelliteModem::new()));

// Dashcam global state
static VIDEO_CHUNK_SENDER: Lazy<Mutex<Option<mpsc::Sender<Vec<u8>>>>> = Lazy::new(|| Mutex::new(None));
static RECORDER_COMMAND_SENDER: Lazy<Mutex<Option<mpsc::Sender<RecorderCommand>>>> = Lazy::new(|| Mutex::new(None));

// ============================================================================
// Database Initialization
// ============================================================================

/// Initializes the database. Must be called once before any other function.
/// `encryption_key` must be a hex-encoded string of 32 bytes (64 hex characters).
pub fn init_database(app_dir: String, encryption_key: String) -> Result<(), String> {
    let key_bytes = hex::decode(encryption_key).map_err(|_e| "Invalid hex encryption key".to_string())?;
    db::init_db(app_dir, key_bytes).map_err(|e| e.to_string())
}

/// Black Box: Log encrypted telemetry
pub fn log_telemetry(data: Vec<u8>) -> Result<(), String> {
    db::log_telemetry(data).map_err(|e| e.to_string())
}

/// Black Box: Read unsynced telemetry
pub fn read_telemetry() -> Result<Vec<Vec<u8>>, String> {
    let records = db::read_telemetry().map_err(|e| e.to_string())?;
    Ok(records.into_iter().map(|r| r.payload).collect())
}

/// Sync pending telemetry to cloud
pub async fn sync_telemetry_to_cloud() -> Result<usize, String> {
    let (api_key, api_url) = {
        let config_guard = API_CONFIG.lock().unwrap();
        match &*config_guard {
            Some(c) => (c.api_key.clone(), c.api_url.clone()),
            None => return Err("API Config not set".to_string()),
        }
    }; // guard dropped here

    let records = db::read_telemetry().map_err(|e| e.to_string())?;
    if records.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::new();
    let mut synced_ids = Vec::new();

    for record in records {
        let b64 = BASE64.encode(&record.payload);
        let body = json!({
            "payload": b64,
            "timestamp": chrono::Utc::now().timestamp_millis() // timestamp is inside payload too, but useful for meta
        });

        match client.post(&api_url)
            .header("X-API-Key", &api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    synced_ids.push(record.id);
                }
            }
            Err(e) => {
                eprintln!("Failed to sync record {}: {}", record.id, e);
            }
        }
    }

    if !synced_ids.is_empty() {
        db::mark_telemetry_synced(&synced_ids).map_err(|e| e.to_string())?;
    }

    Ok(synced_ids.len())
}

// ============================================================================
// Simple API Functions
// ============================================================================

/// Hello world test function
pub fn hello(name: String) -> String {
    format!("Hello, {}! V2V Backend Ready 🚗", name)
}

/// Decode an OBD-II PID response
pub fn decode_obd(pid: u8, data: Vec<u8>) -> String {
    match automotive::parse_pid(pid, &data) {
        Ok(val) => serde_json::to_string(&val).unwrap_or_else(|_| "{\"error\":\"Serialization\"}".to_string()),
        Err(e) => format!("{{\"error\":\"{}\"}}", e)
    }
}

/// Decode VIN from Mode 09 PID 02 response
pub fn decode_vin(data: Vec<u8>) -> Result<String, String> {
    let vin = automotive::parse_vin(&data)?;
    serde_json::to_string(&vin).map_err(|e| e.to_string())
}

/// Parse DTCs from Mode 03 response
pub fn parse_diagnostic_codes(data: Vec<u8>) -> String {
    let codes = automotive::parse_dtcs(&data);
    serde_json::to_string(&codes).unwrap_or_else(|_| "[]".to_string())
}

/// Get all supported PIDs info
pub fn get_supported_pids() -> String {
    let pids = vec![
        json!({"pid": 0x01, "name": "Monitor Status", "unit": "status"}),
        json!({"pid": 0x04, "name": "Engine Load", "unit": "%"}),
        json!({"pid": 0x05, "name": "Coolant Temp", "unit": "°C"}),
        json!({"pid": 0x0C, "name": "Engine RPM", "unit": "rpm"}),
        json!({"pid": 0x0D, "name": "Vehicle Speed", "unit": "km/h"}),
        json!({"pid": 0x0F, "name": "Intake Temp", "unit": "°C"}),
        json!({"pid": 0x11, "name": "Throttle Position", "unit": "%"}),
        json!({"pid": 0x21, "name": "Distance with MIL", "unit": "km"}),
        json!({"pid": 0x2F, "name": "Fuel Level", "unit": "%"}),
        json!({"pid": 0x31, "name": "Distance Since Clear", "unit": "km"}),
        json!({"pid": 0x46, "name": "Ambient Temp", "unit": "°C"}),
        json!({"pid": 0x5C, "name": "Oil Temp", "unit": "°C"}),
        json!({"pid": 0x5E, "name": "Fuel Rate", "unit": "L/h"}),
    ];
    serde_json::to_string(&pids).unwrap()
}

// ============================================================================
// AI/ML Functions
// ============================================================================

/// Set the API key and URL for the external API fallback
pub fn set_api_config(api_key: String, api_url: String) {
    let mut config = API_CONFIG.lock().unwrap();
    *config = Some(ApiConfig { api_key, api_url });
}

/// Analyze a video frame for objects and threats
pub fn analyze_frame(frame_data: Vec<u8>) -> Result<String, String> {
    let mut processor = AI_PROCESSOR.lock().unwrap();
    processor.analyze_frame(&frame_data)
}

/// Analyze an audio buffer for sound events
pub fn analyze_audio(audio_data: Vec<u8>) -> Result<String, String> {
    let processor = AI_PROCESSOR.lock().unwrap();
    processor.analyze_audio(&audio_data)
}

/// Analyze DMS landmarks (Face Mesh)
/// landmarks: flattened array of (x, y, z) triplets
pub fn analyze_driver_status(landmarks: Vec<f32>) -> Result<String, String> {
    crate::dms_bridge::process_dms_landmarks(landmarks)
}

/// Run a full Copilot processing cycle with the latest AI detections
pub fn process_copilot_cycle(vision_analysis_json: String) -> Result<String, String> {
    let analysis: AnalysisResult = serde_json::from_str(&vision_analysis_json)
        .map_err(|e| format!("Invalid analysis JSON: {}", e))?;

    let mut engine = COPILOT_ENGINE.lock().unwrap();
    engine.ingest_vision_analysis(analysis);
    engine.process_cycle();

    Ok(serde_json::to_string(&engine.risk_level).unwrap())
}

/// Get the current risk level from the Copilot Engine
pub fn get_copilot_risk_level() -> String {
    let engine = COPILOT_ENGINE.lock().unwrap();
    serde_json::to_string(&engine.risk_level).unwrap()
}

/// Pop the next high-priority alert from the queue
pub fn get_next_copilot_alert() -> Option<String> {
    let mut engine = COPILOT_ENGINE.lock().unwrap();
    engine.get_next_alert().map(|a| serde_json::to_string(&a).unwrap())
}

/// Get library version
pub fn get_version() -> String {
    "0.3.0-depin".to_string()
}

// ============================================================================
// Wallet Management
// ============================================================================

/// Initialize a new wallet with random keypair
/// Returns the public key (hex encoded) which serves as vehicle ID
pub fn wallet_create(device_name: String) -> String {
    let wallet = V2VWallet::new(device_name);
    let pubkey = wallet.public_key.clone();

    // Save secret key to secure vault
    let secret = wallet.signing_key.to_bytes();
    if let Err(e) = db::save_key("wallet_sk", &secret) {
        println!("Failed to save wallet: {}", e);
    } else {
        println!("Wallet saved to secure vault");
    }

    let mut guard = WALLET.lock().unwrap();
    *guard = Some(wallet);

    pubkey
}

/// Restore wallet from secret key bytes
/// Returns the public key if successful
pub fn wallet_restore(secret_key: Vec<u8>, device_name: String) -> Result<String, String> {
    let wallet = V2VWallet::from_secret_key(&secret_key, device_name)?;
    let pubkey = wallet.public_key.clone();

    // Save to Secure Vault
    db::save_key("wallet_sk", &secret_key).map_err(|e| e.to_string())?;

    let mut guard = WALLET.lock().unwrap();
    *guard = Some(wallet);

    Ok(pubkey)
}

/// Export wallet secret key for secure storage
pub fn wallet_export_secret() -> Result<Vec<u8>, String> {
    let guard = WALLET.lock().unwrap();
    match &*guard {
        Some(wallet) => Ok(wallet.export_secret_key()),
        None => Err("No wallet initialized".to_string()),
    }
}

/// Get current wallet public key
pub fn wallet_get_public_key() -> Result<String, String> {
    let guard = WALLET.lock().unwrap();
    match &*guard {
        Some(wallet) => Ok(wallet.public_key.clone()),
        None => Err("No wallet initialized".to_string()),
    }
}

/// Check if wallet is initialized
pub fn wallet_is_initialized() -> bool {
    WALLET.lock().unwrap().is_some()
}

/// Get wallet balance from chain
pub async fn get_wallet_balance(_pubkey: String) -> Result<u64, String> {
    // Simulate network delay to Gara Chain testnet
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let balance = *MOCK_WALLET_BALANCE.lock().unwrap();
    Ok(balance)
}
// ============================================================================
// Telemetry and Crash/Theft Detection
// ============================================================================

pub fn create_telemetry_stream(s: StreamSink<String>) -> Result<()> {
    let (tx, mut rx) = mpsc::channel(10);
    // Create telemetry instance
    let telemetry = Telemetry::new(tx);

    // Spawn stream handler
    RUNTIME.spawn(async move {
        while let Some(event) = rx.recv().await {
            // Also feed it to the Copilot Engine
            {
                let mut engine = COPILOT_ENGINE.lock().unwrap();
                engine.ingest_telemetry_event(event.clone());
                engine.process_cycle();
            }

            match serde_json::to_string(&event) {
                Ok(event_json) => {
                    if s.add(event_json).is_err() {
                        break; // Stream is closed
                    }
                }
                Err(e) => {
                    eprintln!("Failed to serialize event: {}", e);
                }
            }
        }
    });

    // Store global instance
    RUNTIME.spawn(async move {
        let mut guard = TELEMETRY.lock().await;
        *guard = Some(telemetry);
    });

    Ok(())
}

pub fn handle_sync_accelerometer_data(x: f64, y: f64, z: f64, timestamp: i64) {
    let data = SensorData {
        timestamp,
        vehicle_id: [0; 32],
        speed: 0.0,
        rpm: 0,
        fuel_level: 0.0,
        location: None,
        obd_codes: vec![],
        accelerometer: Some(AccelerometerData { x, y, z }),
        gyroscope: None,
    };
    RUNTIME.spawn(async move {
         if let Some(telemetry) = &*TELEMETRY.lock().await {
            telemetry.process_accelerometer_data(data).await;
        }
    });
}

// Wrapper for simple struct usage from Dart
pub fn handle_sync_gyroscope_data(x: f64, y: f64, z: f64, timestamp: i64) {
    let data = SensorData {
        timestamp,
        vehicle_id: [0; 32],
        speed: 0.0,
        rpm: 0,
        fuel_level: 0.0,
        location: None,
        obd_codes: vec![],
        accelerometer: None,
        gyroscope: Some(GyroscopeData { x, y, z }),
    };
    RUNTIME.spawn(async move {
        if let Some(telemetry) = &mut *TELEMETRY.lock().await {
            telemetry.process_gyroscope_data(data).await;
        }
    });
}


pub fn arm_sentinel() {
    RUNTIME.spawn(async move {
        if let Some(telemetry) = &mut *TELEMETRY.lock().await {
            telemetry.arm_sentinel();
        }
    });
}

pub fn disarm_sentinel() {
    RUNTIME.spawn(async move {
        if let Some(telemetry) = &mut *TELEMETRY.lock().await {
            telemetry.disarm_sentinel();
        }
    });
}

pub fn get_sentinel_state() -> String {
    // Blocking read for state
    let state = RUNTIME.block_on(async {
        if let Some(telemetry) = &*TELEMETRY.lock().await {
            serde_json::to_string(&telemetry.get_sentinel_state())
        } else {
            serde_json::to_string(&serde_json::json!({ "state": "NotInitialized" }))
        }
    });

    match state {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to serialize sentinel state: {}", e);
            "{\"state\": \"SerializationError\"}".to_string()
        }
    }
}

// ============================================================================
// Video Recorder Management
// ============================================================================

pub fn init_recorder(app_dir: String) {
    let (video_tx, video_rx) = mpsc::channel(100);
    let (command_tx, command_rx) = mpsc::channel(10);

    *VIDEO_CHUNK_SENDER.lock().unwrap() = Some(video_tx);
    *RECORDER_COMMAND_SENDER.lock().unwrap() = Some(command_tx);

    RUNTIME.spawn(async move {
        let mut recorder = VideoRecorder::new(video_rx, command_rx, app_dir);
        recorder.run().await;
    });
}

pub fn start_dashcam() {
    if let Some(sender) = RECORDER_COMMAND_SENDER.lock().unwrap().as_ref() {
        let _ = sender.try_send(RecorderCommand::Start);
    }
}

pub fn stop_dashcam() {
    if let Some(sender) = RECORDER_COMMAND_SENDER.lock().unwrap().as_ref() {
        let _ = sender.try_send(RecorderCommand::Stop);
    }
}

pub fn save_video_buffer(path: String) {
    if let Some(sender) = RECORDER_COMMAND_SENDER.lock().unwrap().as_ref() {
        let _ = sender.try_send(RecorderCommand::Save(path));
    }
}

pub fn send_video_chunk(chunk: Vec<u8>) {
    if let Some(sender) = VIDEO_CHUNK_SENDER.lock().unwrap().as_ref() {
        let _ = sender.try_send(chunk);
    }
}

// ============================================================================
// Message Signing
// ============================================================================

/// Sign a text message
pub fn sign_text_message(text: String, lat: Option<f64>, lon: Option<f64>) -> Result<String, String> {
    let position = create_position(lat, lon);
    sign_message_internal(V2VMessageType::Text, text, position)
}

/// Sign a quick message
pub fn sign_quick_message(quick_type: i32, lat: Option<f64>, lon: Option<f64>) -> Result<String, String> {
    let qm = quick_message_from_int(quick_type)?;
    let payload = serde_json::to_string(&qm).unwrap();
    let position = create_position(lat, lon);
    sign_message_internal(V2VMessageType::QuickMessage, payload, position)
}

/// Sign a location share message
pub fn sign_location_message(lat: f64, lon: f64, speed: Option<f32>, heading: Option<f32>) -> Result<String, String> {
    let position = Position {
        latitude: lat,
        longitude: lon,
        accuracy: 10.0,
        speed,
        heading,
        timestamp: chrono::Utc::now().timestamp_millis(),
    };
    let payload = serde_json::to_string(&position).unwrap();
    sign_message_internal(V2VMessageType::Location, payload, Some(position))
}

/// Sign an emergency alert
pub fn sign_emergency_message(description: String, lat: Option<f64>, lon: Option<f64>) -> Result<String, String> {
    let position = create_position(lat, lon);
    sign_message_internal(V2VMessageType::Emergency, description, position)
}

/// Sign a voice message (base64 encoded audio)
pub fn sign_voice_message(audio_base64: String, lat: Option<f64>, lon: Option<f64>) -> Result<String, String> {
    let position = create_position(lat, lon);
    sign_message_internal(V2VMessageType::Voice, audio_base64, position)
}

/// Sign telemetry data
pub fn sign_telemetry_message(telemetry_json: String, lat: Option<f64>, lon: Option<f64>) -> Result<String, String> {
    let position = create_position(lat, lon);
    sign_message_internal(V2VMessageType::Telemetry, telemetry_json, position)
}

fn sign_message_internal(
    msg_type: V2VMessageType,
    payload: String,
    position: Option<Position>,
) -> Result<String, String> {
    let guard = WALLET.lock().unwrap();
    let wallet = guard.as_ref().ok_or("No wallet initialized")?;

    let msg = wallet.sign_message(msg_type, payload, position);
    serde_json::to_string(&msg).map_err(|e| e.to_string())
}

fn create_position(lat: Option<f64>, lon: Option<f64>) -> Option<Position> {
    match (lat, lon) {
        (Some(latitude), Some(longitude)) => Some(Position {
            latitude,
            longitude,
            accuracy: 10.0,
            speed: None,
            heading: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        }),
        _ => None,
    }
}

fn quick_message_from_int(value: i32) -> Result<QuickMessage, String> {
    match value {
        0 => Ok(QuickMessage::Thanks),
        1 => Ok(QuickMessage::Sorry),
        2 => Ok(QuickMessage::HazardAhead),
        3 => Ok(QuickMessage::PoliceAhead),
        4 => Ok(QuickMessage::TrafficJam),
        5 => Ok(QuickMessage::AccidentAhead),
        6 => Ok(QuickMessage::RoadWork),
        7 => Ok(QuickMessage::FuelStation),
        8 => Ok(QuickMessage::TurnSignal),
        9 => Ok(QuickMessage::LightsOn),
        _ => Err(format!("Invalid quick message type: {}", value)),
    }
}

// ============================================================================
// Message Verification
// ============================================================================

/// Verify a signed message (JSON string)
/// Returns true if signature is valid
pub fn verify_message(message_json: String) -> Result<bool, String> {
    let msg: V2VMessage = serde_json::from_str(&message_json)
        .map_err(|e| format!("Invalid message JSON: {}", e))?;
    msg.verify()
}

/// Parse message JSON and extract sender ID
pub fn get_message_sender(message_json: String) -> Result<String, String> {
    let msg: V2VMessage = serde_json::from_str(&message_json)
        .map_err(|e| format!("Invalid message JSON: {}", e))?;
    Ok(msg.sender_id)
}

/// Parse message JSON and extract type as int
pub fn get_message_type(message_json: String) -> Result<i32, String> {
    let msg: V2VMessage = serde_json::from_str(&message_json)
        .map_err(|e| format!("Invalid message JSON: {}", e))?;
    Ok(msg.msg_type as i32)
}

// ============================================================================
// Reward Calculation
// ============================================================================

/// Calculate reward for a message
/// Returns JSON with reward details
pub fn calculate_message_reward(
    message_json: String,
    receiver_count: u32,
    is_verified: bool,
) -> Result<String, String> {
    let msg: V2VMessage = serde_json::from_str(&message_json)
        .map_err(|e| format!("Invalid message JSON: {}", e))?;

    let reward = calculate_reward(&msg, receiver_count, is_verified);
    serde_json::to_string(&reward).map_err(|e| e.to_string())
}

/// Get base reward for a message type (micro-GARA)
pub fn get_base_reward(message_type: i32) -> u64 {
    let msg_type = match message_type {
        0 => V2VMessageType::Text,
        1 => V2VMessageType::Voice,
        2 => V2VMessageType::QuickMessage,
        3 => V2VMessageType::Location,
        4 => V2VMessageType::Emergency,
        5 => V2VMessageType::Telemetry,
        _ => return 0,
    };
    msg_type.base_reward()
}

/// Get DC cost for a message type
pub fn get_dc_cost(message_type: i32) -> u64 {
    let msg_type = match message_type {
        0 => V2VMessageType::Text,
        1 => V2VMessageType::Voice,
        2 => V2VMessageType::QuickMessage,
        3 => V2VMessageType::Location,
        4 => V2VMessageType::Emergency,
        5 => V2VMessageType::Telemetry,
        _ => return 0,
    };
    msg_type.dc_cost()
}

// ============================================================================
// Reward Tracking
// ============================================================================

/// Track a reward for a message sender
pub fn track_reward(message_json: String, receiver_count: u32) -> Result<u64, String> {
    let msg: V2VMessage = serde_json::from_str(&message_json)
        .map_err(|e| format!("Invalid message JSON: {}", e))?;

    let is_verified = msg.verify().unwrap_or(false);
    let reward = calculate_reward(&msg, receiver_count, is_verified);

    let mut tracker = REWARD_TRACKER.lock().unwrap();
    tracker.add_reward(&msg.sender_id, &reward);

    Ok(reward.final_reward)
}

/// Get pending reward for current wallet
pub fn get_my_pending_reward() -> Result<u64, String> {
    let wallet_guard = WALLET.lock().unwrap();
    let wallet = wallet_guard.as_ref().ok_or("No wallet initialized")?;

    let tracker = REWARD_TRACKER.lock().unwrap();
    Ok(tracker.get_pending(&wallet.public_key))
}

/// Get all pending rewards (for sync to blockchain)
/// Returns JSON array of [pubkey, amount] pairs
pub fn get_all_pending_rewards() -> String {
    let tracker = REWARD_TRACKER.lock().unwrap();
    let rewards = tracker.get_all_pending();
    serde_json::to_string(&rewards).unwrap_or_else(|_| "[]".to_string())
}

/// Flush pending rewards (call after blockchain submission)
/// Returns the flushed rewards as JSON
pub fn flush_pending_rewards() -> String {
    let mut tracker = REWARD_TRACKER.lock().unwrap();
    let rewards = tracker.flush();
    serde_json::to_string(&rewards).unwrap_or_else(|_| "[]".to_string())
}

/// Get reward tracker statistics: (message_count, total_earned)
pub fn get_reward_stats() -> (u64, u64) {
    let tracker = REWARD_TRACKER.lock().unwrap();
    tracker.stats()
}

// ============================================================================
// Utility Functions
// ============================================================================

/// Calculate distance between two positions in meters
pub fn calculate_distance(
    lat1: f64, lon1: f64,
    lat2: f64, lon2: f64,
) -> f64 {
    let pos1 = Position {
        latitude: lat1,
        longitude: lon1,
        accuracy: 0.0,
        speed: None,
        heading: None,
        timestamp: 0,
    };
    let pos2 = Position {
        latitude: lat2,
        longitude: lon2,
        accuracy: 0.0,
        speed: None,
        heading: None,
        timestamp: 0,
    };
    pos1.distance_to(&pos2)
}

/// Get quick message display text (Spanish)
pub fn get_quick_message_text(quick_type: i32) -> String {
    match quick_message_from_int(quick_type) {
        Ok(qm) => qm.display_text().to_string(),
        Err(_) => "Unknown".to_string(),
    }
}

/// Format reward amount in GARA (from micro-GARA)
pub fn format_gara_amount(micro_gara: u64) -> String {
    let gara = micro_gara as f64 / 1_000_000.0;
    if gara < 0.001 {
        format!("{} µGARA", micro_gara)
    } else if gara < 1.0 {
        format!("{:.6} GARA", gara)
    } else {
        format!("{:.2} GARA", gara)
    }
}

// ============================================================================
// BLE Bridge
// ============================================================================

pub fn parse_ble_packet_raw(data: Vec<u8>) -> Result<SafetyPacket> {
    Ok(bincode::deserialize(&data)?)
}

/// Processes a raw BLE/LoRa packet.
/// Deduplicates based on `temp_id`.
/// If the packet is new, it's returned for relay over high-bandwidth mesh.
/// If it's a duplicate, returns `None`.
pub fn process_and_relay_packet(data: Vec<u8>) -> Option<Vec<u8>> {
    if let Ok(packet) = bincode::deserialize::<SafetyPacket>(&data) {
        let mut cache = PACKET_CACHE.lock().unwrap();
        if cache.check_and_store(packet.temp_id) {
            // New packet, relay it
            return Some(data);
        }
    }
    // Duplicate or invalid packet, drop it
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relay_deduplication() {
        // Ensure a clean state before the test
        PACKET_CACHE.lock().unwrap().clear();

        // Packet with ID 1
        let packet1 = SafetyPacket::new_heartbeat(1, 0.0, 0.0, 0.0);
        let data1 = bincode::serialize(&packet1).unwrap();

        // Packet with ID 2
        let packet2 = SafetyPacket::new_heartbeat(2, 0.0, 0.0, 0.0);
        let data2 = bincode::serialize(&packet2).unwrap();

        // 1. Process packet 1 - should be relayed
        assert!(process_and_relay_packet(data1.clone()).is_some());

        // 2. Process packet 1 again - should be dropped
        assert!(process_and_relay_packet(data1.clone()).is_none());

        // 3. Process packet 2 - should be relayed
        assert!(process_and_relay_packet(data2.clone()).is_some());

        // 4. Process packet 2 again - should be dropped
        assert!(process_and_relay_packet(data2.clone()).is_none());
         // 5. Fill the cache to test eviction
         for i in 3..=CACHE_MAX_SIZE + 2 {
            let temp_id = i as u32;
            let packet = SafetyPacket::new_heartbeat(temp_id, 0.0, 0.0, 0.0);
            let data = bincode::serialize(&packet).unwrap();
            process_and_relay_packet(data);
        }

        // 6. Packet 1 should have been evicted, so it can be relayed again
        assert!(process_and_relay_packet(data1.clone()).is_some());

        // 7. Packet 2 should also be evicted
        assert!(process_and_relay_packet(data2.clone()).is_some());
    }
}

/// Save a telemetry packet to the vault
pub fn save_telemetry_packet(packet: SafetyPacket) -> Result<(), String> {
    db::save_telemetry_packet(&packet).map_err(|e| e.to_string())
}

/// Fuses the phone's location with a telemetry packet and saves it to the vault.
/// Returns the updated packet.
pub fn fuse_location_and_save(mut packet: SafetyPacket, lat: f64, lon: f64) -> Result<SafetyPacket, String> {
    packet.lat = (lat * 1_000_000.0) as i32;
    packet.lon = (lon * 1_000_000.0) as i32;
    db::save_telemetry_packet(&packet).map_err(|e| e.to_string())?;
    Ok(packet)
}

// ============================================================================
// Governance Logic (Phase 6)
// ============================================================================

pub struct GovernanceInfo {
    pub proposal_count: u32,
    pub voting_power: u64,
    pub delegated_to: String,
}

/// Get governance status for the current user
pub fn get_governance_info() -> Result<GovernanceInfo> {
    // Mocked for Pilot
    Ok(GovernanceInfo {
        proposal_count: 5,
        voting_power: 1500, // Example
        delegated_to: "0x123...456".to_string(),
    })
}

/// Cast a vote on a proposal (Sign and Broadcast)
pub fn cast_vote(proposal_id: u32, support: bool) -> Result<String> {
    // In production: Sign with wallet key and send to RPC
    // Here: Return a mocked transaction hash
    let decision = if support { "For" } else { "Against" };
    println!("Voting {} on proposal {}", decision, proposal_id);
    Ok(format!("0xVoteTxHash_{}_{}", proposal_id, support))
}

// ============================================================================
// Marketplace Logic (Phase 7)
// ============================================================================

/// Anonymize a location for preview in the Marketplace
pub fn get_preview_location(lat: f64, lon: f64) -> Position {
    let input = Position {
        latitude: lat,
        longitude: lon,
        accuracy: 0.0,
        speed: None,
        heading: None,
        timestamp: 0,
    };
    anonymizer::anonymize_position(&input)
}

/// Scrub text data
pub fn clean_text_data(text: String) -> String {
    anonymizer::scrub_pii(text)
}

// ============================================================================
// Marketplace Opt-In Logic (DEPIN-04)
// ============================================================================

/// Get current opt-in preferences for the user
pub fn get_opt_in_preferences() -> Result<OptInPreferences, String> {
    let prefs = OPT_IN_PREFERENCES.lock().unwrap();
    Ok(prefs.clone())
}

/// Save updated opt-in preferences
pub fn save_opt_in_preferences(prefs: OptInPreferences) -> Result<(), String> {
    let mut guard = OPT_IN_PREFERENCES.lock().unwrap();
    *guard = prefs;
    Ok(())
}

// ============================================================================
// Expansion Logic (Phase 8)
// ============================================================================

/// Process a LoRaWAN packet (simulated byte array)
pub fn process_lora_packet(data: Vec<u8>) -> Result<String> {
    match LoraPacket::from_bytes(&data) {
        Some(packet) => {
            println!("Received LoRa packet from Dev {}: Lat {}, Lon {}",
                packet.device_id, packet.latitude, packet.longitude);
            Ok(format!("Parsed LoRa Packet: ID {}", packet.device_id))
        },
        None => Err(anyhow::anyhow!("Invalid LoRa packet format"))
    }
}

/// Simulate sending a critical alert via Satellite
pub fn send_satellite_alert(alert_msg: String) -> Result<String> {
    let mut modem = SatelliteModem::new();
    let signal = modem.check_signal();

    if signal == 0 {
        return Err(anyhow::anyhow!("No Satellite Signal"));
    }

    let bytes = alert_msg.as_bytes();
    modem.send_sbd(bytes)
}

pub struct GatewayStatus {
    pub satellite: String,
    pub lora: String,
    pub sigfox: String,
}

/// Get unified status of all gateway interfaces
pub fn get_gateway_status() -> GatewayStatus {
    let sat = SATELLITE_MODEM.lock().unwrap().status().display_string();
    let lora = LORA_INTERFACE.lock().unwrap().status().display_string();
    let sigfox = SIGFOX_INTERFACE.lock().unwrap().status().display_string();

    GatewayStatus {
        satellite: sat,
        lora,
        sigfox,
    }
}

/// Connect to LoRaWAN
pub fn connect_lora(frequency_index: i32) -> Result<(), String> {
    let freq = match frequency_index {
        0 => LoraFrequency::EU868,
        1 => LoraFrequency::US915,
        2 => LoraFrequency::CN470,
        _ => return Err("Invalid frequency index".to_string()),
    };

    let mut lora = LORA_INTERFACE.lock().unwrap();
    *lora = LoraInterface::new(freq);
    lora.connect().map_err(|e| e.to_string())
}

/// Connect to Sigfox
pub fn connect_sigfox() -> Result<(), String> {
    let mut sigfox = SIGFOX_INTERFACE.lock().unwrap();
    sigfox.connect().map_err(|e| e.to_string())
}

/// Connect to Satellite
pub fn connect_satellite() -> Result<(), String> {
    let mut sat = SATELLITE_MODEM.lock().unwrap();
    sat.connect().map_err(|e| e.to_string())
}

/// Send a Sigfox telemetry packet
pub fn send_sigfox_telemetry(device_id: u32, lat: f32, lon: f32) -> Result<String, String> {
    let packet = SigfoxPacket {
        device_id,
        latitude: lat,
        longitude: lon,
    };
    let data = packet.to_bytes();

    let mut sigfox = SIGFOX_INTERFACE.lock().unwrap();
    sigfox.send(&data).map_err(|e| e.to_string())?;

    Ok("Sigfox Uplink Successful".to_string())
}

/// Get heatmap data for map visualization
pub fn get_heatmap_data() -> Vec<HeatmapCell> {
    // In a real app, this would query the DB for telemetry density
    // For now, we simulate some data points around a central location
    let center_lat = 40.7128;
    let center_lon = -74.0060;

    let mut cells = Vec::new();
    let res = Resolution::Eight;

    for i in -5i32..5i32 {
        for j in -5i32..5i32 {
            let lat = center_lat + (i as f64 * 0.01);
            let lon = center_lon + (j as f64 * 0.01);

            if let Ok(coord) = LatLng::new(lat, lon) {
                let cell: CellIndex = coord.to_cell(res);
                cells.push(HeatmapCell {
                    h3_index: cell.to_string(),
                    weight: (i.abs() + j.abs()) as f64 / 10.0,
                });
            }
        }
    }

    cells
}

/// Get latest vehicle telemetry for real-time display
pub fn get_latest_telemetry() -> TelemetryDisplayData {
    // Simulated latest telemetry
    TelemetryDisplayData {
        speed: 45.5,
        heading: 120.0,
        altitude: 150.0,
        accuracy: 5.0,
        battery: 85.0,
        signal: 4.0,
        timestamp: chrono::Utc::now().timestamp_millis(),
    }
}
