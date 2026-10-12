// cloudflareVaultAdapter.ts — StorageAdapter 100% cifrado sobre Cloudflare R2+D1+KV
// Reusable para cualquier app SWAL (gara-g, hosteler-ia, flota, etc).
// Si no hay bindings (mesh-only), fallback a MemoryAdapter (0$, replica P2P en otros nodos gara-g).
// Si hay bindings, cada record se cifra via @swal/vault createSealedPack y se guarda ciphertext en R2 + meta en D1.
// 1 camion = 100 camiones mismo precio: no hay fee por entity, solo bytes (R2) + rows (D1) + AI tokens.

import type { StorageAdapter, DomainRecord } from './domain';
import { domainConfig } from './domain.config';
import { createSealedPack, unpackSealedPack } from '@swal/vault/sealedPack.js';

// Tipos Cloudflare bindings (compat con wrangler.toml template)
export type CloudflareEnv = {
  SWAL_R2?: { put(key: string, val: string, opts?: any): Promise<any>; get(key: string): Promise<any>; delete(key: string): Promise<any>; list(opts?: any): Promise<any> };
  SWAL_D1?: { prepare(sql: string): { bind(...a: any[]): { first(): Promise<any>; run(): Promise<any>; all(): Promise<any> } } };
  SWAL_KV?: { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> };
};

export class CloudflareVaultAdapter implements StorageAdapter {
  private env: CloudflareEnv;
  private appId: string;
  // memory fallback para dev/tests sin bindings
  private mem = new Map<string, Map<string, DomainRecord>>();

  constructor(env: CloudflareEnv, appId = domainConfig.appId as string) {
    this.env = env;
    this.appId = appId;
  }

  private memKey(entity: string) {
    if (!this.mem.has(entity)) this.mem.set(entity, new Map());
    return this.mem.get(entity)!;
  }

  private hasCloud(): boolean {
    return !!this.env.SWAL_R2 || !!this.env.SWAL_D1;
  }

  private r2Key(entity: string, id: string, instanceId: string): string {
    return `packs/${this.appId}/${instanceId}/${entity}/${id}.json`;
  }

  // Cifra record y guarda: R2 ciphertext + D1 meta (content_hash + r2_key)
  async create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    if (!this.hasCloud()) {
      this.memKey(entity).set(record.id, record);
      return record;
    }
    try {
      const payload = new TextEncoder().encode(JSON.stringify(record));
      const pack: any = await createSealedPack(payload, {
        entity, entityId: record.id, appId: this.appId, instanceId: record.instance_id, timestamp: Date.now(),
      } as any);

      const r2Key = this.r2Key(entity, record.id, record.instance_id);
      if (this.env.SWAL_R2?.put) await this.env.SWAL_R2.put(r2Key, JSON.stringify(pack), { httpMetadata: { contentType: 'application/json' } });
      if (this.env.SWAL_D1?.prepare) {
        await this.env.SWAL_D1.prepare(
          'INSERT OR REPLACE INTO sealed_meta (id, appId, instance_id, entity, content_hash, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
          .bind(record.id, this.appId, record.instance_id, entity, pack.content_hash, r2Key, record.created_at)
          .run()
          .catch(() => {});
      }
      // guarda shares en KV para reconstruccion (1 share en KV, resto en pack)
      if (this.env.SWAL_KV?.put && pack.shares?.[0]) {
        await this.env.SWAL_KV.put(`share:${this.appId}:${record.id}`, JSON.stringify(pack.shares)).catch(() => {});
      }
    } catch (e) {
      console.warn('[vaultAdapter] cloud create fallback to mem', e);
      this.memKey(entity).set(record.id, record);
    }
    // siempre guarda en mem como cache + mesh replica
    this.memKey(entity).set(record.id, record);
    return record;
  }

  async list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    // Intenta D1 primero
    if (this.hasCloud() && this.env.SWAL_D1?.prepare) {
      try {
        const res = await this.env.SWAL_D1.prepare('SELECT id, r2_key FROM sealed_meta WHERE appId=? AND instance_id=? AND entity=?')
          .bind(this.appId, instanceId, entity)
          .all();
        const rows = (res as any)?.results ?? [];
        if (rows.length > 0 && this.env.SWAL_R2?.get) {
          const out: DomainRecord[] = [];
          for (const row of rows) {
            try {
              const obj = await this.env.SWAL_R2.get(row.r2_key);
              if (!obj) continue;
              const pack = JSON.parse(await obj.text());
              const shares: any = JSON.parse((await this.env.SWAL_KV?.get(`share:${this.appId}:${row.id}`)) ?? 'null') ?? pack.shares;
              const plain = await unpackSealedPack(pack, shares.slice(0, 2));
              const rec = JSON.parse(new TextDecoder().decode(plain));
              if (rec.instance_id === instanceId) out.push(rec);
            } catch {}
          }
          if (out.length > 0) return out;
        }
      } catch {}
    }
    return [...this.memKey(entity).values()].filter((r) => r.instance_id === instanceId);
  }

  async get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    const mem = this.memKey(entity).get(id) ?? null;
    if (mem && mem.instance_id === instanceId) return mem;
    if (!this.hasCloud()) return null;
    try {
      const r2Key = this.r2Key(entity, id, instanceId);
      const obj = await this.env.SWAL_R2?.get(r2Key);
      if (!obj) return mem;
      const pack = JSON.parse(await obj.text());
      const shares: any = JSON.parse((await this.env.SWAL_KV?.get(`share:${this.appId}:${id}`)) ?? 'null') ?? pack.shares;
      const plain = await unpackSealedPack(pack, shares.slice(0, 2));
      const rec = JSON.parse(new TextDecoder().decode(plain));
      if (rec.instance_id !== instanceId) return null;
      this.memKey(entity).set(id, rec);
      return rec;
    } catch {
      return mem;
    }
  }

  async update(entity: string, id: string, patch: Record<string, unknown>, instanceId: string): Promise<DomainRecord | null> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur) return null;
    const next = { ...cur, ...patch, updated_at: new Date().toISOString() } as DomainRecord;
    await this.create(entity, next); // re-cifra y re-subre
    this.memKey(entity).set(id, next);
    return next;
  }

  async del(entity: string, id: string, instanceId: string): Promise<boolean> {
    const cur = await this.get(entity, id, instanceId);
    if (!cur) return false;
    this.memKey(entity).delete(id);
    if (!this.hasCloud()) return true;
    try {
      const r2Key = this.r2Key(entity, id, instanceId);
      await this.env.SWAL_R2?.delete(r2Key);
      await this.env.SWAL_D1?.prepare('DELETE FROM sealed_meta WHERE id=? AND appId=?').bind(id, this.appId).run().catch(() => {});
      await this.env.SWAL_KV?.put(`share:${this.appId}:${id}`, '').catch(() => {});
    } catch {}
    return true;
  }

  // Helper para activar desde app (onMount o Worker)
  static attachIfCloud(env: CloudflareEnv, appId?: string): CloudflareVaultAdapter | null {
    if (!env.SWAL_R2 && !env.SWAL_D1) return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return new CloudflareVaultAdapter(env, appId);
  }
}
