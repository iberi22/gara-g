/**
 * SWAL-GARA Xavier Memory Sync & Edge Mesh Fallback Manager
 * Manages memory node synchronization between xavier-memory-node (:8006)
 * and local edge-mesh-sync IndexedDB / in-memory fallback store.
 */

import {
  XAVIER_DEFAULT_ENDPOINT,
  getInstanceId,
  getXavierNamespace,
  probeXavierHealth,
} from './xavier.js';

export interface XavierMemoryRecord {
  id: string;
  key: string;
  value: unknown;
  timestamp: number;
  instanceId: string;
  namespace: string;
  synced: boolean;
  version: number;
}

export interface XavierSyncStatus {
  lastSyncedAt: number | null;
  unsyncedCount: number;
  totalEntries: number;
  isOnline: boolean;
  endpoint: string;
  error?: string;
}

const DB_NAME = 'swal_xavier_db';
const DB_VERSION = 1;
const STORE_NAME = 'memory_records';

/**
 * IndexedDB storage engine with seamless in-memory fallback.
 */
class XavierIndexedDBFallback {
  private memoryMap: Map<string, XavierMemoryRecord> = new Map();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor() {
    this.dbPromise = this.initIndexedDB();
  }

  private async initIndexedDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return null;
    }
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('instanceId', 'instanceId', { unique: false });
            store.createIndex('key', 'key', { unique: false });
            store.createIndex('synced', 'synced', { unique: false });
          }
        };
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          this.loadFromIndexedDB(db);
          resolve(db);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private loadFromIndexedDB(db: IDBDatabase): void {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        if (Array.isArray(req.result)) {
          for (const record of req.result) {
            this.memoryMap.set(record.id, record);
          }
        }
      };
    } catch {
      // Ignore read errors
    }
  }

  public async set(record: XavierMemoryRecord): Promise<void> {
    this.memoryMap.set(record.id, record);
    const db = await this.dbPromise;
    if (db) {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(record);
      } catch {
        // Fallback to memory map
      }
    }
  }

  public get(id: string): XavierMemoryRecord | undefined {
    return this.memoryMap.get(id);
  }

  public findByKey(key: string, instanceId: string): XavierMemoryRecord | undefined {
    for (const record of this.memoryMap.values()) {
      if (record.key === key && record.instanceId === instanceId) {
        return record;
      }
    }
    return undefined;
  }

  public listByInstance(instanceId: string): XavierMemoryRecord[] {
    const list: XavierMemoryRecord[] = [];
    for (const record of this.memoryMap.values()) {
      if (record.instanceId === instanceId) {
        list.push(record);
      }
    }
    return list;
  }

  public listUnsynced(instanceId?: string): XavierMemoryRecord[] {
    const list: XavierMemoryRecord[] = [];
    for (const record of this.memoryMap.values()) {
      if (!record.synced && (!instanceId || record.instanceId === instanceId)) {
        list.push(record);
      }
    }
    return list;
  }

  public async markSynced(ids: string[]): Promise<void> {
    const idSet = new Set(ids);
    const db = await this.dbPromise;

    for (const record of this.memoryMap.values()) {
      if (idSet.has(record.id)) {
        record.synced = true;
        if (db) {
          try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(record);
          } catch {
            // Memory fallback updated
          }
        }
      }
    }
  }

  public count(instanceId?: string): number {
    if (!instanceId) return this.memoryMap.size;
    return this.listByInstance(instanceId).length;
  }
}

export class XavierSyncManager {
  private store: XavierIndexedDBFallback = new XavierIndexedDBFallback();
  private endpoint: string;
  private lastSyncedAt: number | null = null;
  private isOnline: boolean = false;

  constructor(endpoint: string = XAVIER_DEFAULT_ENDPOINT) {
    this.endpoint = endpoint;
  }

  /**
   * Sets custom Xavier node endpoint.
   */
  public setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  /**
   * Saves a key-value memory entry locally (IndexedDB with memory fallback)
   * and attempts async sync to xavier-memory-node.
   */
  public async saveMemoryEntry(
    key: string,
    value: unknown,
    instanceId?: string
  ): Promise<XavierMemoryRecord> {
    const targetInstanceId = instanceId || getInstanceId();
    const namespace = getXavierNamespace(targetInstanceId);
    const existing = this.store.findByKey(key, targetInstanceId);

    const record: XavierMemoryRecord = {
      id: existing ? existing.id : `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      key,
      value,
      timestamp: Date.now(),
      instanceId: targetInstanceId,
      namespace,
      synced: false,
      version: existing ? existing.version + 1 : 1,
    };

    await this.store.set(record);

    // Attempt immediate background sync
    this.syncWithXavierMemoryNode().catch(() => {
      // Offline fallback preserved in IndexedDB / local store
    });

    return record;
  }

  /**
   * Gets a local memory entry by key.
   */
  public getMemoryEntry(key: string, instanceId?: string): XavierMemoryRecord | undefined {
    const targetInstanceId = instanceId || getInstanceId();
    return this.store.findByKey(key, targetInstanceId);
  }

  /**
   * Lists all local memory entries for an instance.
   */
  public getMemoryEntries(instanceId?: string): XavierMemoryRecord[] {
    const targetInstanceId = instanceId || getInstanceId();
    return this.store.listByInstance(targetInstanceId);
  }

  /**
   * Synchronizes unsynced local memory entries with xavier-memory-node HTTP endpoint.
   */
  public async syncWithXavierMemoryNode(
    endpointOverride?: string
  ): Promise<XavierSyncStatus> {
    const activeEndpoint = endpointOverride || this.endpoint;
    const instanceId = getInstanceId();
    const health = await probeXavierHealth(activeEndpoint);
    this.isOnline = health.alive;

    if (!health.alive) {
      return {
        lastSyncedAt: this.lastSyncedAt,
        unsyncedCount: this.store.listUnsynced(instanceId).length,
        totalEntries: this.store.count(instanceId),
        isOnline: false,
        endpoint: activeEndpoint,
        error: `Node offline: ${health.status}`,
      };
    }

    const unsynced = this.store.listUnsynced(instanceId);
    if (unsynced.length === 0) {
      this.lastSyncedAt = Date.now();
      return {
        lastSyncedAt: this.lastSyncedAt,
        unsyncedCount: 0,
        totalEntries: this.store.count(instanceId),
        isOnline: true,
        endpoint: activeEndpoint,
      };
    }

    const syncUrl = `${activeEndpoint.replace(/\/$/, '')}/memory/sync`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId,
          namespace: getXavierNamespace(instanceId),
          records: unsynced,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const syncedIds = unsynced.map((r) => r.id);
        await this.store.markSynced(syncedIds);
        this.lastSyncedAt = Date.now();

        return {
          lastSyncedAt: this.lastSyncedAt,
          unsyncedCount: 0,
          totalEntries: this.store.count(instanceId),
          isOnline: true,
          endpoint: activeEndpoint,
        };
      }

      return {
        lastSyncedAt: this.lastSyncedAt,
        unsyncedCount: unsynced.length,
        totalEntries: this.store.count(instanceId),
        isOnline: true,
        endpoint: activeEndpoint,
        error: `HTTP ${response.status}`,
      };
    } catch (err: unknown) {
      return {
        lastSyncedAt: this.lastSyncedAt,
        unsyncedCount: unsynced.length,
        totalEntries: this.store.count(instanceId),
        isOnline: false,
        endpoint: activeEndpoint,
        error: err instanceof Error ? err.message : 'sync_failed',
      };
    }
  }

  /**
   * Returns current sync status overview.
   */
  public getSyncStatus(instanceId?: string): XavierSyncStatus {
    const targetInstanceId = instanceId || getInstanceId();
    return {
      lastSyncedAt: this.lastSyncedAt,
      unsyncedCount: this.store.listUnsynced(targetInstanceId).length,
      totalEntries: this.store.count(targetInstanceId),
      isOnline: this.isOnline,
      endpoint: this.endpoint,
    };
  }
}

export const defaultXavierSyncManager = new XavierSyncManager();
