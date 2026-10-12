# ADR-003: Integración DePIN

## Estado
Accepted

## Contexto
La red DePIN de Garanet depende de la integración fluida entre hardware físico (IoT), protocolos de comunicación descentralizados y una capa de servicios autónomos que aseguren la salud y escalabilidad de la red.

## Decisión
La arquitectura DePIN se basa en una serie de servicios autónomos y protocolos de malla:

1.  **Hardware Sentinel:**
    - Dispositivos IoT que actúan como nodos de la red.
    - Implementan un `SentinelDataBuffer` para manejo de eventos (telemetría, diagnósticos, alertas críticas).
    - Gestión de actualizaciones mediante `SentinelFirmwareManager` (OTA).

2.  **Protocolos de Red:**
    - **MeshProtocolService:** Gestiona la comunicación P2P entre nodos.
    - **NodeDiscoveryService:** Permite que nuevos nodos se unan a la red de forma dinámica.

3.  **Servicios Autónomos:**
    - **AutoHealingService:** Monitoriza la salud de los nodos y realiza acciones correctivas automáticamente.
    - **NetworkMetricsService:** Recopila y analiza estadísticas de la red en tiempo real.

4.  **Frontend DePIN:**
    - Visualización en tiempo real mediante `NodesDashboard` y `NodeMap` (Leaflet).
    - Estadísticas globales de la red en `NetworkStats`.

## Consecuencias
- **Pros:**
    - Resiliencia de red gracias a protocolos de malla y servicios de auto-sanación.
    - Escalabilidad horizontal al permitir el descubrimiento dinámico de nodos.
    - Transparencia total sobre el estado de la infraestructura física.
- **Contras:**
    - Retos técnicos en la consistencia de datos en entornos con conectividad intermitente.
    - Complejidad en la depuración de comportamientos emergentes en la red de malla.
