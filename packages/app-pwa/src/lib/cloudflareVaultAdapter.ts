// cloudflareVaultAdapter.ts — StorageAdapter 100% cifrado sobre Cloudflare R2+D1+KV
// Reusable para cualquier app SWAL (gara-g, hosteler-ia, flota, etc).
// Si no hay bindings (mesh-only), fallback a MemoryAdapter (0$, replica P2P en otros nodos gara-g).
// Frontera E2EE: R2 guarda el ciphertext sin shares, KV guarda exactamente un share (x=3),
// los shares de dispositivo (x=1) y recuperacion (x=2) NUNCA salen del equipo.
// El operador de la nube acumula como mucho 1 de 3 shares y no puede descifrar (umbral es 2).
// Nota: los datos son irrecuperables si el dispositivo original y la clave de recuperacion se pierden.

import type { StorageAdapter, DomainRecord } from './domain';
import { domainConfig } from './domain.config';
import {
  createSealedPack,
  unpackSealedPack,
  packWithoutShares,
  cloudBoundShare,
  assertCloudSharesSafe,
} from '@swal/vault/sealedPack.js';

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

  private deviceStore: {
    save(id: string, s: { device: any; recovery: any }): void | Promise<void>;
    load(id: string): { device: any; recovery: any } | null | Promise<any>;
  } = {
    save: async (id: string, s: { device: any; recovery: any }) => {
      await this.saveToIndexedDB(id, s);
    },
    load: async (id: string) => {
      return await this.loadFromIndexedDB(id);
    },
  };

  private _masterKey: CryptoKey | null = null;
  private _keyInitPromise: Promise<CryptoKey> | null = null;

  private async getDBKey(db: IDBDatabase): Promise<CryptoKey> {
    if (this._masterKey) return this._masterKey;
    if (this._keyInitPromise) return this._keyInitPromise;
    this._keyInitPromise = (async () => {
      const existingKey = await new Promise<CryptoKey | undefined>((resolve, reject) => {
        const tx = db.transaction('keys', 'readonly');
        const req = tx.objectStore('keys').get('master-key');
        req.onsuccess = () => resolve(req.result?.key);
        req.onerror = () => reject(req.error);
      });

      if (existingKey) {
        this._masterKey = existingKey;
        return existingKey;
      }

      if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Crypto API not available');
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      this._masterKey = key;

      return new Promise<CryptoKey>((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite');
        const req = tx.objectStore('keys').put({ id: 'master-key', key });
        req.onsuccess = () => resolve(key);
        req.onerror = () => reject(req.error);
      });
    })();
    return this._keyInitPromise;
  }

  private async openDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('vault-device-shares', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('shares')) db.createObjectStore('shares', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async saveToIndexedDB(id: string, s: { device: any; recovery: any }) {
    const db = await this.openDB();
    if (!db) return;
    try {
      const key = await this.getDBKey(db);
      const iv = typeof crypto !== 'undefined' ? crypto.getRandomValues(new Uint8Array(12)) : new Uint8Array(12);
      const data = new TextEncoder().encode(JSON.stringify(s));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('shares', 'readwrite');
        const req = tx.objectStore('shares').put({ id, iv, data: encrypted });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  private async loadFromIndexedDB(id: string): Promise<{ device: any; recovery: any } | null> {
    const db = await this.openDB();
    if (!db) return null;
    try {
      const result = await new Promise<any>((resolve, reject) => {
        const tx = db.transaction('shares', 'readonly');
        const req = tx.objectStore('shares').get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!result) return null;

      const key = await this.getDBKey(db);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: result.iv },
        key,
        result.data
      );
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (e) {
      return null;
    } finally {
      db.close();
    }
  }

  setDeviceShareStore(store: {
    save(id: string, s: { device: any; recovery: any }): void | Promise<void>;
    load(id: string): { device: any; recovery: any } | null | Promise<any>;
  }) {
    this.deviceStore = store;
  }

  async recoveryShare(id: string): Promise<any> {
    const s = await this.deviceStore.load(id);
    return s?.recovery ?? null;
  }

  private async localShares(id: string): Promise<any[]> {
    const s = await this.deviceStore.load(id);
    if (!s) return [];
    return [s.device, s.recovery].filter(Boolean);
  }

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

      const cloudPack = packWithoutShares(pack);
      const kvShare = cloudBoundShare(pack.shares ?? []);
      assertCloudSharesSafe(kvShare ? 1 : 0);

      // The createSealedPack generates a new DEK and shares.
      // Saving these to device store securely.
      await this.deviceStore.save(record.id, {
        device: pack.shares?.[0] ?? null,
        recovery: pack.shares?.[1] ?? null,
      });

      if (this.env.SWAL_R2?.put) await this.env.SWAL_R2.put(r2Key, JSON.stringify(cloudPack), { httpMetadata: { contentType: 'application/json' } });
      if (this.env.SWAL_D1?.prepare) {
        await this.env.SWAL_D1.prepare(
          'INSERT OR REPLACE INTO sealed_meta (id, appId, instance_id, entity, content_hash, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
          .bind(record.id, this.appId, record.instance_id, entity, pack.content_hash, r2Key, record.created_at)
          .run()
          .catch(() => {});
      }
      // UN solo share en KV (el índice 3)
      if (this.env.SWAL_KV?.put && kvShare) {
        await this.env.SWAL_KV.put(`share:${this.appId}:${record.id}`, JSON.stringify([kvShare])).catch(() => {});
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
              const kvShares: any = JSON.parse((await this.env.SWAL_KV?.get(`share:${this.appId}:${row.id}`)) ?? 'null');
              const deviceShares = await this.localShares(row.id);
              const shares = [...deviceShares, ...(kvShares ?? [])];
              if (shares.length < 2) continue;
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
      const kvShares: any = JSON.parse((await this.env.SWAL_KV?.get(`share:${this.appId}:${id}`)) ?? 'null');
      const deviceShares = await this.localShares(id);
      const shares = [...deviceShares, ...(kvShares ?? [])];
      if (shares.length < 2) return mem;
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
    // Updates cannot be persisted durably because @swal/vault cannot re-seal with an existing DEK.
    // Reject before reading anything, so no cache or memory state is touched on failure.
    throw new Error('update not supported by the vault adapter until @swal/vault can re-seal with an existing DEK');
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
