# 📡 Protocolo Gara-G Mesh V1

## 1. Topología Híbrida

El sistema opera en dos capas físicas simultáneas:

### 📱 Capa 1: Short-Range (Smartphone Mesh)
*   **Medio:** WiFi Direct / BLE (vía Google Nearby Connections).
*   **Alcance:** 50-100 metros.
*   **Ancho de Banda:** Alto (>1 Mbps).
*   **Uso:**
    *   Intercambio de mapas locales.
    *   Video clips de incidentes (opcional/on-demand).
    *   Actualizaciones OTA de firmware Sentinel.

### 🗼 Capa 2: Long-Range (Sentinel Radar)
*   **Medio:** LoRa (868/915 MHz).
*   **Alcance:** 800m - 2km (Urbano/Semi-urbano).
*   **Ancho de Banda:** Muy bajo (<5 kbps).
*   **Uso:**
    *   "Ping" de existencia (Radar).
    *   **Flag de Emergencia:** 1 byte crítico (Frenada, Choque).

## 2. Estructura de Paquete (Rust Struct)

```rust
#[repr(C, packed)]
struct SafetyPacket {
    // Header (4 bytes)
    magic: u8,          // 'G'
    version: u8,        // 1
    msg_type: MsgType,  // Heartbeat, Hazard, Chat

    // Identity (Epifímera) (4 bytes)
    temp_id: u32,       // Rolling ID derived from daily seed

    // Telemetry (20 bytes)
    timestamp: u64,     // Unix MS
    lat: i32,           // Microdegrees
    lon: i32,           // Microdegrees
    speed_cms: u16,     // cm/s
    heading: u8,        // 0-255 (360 degrees)

    // Status (2 bytes)
    events: u16,        // Bitmask: [BRAKING, ABS, AIRBAG, POTHOLE...]

    // Signature (64 bytes - Ed25519)
    // Optional on LoRa freq, Mandatory on Validation
}
```

## 3. Lógica de "Radar Virtual"
La App renderiza puntos en el HUD basándose en la recepción de estos paquetes:
*   Si `msg_type == Hazard` -> Muestra ALERTA ROJA + TTS Agente.
*   Si señal viene de LoRa (lejana) -> Muestra punto en el horizonte.
*   Si señal viene de WiFi (cercana) -> Muestra coche vecino.
