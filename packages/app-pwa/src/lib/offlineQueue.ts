// offlineQueue.ts — IndexedDB-based outbox queue for PWA offline requests (gara-outbox)
// P1.3 feat-offline-queue

const DB_NAME = 'gara-outbox';
const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox';
const STORE_PROCESSED = 'processed';

export interface OutboxOp {
  id?: number;
  idempotencyKey: string;
  entity: string;
  action: string;
  entityId: string;
  data?: any;
  createdAt: number;
  retryCount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  lastError?: string;
  lastAttemptAt?: number;

  // Legacy fetch fields for backwards compatibility
  endpoint?: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export type FlushResult = {
  synced: number;
  failed: number;
  remaining: number;
};

// --- In-memory fallback (SSR / non-browser / unit tests without IndexedDB) ---
const memOutbox: OutboxOp[] = [];
const memProcessed = new Set<string>();
let memIdCounter = 1;

function isIDBAvailable(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIDBAvailable()) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const os = db.createObjectStore(STORE_OUTBOX, { keyPath: 'id', autoIncrement: true });
        os.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
        os.createIndex('createdAt', 'createdAt', { unique: false });
        os.createIndex('entity_id', ['entity', 'entityId'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PROCESSED)) {
        db.createObjectStore(STORE_PROCESSED, { keyPath: 'idempotencyKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- IDB Operations ---

async function idbEnqueue(op: OutboxOp): Promise<OutboxOp> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_OUTBOX, STORE_PROCESSED], 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const procStore = tx.objectStore(STORE_PROCESSED);

    // Check if already processed
    const procReq = procStore.get(op.idempotencyKey);
    procReq.onsuccess = () => {
      if (procReq.result) {
        resolve({ ...op, status: 'completed' });
        return;
      }
      // Check if already in outbox
      const index = store.index('idempotencyKey');
      const getReq = index.get(op.idempotencyKey);
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve(getReq.result as OutboxOp);
          return;
        }
        const addReq = store.add(op);
        addReq.onsuccess = () => {
          resolve({ ...op, id: addReq.result as number });
        };
        addReq.onerror = () => reject(addReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    };
    procReq.onerror = () => reject(procReq.error);
  });
}

async function idbListPending(): Promise<OutboxOp[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as OutboxOp[]).filter(
        (i) => i.status === 'pending' || i.status === 'processing'
      );
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbDeleteOp(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbUpdateOp(op: OutboxOp): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.put(op);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbMarkProcessed(idempotencyKey: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROCESSED, 'readwrite');
    const store = tx.objectStore(STORE_PROCESSED);
    const req = store.put({ idempotencyKey, processedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbIsProcessed(idempotencyKey: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROCESSED, 'readonly');
    const store = tx.objectStore(STORE_PROCESSED);
    const req = store.get(idempotencyKey);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => resolve(false);
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_OUTBOX, STORE_PROCESSED], 'readwrite');
    tx.objectStore(STORE_OUTBOX).clear();
    tx.objectStore(STORE_PROCESSED).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Public API ---

/**
 * Enqueue an operation into the outbox.
 * Supports idempotency key deduplication.
 */
export async function enqueue(op: Partial<OutboxOp>): Promise<OutboxOp> {
  const entity = op.entity || 'vehicle';
  const action = op.action || 'create';
  const entityId = op.entityId || op.data?.id || `id_${Date.now()}`;
  const idempotencyKey = op.idempotencyKey || `${entity}-${action}-${entityId}-${Date.now()}`;

  const fullOp: OutboxOp = {
    ...op,
    entity,
    action,
    entityId,
    idempotencyKey,
    createdAt: op.createdAt || Date.now(),
    retryCount: op.retryCount || 0,
    status: op.status || 'pending',
  };

  if (!isIDBAvailable()) {
    if (memProcessed.has(idempotencyKey)) {
      return { ...fullOp, status: 'completed' };
    }
    const existing = memOutbox.find((i) => i.idempotencyKey === idempotencyKey);
    if (existing) return existing;

    const withId: OutboxOp = { ...fullOp, id: memIdCounter++ };
    memOutbox.push(withId);
    return withId;
  }

  try {
    return await idbEnqueue(fullOp);
  } catch (e) {
    // Fallback to in-memory on IDB error
    if (memProcessed.has(idempotencyKey)) {
      return { ...fullOp, status: 'completed' };
    }
    const existing = memOutbox.find((i) => i.idempotencyKey === idempotencyKey);
    if (existing) return existing;

    const withId: OutboxOp = { ...fullOp, id: memIdCounter++ };
    memOutbox.push(withId);
    return withId;
  }
}

/**
 * Returns pending operations ordered FIFO by entity + entityId.
 */
export async function pending(): Promise<OutboxOp[]> {
  let list: OutboxOp[];
  if (!isIDBAvailable()) {
    list = memOutbox.filter((i) => i.status === 'pending' || i.status === 'processing');
  } else {
    try {
      list = await idbListPending();
    } catch {
      list = memOutbox.filter((i) => i.status === 'pending' || i.status === 'processing');
    }
  }

  // Orden FIFO por entity + entityId, luego por createdAt
  return list.sort((a, b) => {
    const keyA = `${a.entity}_${a.entityId}`;
    const keyB = `${b.entity}_${b.entityId}`;
    if (keyA !== keyB) {
      return keyA.localeCompare(keyB);
    }
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/**
 * Flush pending operations in outbox via provided transport function with retries + backoff.
 */
export async function flush(
  transport?: (op: OutboxOp) => Promise<boolean | void>,
  opts: { maxRetries?: number; backoffBaseMs?: number } = {}
): Promise<FlushResult> {
  const maxRetries = opts.maxRetries ?? 5;
  const backoffBaseMs = opts.backoffBaseMs ?? 1000;
  const items = await pending();

  let synced = 0;
  let failed = 0;

  for (const item of items) {
    // Check if already processed (deduplication by idempotency key)
    let processed = false;
    if (!isIDBAvailable()) {
      processed = memProcessed.has(item.idempotencyKey);
    } else {
      try {
        processed = await idbIsProcessed(item.idempotencyKey);
      } catch {
        processed = memProcessed.has(item.idempotencyKey);
      }
    }

    if (processed) {
      if (item.id != null) {
        if (!isIDBAvailable()) {
          const idx = memOutbox.findIndex((x) => x.id === item.id);
          if (idx >= 0) memOutbox.splice(idx, 1);
        } else {
          try {
            await idbDeleteOp(item.id);
          } catch {
            const idx = memOutbox.findIndex((x) => x.id === item.id);
            if (idx >= 0) memOutbox.splice(idx, 1);
          }
        }
      }
      continue;
    }

    // Exponential backoff check
    if (item.retryCount > 0 && item.lastAttemptAt) {
      const backoffMs = Math.min(backoffBaseMs * Math.pow(2, item.retryCount - 1), 30000);
      if (Date.now() - item.lastAttemptAt < backoffMs) {
        failed += 1;
        continue;
      }
    }

    try {
      let success = true;
      if (transport) {
        const res = await transport(item);
        if (res === false) success = false;
      } else if (item.endpoint) {
        // Default HTTP fetch fallback for legacy queued requests
        const res = await fetch(item.endpoint, {
          method: item.method || 'POST',
          headers: { 'Content-Type': 'application/json', ...(item.headers || {}) },
          body: item.body ? JSON.stringify(item.body) : undefined,
        });
        success = res.ok;
        if (!res.ok) {
          item.lastError = `${res.status} ${res.statusText}`;
        }
      }

      if (success) {
        // Mark processed
        if (!isIDBAvailable()) {
          memProcessed.add(item.idempotencyKey);
          if (item.id != null) {
            const idx = memOutbox.findIndex((x) => x.id === item.id);
            if (idx >= 0) memOutbox.splice(idx, 1);
          }
        } else {
          try {
            await idbMarkProcessed(item.idempotencyKey);
            if (item.id != null) await idbDeleteOp(item.id);
          } catch {
            memProcessed.add(item.idempotencyKey);
            if (item.id != null) {
              const idx = memOutbox.findIndex((x) => x.id === item.id);
              if (idx >= 0) memOutbox.splice(idx, 1);
            }
          }
        }
        synced += 1;
      } else {
        item.retryCount += 1;
        item.lastAttemptAt = Date.now();
        if (item.retryCount >= maxRetries) {
          item.status = 'failed';
        } else {
          item.status = 'pending';
        }

        if (!isIDBAvailable()) {
          const idx = memOutbox.findIndex((x) => x.id === item.id);
          if (idx >= 0) memOutbox[idx] = item;
        } else {
          try {
            await idbUpdateOp(item);
          } catch {
            const idx = memOutbox.findIndex((x) => x.id === item.id);
            if (idx >= 0) memOutbox[idx] = item;
          }
        }
        failed += 1;
      }
    } catch (err) {
      item.retryCount += 1;
      item.lastAttemptAt = Date.now();
      item.lastError = err instanceof Error ? err.message : String(err);
      if (item.retryCount >= maxRetries) {
        item.status = 'failed';
      } else {
        item.status = 'pending';
      }

      if (!isIDBAvailable()) {
        const idx = memOutbox.findIndex((x) => x.id === item.id);
        if (idx >= 0) memOutbox[idx] = item;
      } else {
        try {
          await idbUpdateOp(item);
        } catch {
          const idx = memOutbox.findIndex((x) => x.id === item.id);
          if (idx >= 0) memOutbox[idx] = item;
        }
      }
      failed += 1;
    }
  }

  const remaining = (await pending()).length;
  return { synced, failed, remaining };
}

// --- Legacy API aliases for backward compatibility ---

export async function listQueued(): Promise<OutboxOp[]> {
  return pending();
}

export async function removeQueued(id: number): Promise<void> {
  if (!isIDBAvailable()) {
    const idx = memOutbox.findIndex((x) => x.id === id);
    if (idx >= 0) memOutbox.splice(idx, 1);
    return;
  }
  try {
    await idbDeleteOp(id);
  } catch {
    const idx = memOutbox.findIndex((x) => x.id === id);
    if (idx >= 0) memOutbox.splice(idx, 1);
  }
}

export async function markAttempt(id: number, error?: string): Promise<void> {
  const items = await pending();
  const q = items.find((x) => x.id === id);
  if (q) {
    q.retryCount += 1;
    q.lastAttemptAt = Date.now();
    if (error) q.lastError = error;
    if (!isIDBAvailable()) {
      const idx = memOutbox.findIndex((x) => x.id === id);
      if (idx >= 0) memOutbox[idx] = q;
    } else {
      try {
        await idbUpdateOp(q);
      } catch {
        const idx = memOutbox.findIndex((x) => x.id === id);
        if (idx >= 0) memOutbox[idx] = q;
      }
    }
  }
}

export async function syncQueue(opts: { endpoint?: string; maxAttempts?: number } = {}): Promise<FlushResult> {
  return flush(undefined, { maxRetries: opts.maxAttempts });
}

export async function clearOutbox(): Promise<void> {
  memOutbox.length = 0;
  memProcessed.clear();
  memIdCounter = 1;
  if (isIDBAvailable()) {
    try {
      await idbClear();
    } catch {
      // Ignore
    }
  }
}

// --- Service Worker Background Sync ---

export async function registerBackgroundSync(tag = 'gara-flush'): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    // @ts-expect-error — SyncManager optional browser feature
    if (reg.sync && typeof reg.sync.register === 'function') {
      // @ts-expect-error
      await reg.sync.register(tag);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// --- Auto Sync ---

export function attachAutoSync(handler: (r: FlushResult) => void = () => {}): () => void {
  if (typeof window === 'undefined') return () => {};

  const trigger = async () => {
    const r = await flush();
    handler(r);
  };

  const onOnline = () => {
    trigger();
  };

  const onMessage = (event: MessageEvent) => {
    if (event.data && (event.data.type === 'GARA_FLUSH' || event.data.type === 'SYNC_COMPLETE')) {
      trigger();
    }
  };

  window.addEventListener('online', onOnline);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onMessage);
  }

  return () => {
    window.removeEventListener('online', onOnline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    }
  };
}
