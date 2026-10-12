import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueue,
  pending,
  flush,
  clearOutbox,
  markAttempt,
  removeQueued,
  listQueued,
  syncQueue,
  registerBackgroundSync,
  attachAutoSync,
  type OutboxOp,
} from './offlineQueue.js';

describe('offlineQueue (P1.3 feat-offline-queue)', () => {
  beforeEach(async () => {
    await clearOutbox();
  });

  it('1. enqueue adds item to outbox with default fields', async () => {
    const op = await enqueue({
      entity: 'vehicle',
      action: 'add',
      entityId: 'v1',
      data: { make: 'Toyota', model: 'Corolla' },
    });

    expect(op.id).toBeDefined();
    expect(op.entity).toBe('vehicle');
    expect(op.action).toBe('add');
    expect(op.entityId).toBe('v1');
    expect(op.idempotencyKey).toBeDefined();
    expect(op.status).toBe('pending');
    expect(op.retryCount).toBe(0);

    const items = await pending();
    expect(items.length).toBe(1);
    expect(items[0].entityId).toBe('v1');
  });

  it('2. enqueue deduplicates when same idempotencyKey is enqueued twice', async () => {
    const op1 = await enqueue({
      idempotencyKey: 'dup-key-1',
      entity: 'vehicle',
      action: 'add',
      entityId: 'v10',
    });

    const op2 = await enqueue({
      idempotencyKey: 'dup-key-1',
      entity: 'vehicle',
      action: 'add',
      entityId: 'v10',
    });

    expect(op1.id).toBe(op2.id);

    const items = await pending();
    expect(items.length).toBe(1);
  });

  it('3. pending returns operations sorted FIFO by entity and entityId', async () => {
    await enqueue({ entity: 'vehicle', action: 'add', entityId: 'v2', idempotencyKey: 'k2' });
    await enqueue({ entity: 'fleet', action: 'create', entityId: 'f1', idempotencyKey: 'k1' });
    await enqueue({ entity: 'vehicle', action: 'add', entityId: 'v1', idempotencyKey: 'k3' });

    const items = await pending();
    expect(items.length).toBe(3);
    expect(items[0].entity).toBe('fleet');
    expect(items[0].entityId).toBe('f1');
    expect(items[1].entityId).toBe('v1');
    expect(items[2].entityId).toBe('v2');
  });

  it('4. flush processes pending operations using transport and marks completed', async () => {
    await enqueue({ entity: 'vehicle', action: 'add', entityId: 'v_flush_1' });
    await enqueue({ entity: 'vehicle', action: 'add', entityId: 'v_flush_2' });

    const processed: string[] = [];
    const transport = async (op: OutboxOp) => {
      processed.push(op.entityId);
    };

    const result = await flush(transport);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    expect(processed).toEqual(['v_flush_1', 'v_flush_2']);

    const itemsAfter = await pending();
    expect(itemsAfter.length).toBe(0);
  });

  it('5. flush skips already processed idempotency keys', async () => {
    const key = 'idem-key-processed';
    await enqueue({ idempotencyKey: key, entity: 'fleet', action: 'create', entityId: 'f10' });

    let callCount = 0;
    const transport = async () => {
      callCount += 1;
    };

    await flush(transport);
    expect(callCount).toBe(1);

    // Enqueue op with same idempotencyKey
    await enqueue({ idempotencyKey: key, entity: 'fleet', action: 'create', entityId: 'f10' });
    const result2 = await flush(transport);

    expect(callCount).toBe(1); // Not called again!
    expect(result2.remaining).toBe(0);
  });

  it('6. flush called 2 times in a row yields 0 duplicate executions (idempotency)', async () => {
    await enqueue({ idempotencyKey: 'flush-twice-key', entity: 'vehicle', action: 'add', entityId: 'v100' });

    let executed = 0;
    const transport = async () => {
      executed += 1;
    };

    await flush(transport);
    expect(executed).toBe(1);

    // Second flush
    const result2 = await flush(transport);
    expect(executed).toBe(1); // Stays 1
    expect(result2.synced).toBe(0);
    expect(result2.remaining).toBe(0);
  });

  it('7. flush handles transport returning false and increments retryCount', async () => {
    await enqueue({ entity: 'vehicle', action: 'update', entityId: 'v_fail' });

    const transport = async () => false;

    const result = await flush(transport);
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);

    const items = await pending();
    expect(items.length).toBe(1);
    expect(items[0].retryCount).toBe(1);
    expect(items[0].status).toBe('pending');
  });

  it('8. flush handles transport throwing an error and sets lastError', async () => {
    await enqueue({ entity: 'vehicle', action: 'delete', entityId: 'v_err' });

    const transport = async () => {
      throw new Error('network down');
    };

    const result = await flush(transport);
    expect(result.failed).toBe(1);

    const items = await pending();
    expect(items.length).toBe(1);
    expect(items[0].retryCount).toBe(1);
    expect(items[0].lastError).toBe('network down');
  });

  it('9. flush respects exponential backoff delay for retried operations', async () => {
    await enqueue({ entity: 'vehicle', action: 'update', entityId: 'v_backoff' });

    // Mock first failure
    const failTransport = async () => false;
    await flush(failTransport);

    const items = await pending();
    expect(items[0].retryCount).toBe(1);

    // Immediate second flush within backoff window should skip calling transport
    let called = false;
    const secondTransport = async () => {
      called = true;
      return true;
    };

    const result2 = await flush(secondTransport, { backoffBaseMs: 10000 });
    expect(called).toBe(false);
    expect(result2.failed).toBe(1); // Skipped due to backoff
  });

  it('10. flush marks status as failed after exceeding maxRetries', async () => {
    await enqueue({ entity: 'vehicle', action: 'update', entityId: 'v_max_retry' });

    const failTransport = async () => false;

    // Run flushes with 0 backoff
    for (let i = 0; i < 5; i++) {
      await flush(failTransport, { backoffBaseMs: 0, maxRetries: 3 });
    }

    const items = await pending();
    expect(items.length).toBe(0); // Failed items are filtered out from pending
  });

  it('11. markAttempt manually increments retryCount and updates error', async () => {
    const op = await enqueue({ entity: 'fleet', action: 'delete', entityId: 'f_mark' });
    await markAttempt(op.id!, 'custom error');

    const items = await pending();
    expect(items[0].retryCount).toBe(1);
    expect(items[0].lastError).toBe('custom error');
  });

  it('12. clearOutbox empties the queue and resets state', async () => {
    await enqueue({ entity: 'vehicle', action: 'add', entityId: 'v_clear' });
    expect((await pending()).length).toBe(1);

    await clearOutbox();
    expect((await pending()).length).toBe(0);
  });

  it('13. registerBackgroundSync checks serviceWorker availability', async () => {
    const res = await registerBackgroundSync('gara-flush');
    expect(typeof res).toBe('boolean');
  });

  it('14. attachAutoSync binds online event listener and returns cleanup function', () => {
    const fn = vi.fn();
    const detach = attachAutoSync(fn);
    expect(typeof detach).toBe('function');

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('online'));
    }

    detach();
  });

  it('15. backward compatibility helper removeQueued and syncQueue', async () => {
    const op = await enqueue({ endpoint: '/api/test', method: 'POST', body: { a: 1 } });
    expect((await listQueued()).length).toBe(1);

    await removeQueued(op.id!);
    expect((await listQueued()).length).toBe(0);

    await enqueue({ endpoint: '/api/test2', method: 'POST', body: { a: 2 } });
    const origFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = async () => ({ ok: true, status: 200, statusText: 'OK' });

    try {
      const res = await syncQueue();
      expect(res.synced).toBe(1);
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });
});
