-- GARA-G D1 Schema — multi-tenant fleet management
-- Database: la D1 del binding SWAL_D1 (ver wrangler.example.toml)
-- Cada entity se guarda en una tabla SQL con su instance_id para aislamiento multi-tenant
-- Date: 2026-09-02

-- ============================================================================
-- Tabla generica: una fila por entity por instance
-- Pattern: instance_id + id (text) → JSON blob en data
-- Ventajas: un solo schema, queries agregadas simples, R2-like flex
-- ============================================================================
CREATE TABLE IF NOT EXISTS entity (
  instance_id TEXT NOT NULL,
  entity      TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        TEXT NOT NULL,                -- JSON serialized record
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (instance_id, entity, id)
);

-- Indice principal: listar por entity + instance
CREATE INDEX IF NOT EXISTS idx_entity_list
  ON entity (instance_id, entity, updated_at DESC);

-- Indice de busqueda: una sola fila por id dentro de instance
CREATE INDEX IF NOT EXISTS idx_entity_single
  ON entity (instance_id, entity, id);

-- ============================================================================
-- Indice especial para geofences: busqueda por fleet_id (dentro de data JSON)
-- GARA-G renderiza geofences en mapa, asi que queries por fleet son frecuentes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_entity_fleet
  ON entity (instance_id, entity, json_extract(data, '$.fleetId'));

-- ============================================================================
-- Indice para alertas: busqueda por acknowledged
-- UI dashboard filtra "alertas sin reconocer"
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_entity_ack
  ON entity (instance_id, entity, json_extract(data, '$.acknowledged'));

-- ============================================================================
-- Tabla de control: que instances tienen seed cargado (idempotencia)
-- ============================================================================
CREATE TABLE IF NOT EXISTS seed_registry (
  instance_id  TEXT PRIMARY KEY,
  seeded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  entity_count INTEGER NOT NULL DEFAULT 0
);
