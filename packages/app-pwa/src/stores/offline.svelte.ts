// stores/offline.svelte.ts — Svelte 5 runes store para estado de la offline queue
// G10.09: required $state runes (AC)

import { listQueued, syncQueue, attachAutoSync, type SyncResult } from '../lib/offlineQueue';

class OfflineStore {
  queued = $state(0);
  syncing = $state(false);
  lastSync = $state<SyncResult | null>(null);
  online = $state(true);
  private detach: (() => void) | null = null;

  constructor() {
    if (typeof navigator !== 'undefined') {
      this.online = navigator.onLine;
    }
  }

  async refresh() {
    try {
      const items = await listQueued();
      this.queued = items.length;
    } catch {
      this.queued = 0;
    }
  }

  async sync(): Promise<SyncResult | null> {
    if (this.syncing) return null;
    this.syncing = true;
    try {
      const r = await syncQueue();
      this.lastSync = r;
      this.queued = r.remaining;
      return r;
    } finally {
      this.syncing = false;
    }
  }

  start() {
    if (typeof window === 'undefined') return;
    this.detach = attachAutoSync((r) => {
      this.lastSync = r;
      this.queued = r.remaining;
    });
    window.addEventListener('online', () => (this.online = true));
    window.addEventListener('offline', () => (this.online = false));
    this.refresh();
  }

  stop() {
    this.detach?.();
    this.detach = null;
  }
}

export const offlineStore = new OfflineStore();
