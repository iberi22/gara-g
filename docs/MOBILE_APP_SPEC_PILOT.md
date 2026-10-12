# 📱 Garanet Pilot App: Especificación Técnica

## 1. Resumen
Aplicación móvil híbrida (Rust + Flutter) que convierte el smartphone en un copiloto inteligente y un nodo de la red DePIN. Funciona como interfaz visual del hardware "Sentinel" y utiliza los sensores del teléfono para enriquecer la data.

## 2. Arquitectura de Software

### Capa Lógica (Rust - "The Engine")
*   **Rol:** Procesamiento pesado, criptografía, comunicación con hardware.
*   **Librerías:**
    *   `ble_central`: Para conectar con el Sentinel Hardware.
    *   `libautomotive`: Decodificación de protocolos OBD (si se conecta directo a dongles genéricos).
    *   `burn` o `tract`: Inferencia de IA local (Tiny Models) para detectar eventos en la cámara.
    *   `libp2p`: Para sincronización de nodos (opcional en fase 2).

### Capa UI (Flutter - "The Face")
*   **Rol:** Visualización, Interacción, Agente de Voz.
*   **Modos de Visualización:**
    *   **Dashboard Standard:** Mapa completo y controles.
    *   **HUD Mode:** Interfaz invertida/simplificada para reflejo en parabrisas (Head-Up Display).
    *   **Blackout / Eco Mode:** Pantalla OLED apagada (negro puro), solo pixels críticos encendidos para alertas. Ahorra batería y reduce distracción nocturna.
*   **Componentes:**
    *   **Dashboard de Conducción:** Velocímetro, Mapa de Riesgo, Alertas.
    *   **Data Wallet:** Gestión de ganancias por venta de datos.
    *   **Garage Virtual:** Vista de los NFTs del vehículo.

## 3. Sensor Fusion (La "Superbatería de Datos")
La app combinará tres fuentes de verdad:
1.  **Hardware Sentinel:** Datos internos del motor (RPM, Frenos) + V2V externo (LoRa).
2.  **Sensores del Teléfono (Smartphone as Node):**
    *   *Smart Mesh:* Google Nearby Connections para hablar con otros teléfonos offline.
    *   *Trip Validation:* Google Activity Recognition API para confirmar estado `IN_VEHICLE` (Anti-Spoofing).
    *   *Acelerómetro / Giroscopio:* Detectar baches, frenadas bruscas, accidentes (fuerza G).
## 4. Agente Verbal de Seguridad
*   **Input:** Alertas del Hardware Sentinel (ej. "Coche invisible en curva ciega transmitiendo por radio").
*   **Proceso:** Lógica de prioridad en Rust.
*   **Output:** Voz sintética (System TTS).
    *   *Ejemplo:* "Precaución, tráfico detenido adelante."

## 5. Privacidad y Seguridad
*   **Local-First:** Los datos de video y telemetría de alta frecuencia NO salen del teléfono por defecto.
*   **Zero-Knowledge Signals:** Solo se comparten pruebas matemáticas de que "frené aquí" o "estuve aquí", no el video completo, a menos que se venda.
*   **Cifrado:** Base de datos local (SQLite/Isar) cifrada con la llave privada del usuario.

## 6. Estructura de Proyecto Sugerida
```
packages/
  mobile-app/
    android/
    ios/
    lib/ (Flutter Code)
    native/ (Rust Code)
      src/
        api.rs (Bridge Definitions)
        engine/ (Sensor logic)
        crypto/ (Signing & Encryption)
    pubspec.yaml
```
