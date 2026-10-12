// surreal.ts — edge-hive SurrealDB adapter stub
// Prod: connect a edge-hive (Rust VPS, SurrealDB embebida, WASM edge functions, MCP)
// edge-hive hosts PWAs y expone SurrealDB WS (integracion documentada en los docs internos de SWAL).
//
// Este stub deja build verde sin Rust. En runtime PWA:
// 1) si hay env PUBLIC_EDGE_HIVE_URL (ej https://edge.swal.dev) -> usa fetch WS via surrealdb.js
// 2) sino fallback a MemoryAdapter (tests) o IndexedDB (offline).
// Para Fase 2 no se despliega edge-hive local — solo documenta patron y deja switch listo.

import type { StorageAdapter, DomainRecord } from './domain.js';
import { domainConfig } from './domain.config.js';

const EDGE_HIVE_URL = (import.meta as any).env?.PUBLIC_EDGE_HIVE_URL as string | undefined;
const DEFAULT_WS_URL = 'ws://localhost:8000';

// Esqueleto Surreal adapter — no importa surrealdb.js para no romper build si no esta instalado.
// Cuando se quiera prod, `pnpm add surrealdb` y descomentar el import.
export class SurrealAdapter implements StorageAdapter {
  private url: string;
  private ws: WebSocket | null = null;

  constructor(url = EDGE_HIVE_URL ?? DEFAULT_WS_URL) {
    if (!url) throw new Error('EDGE_HIVE_URL no configurado — usa MemoryAdapter o define PUBLIC_EDGE_HIVE_URL');
    this.url = url;
  }

  // Conexion lazy al WS (no-op en build, llamada en runtime)
  private connect(): WebSocket | null {
    if (typeof globalThis === 'undefined' || typeof (globalThis as any).WebSocket === 'undefined') return null;
    if (this.ws) return this.ws;
    try {
      this.ws = new WebSocket(this.url);
      return this.ws;
    } catch {
      return null;
    }
  }

  // Nota: estas implementaciones son fetch HTTP placeholder. En produccion usarias:
  // import { Surreal } from 'surrealdb'; await db.connect(this.url); await db.use({ns: 'swal', db: domainConfig.appId});
  // y luego `DEFINE TABLE` via surrealDefineTable() y queries `SELECT * FROM ${entity} WHERE instance_id = $iid`.

  private httpBase(): string {
    return this.url.replace(/^ws/, 'http');
  }

  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    this.connect();
    // ejemplo HTTP a edge-hive WASM handler (a implementar en edge-hive/src/api/domain.rs)
    const res = await fetch(`${this.httpBase()}/api/${domainConfig.appId}/${entity}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`surreal create ${res.status}`);
    return (await res.json()) as DomainRecord;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    this.connect();
    const res = await fetch(`${this.httpBase()}/api/${domainConfig.appId}/${entity}?instance_id=${encodeURIComponent(instanceId)}`);
    if (!res.ok) throw new Error(`surreal list ${res.status}`);
    return (await res.json()) as DomainRecord[];
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    this.connect();
    const res = await fetch(`${this.httpBase()}/api/${domainConfig.appId}/${entity}/${id}?instance_id=${encodeURIComponent(instanceId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`surreal get ${res.status}`);
    return (await res.json()) as DomainRecord;
  }

  async update(entity: string, id: string, patch: Record<string, unknown>, instanceId: string): Promise<DomainRecord | null> {
    this.connect();
    const res = await fetch(`${this.httpBase()}/api/${domainConfig.appId}/${entity}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, instance_id: instanceId }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`surreal update ${res.status}`);
    return (await res.json()) as DomainRecord;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    this.connect();
    const res = await fetch(`${this.httpBase()}/api/${domainConfig.appId}/${entity}/${id}?instance_id=${encodeURIComponent(instanceId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  }
}

export const SURREAL_WS_DEFAULT = DEFAULT_WS_URL;
