-- Vault 100% cifrado: metadatos de los sealed packs (el ciphertext va en R2; en D1 solo hash y clave R2).
-- Lo usa src/lib/cloudflareVaultAdapter.ts.
-- Ejecutar: wrangler d1 execute <tu-d1> --file=./migrations/001_sealed_meta.sql
-- (Las tablas de facturacion -credits, invoices, subscriptions- son del modulo cloud privado.)

CREATE TABLE IF NOT EXISTS sealed_meta (
  id TEXT PRIMARY KEY,
  appId TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sealed_meta_app_instance ON sealed_meta(appId, instance_id);
CREATE INDEX IF NOT EXISTS idx_sealed_meta_entity ON sealed_meta(entity);
CREATE INDEX IF NOT EXISTS idx_sealed_meta_hash ON sealed_meta(content_hash);
