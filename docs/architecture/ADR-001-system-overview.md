# ADR-001: Visión General del Sistema

## Estado
Accepted

## Contexto
Garanet es una red de infraestructura física descentralizada (DePIN) para movilidad inteligente. El sistema necesita manejar comunicaciones en tiempo real para seguridad vial (V2V), persistencia de datos confiable para identidad y reputación, y una interfaz de usuario intuitiva para la gestión de flotas y participación en la economía de datos.

## Decisión
Adoptamos una **arquitectura híbrida** dividida en tres capas principales:

1.  **Capa de Seguridad (Real-Time):**
    - Utiliza dispositivos "Sentinel" (basados en ESP32/Rust).
    - Comunicación Peer-to-Peer (P2P) mediante LoRa y WiFi-Aware.
    - Latencia crítica (< 50ms) para evitar colisiones.

2.  **Capa de Asentamiento (Blockchain):**
    - Utiliza Solana (Anchor) para la lógica on-chain.
    - Gestiona Identidad Digital (DID), Reputación, Staking y Recompensas.
    - El programa `gara-depin` centraliza la lógica de registro de nodos y penalizaciones.

3.  **Capa de Usuario y Gestión (Cloud/Web/Mobile):**
    - **Mobile:** App "Pilot" (Flutter/Rust) para usuarios finales.
    - **Web:** Dashboard Enterprise (Next.js) para gestión de flotas.
    - **Backend:** Firebase Functions (TypeScript) para servicios asíncronos, analítica predictiva y APIs de integración.

## Consecuencias
- **Pros:**
    - Alta disponibilidad y baja latencia en funciones críticas de seguridad.
    - Transparencia y seguridad criptográfica en transacciones financieras y de datos.
    - Escalabilidad mediante el uso de servicios cloud para tareas no críticas.
- **Contras:**
    - Mayor complejidad en la sincronización entre el estado on-chain y off-chain.
    - Requiere mantenimiento de múltiples stacks tecnológicos (Rust, TypeScript, Flutter).
