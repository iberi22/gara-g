# ADR-004: Persistencia de Datos

## Estado
Accepted

## Contexto
El sistema maneja una gran cantidad de datos estructurados, desde telemetría de vehículos hasta estados de gobernanza y registros de usuarios. Se requiere una forma eficiente, segura y con tipado fuerte de interactuar con la base de datos SQL.

## Decisión
Adoptamos **Drizzle ORM** como nuestra herramienta principal de persistencia de datos:

1.  **Esquemas Centralizados:**
    - Los esquemas de tabla se definen en TypeScript dentro de `packages/db/src/schema.ts`.
    - Esto proporciona tipado de extremo a extremo (End-to-End Type Safety).

2.  **Migraciones:**
    - Se utiliza `drizzle-kit` para generar y gestionar migraciones de base de datos de forma declarativa.
    - Las configuraciones se encuentran en `packages/db/drizzle.config.ts`.

3.  **Arquitectura de Datos Híbrida:**
    - **PostgreSQL (via Drizzle):** Para datos estructurados, relacionales y transaccionales (Usuarios, Flotas, Historial de Staking).
    - **Firestore:** Para datos de documentos, configuración en tiempo real y persistencia de servicios serverless (Alertas, Caché de analítica).
    - **On-chain (Solana):** Para la fuente de verdad definitiva de activos (NFTs, Tokens) y compromisos de gobernanza.

4.  **Validación:**
    - Uso de Zod para validar los datos antes de la inserción y al recibirlos de las APIs, asegurando la integridad de los datos en la capa de persistencia.

## Consecuencias
- **Pros:**
    - Excelente experiencia de desarrollo con autocompletado y validación en tiempo de compilación.
    - Migraciones predecibles y fáciles de auditar.
    - Flexibilidad para escalar diferentes partes del sistema usando la base de datos más adecuada para cada caso de uso.
- **Contras:**
    - Necesidad de mantener la sincronización manual entre esquemas de Drizzle y posibles cambios en Firestore o programas de Solana.
    - Curva de aprendizaje inicial para el manejo de migraciones con `drizzle-kit`.
