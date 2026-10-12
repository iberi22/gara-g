import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getInstanceId,
  setInstanceId,
  getXavierNamespace,
  probeXavierHealth,
  applyHeartbeat,
  startHeartbeatLoop,
  DEFAULT_INSTANCE_ID,
  XAVIER_DEFAULT_ENDPOINT,
} from '../src/lib/xavier.js';
import { XavierSyncManager } from '../src/lib/xavierSync.js';

describe('Xavier PWA Module Tests', () => {
  beforeEach(() => {
    setInstanceId(DEFAULT_INSTANCE_ID);
    vi.restoreAllMocks();
  });

  it('should format Xavier namespace correctly with app/gara-g/instance/{instanceId}', () => {
    expect(getXavierNamespace()).toBe(`app/gara-g/instance/${DEFAULT_INSTANCE_ID}`);
    expect(getXavierNamespace('custom-inst-123')).toBe('app/gara-g/instance/custom-inst-123');
  });

  it('should manage and persist instance ID', () => {
    setInstanceId('instance-abc');
    expect(getInstanceId()).toBe('instance-abc');
    expect(getXavierNamespace()).toBe('app/gara-g/instance/instance-abc');
  });

  it('should probe Xavier node health', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '1.2.0' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const health = await probeXavierHealth('http://localhost:8006');
    expect(health.alive).toBe(true);
    expect(health.endpoint).toBe('http://localhost:8006');
    expect(health.status).toBe('ok');
    expect(health.version).toBe('1.2.0');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8006/health', expect.anything());
  });

  it('should handle probe health failure when node is offline', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    const health = await probeXavierHealth('http://localhost:8006');
    expect(health.alive).toBe(false);
    expect(health.status).toBe('Connection refused');
  });

  it('should apply 60s heartbeat ping to Xavier node', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'heartbeat_ack' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    setInstanceId('instance-hb');
    const result = await applyHeartbeat('http://localhost:8006');
    expect(result.success).toBe(true);
    expect(result.endpoint).toBe('http://localhost:8006');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8006/heartbeat',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('app/gara-g/instance/instance-hb'),
      })
    );
  });

  it('should trigger startHeartbeatLoop and execute clean stop', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const onTick = vi.fn();
    const stop = startHeartbeatLoop('http://localhost:8006', 60000, onTick);

    await vi.advanceTimersByTimeAsync(10);
    expect(onTick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(onTick).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(onTick).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should handle XavierSyncManager local storage and memory sync', async () => {
    const syncManager = new XavierSyncManager('http://localhost:8006');
    setInstanceId('instance-sync');

    const entry = await syncManager.saveMemoryEntry('telemetry_state', { speed: 65, status: 'moving' });
    expect(entry.key).toBe('telemetry_state');
    expect(entry.namespace).toBe('app/gara-g/instance/instance-sync');
    expect(entry.synced).toBe(false);

    const retrieved = syncManager.getMemoryEntry('telemetry_state');
    expect(retrieved?.value).toEqual({ speed: 65, status: 'moving' });

    // Mock successful sync endpoint response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const syncStatus = await syncManager.syncWithXavierMemoryNode();
    expect(syncStatus.isOnline).toBe(true);
    expect(syncStatus.unsyncedCount).toBe(0);

    const syncedEntry = syncManager.getMemoryEntry('telemetry_state');
    expect(syncedEntry?.synced).toBe(true);
  });
});
