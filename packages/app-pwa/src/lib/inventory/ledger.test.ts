import { describe, it, expect, beforeEach } from 'vitest';
import { getMemoryAdapter, setStorageAdapter } from '../domain';
import { appendMovement, movementHistory, quantityOf, txSign, syncQuantity } from './ledger';

describe('Inventory Ledger', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    setStorageAdapter(getMemoryAdapter());
  });

  it('txSign correctly assigns signs to kinds', () => {
    expect(txSign('purchase', 10)).toBe(10);
    expect(txSign('purchase', -10)).toBe(10);

    expect(txSign('use', 5)).toBe(-5);
    expect(txSign('use', -5)).toBe(-5);

    expect(txSign('waste', 2)).toBe(-2);
    expect(txSign('waste', -2)).toBe(-2);

    expect(txSign('adjust', 15)).toBe(15);
    expect(txSign('adjust', -15)).toBe(-15);
  });

  it('appendMovement rejects unknown items', async () => {
    const adapter = getMemoryAdapter();
    await expect(appendMovement(adapter, 'inst1', 'no-item', 'purchase', 10))
      .rejects.toThrow(/Item no encontrado/);
  });

  it('appendMovement updates item quantity and logs movement', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as any);

    await appendMovement(adapter, 'inst1', 'item1', 'purchase', 50);
    expect(await quantityOf(adapter, 'inst1', 'item1')).toBe(50);

    const history = await movementHistory(adapter, 'inst1', 'item1');
    expect(history).toHaveLength(1);
    expect((history[0] as any).kind).toBe('purchase');
    expect((history[0] as any).qty).toBe(50);
  });

  it('appendMovement correctly handles multiple movements and signs', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item2', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as any);

    await appendMovement(adapter, 'inst1', 'item2', 'purchase', 100);
    await appendMovement(adapter, 'inst1', 'item2', 'use', 30);
    await appendMovement(adapter, 'inst1', 'item2', 'waste', 10);
    await appendMovement(adapter, 'inst1', 'item2', 'adjust', -5);

    expect(await quantityOf(adapter, 'inst1', 'item2')).toBe(55); // 100 - 30 - 10 - 5

    const history = await movementHistory(adapter, 'inst1', 'item2');
    expect(history).toHaveLength(4);
  });

  it('appendMovement is idempotent when same id is retried', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item3', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as any);

    const tx1 = await appendMovement(adapter, 'inst1', 'item3', 'purchase', 20, undefined, { id: 'tx-fixed-1' });
    expect(await quantityOf(adapter, 'inst1', 'item3')).toBe(20);

    const tx2 = await appendMovement(adapter, 'inst1', 'item3', 'purchase', 20, undefined, { id: 'tx-fixed-1' });
    expect(await quantityOf(adapter, 'inst1', 'item3')).toBe(20); // still 20
    expect(tx2.id).toEqual(tx1.id); // returns same tx id
  });

  it('creates opening balance if item has quantity but no movements', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item4', instance_id: 'inst1', quantity: 15, created_at: '', updated_at: '' } as any);

    await appendMovement(adapter, 'inst1', 'item4', 'purchase', 10);

    const history = await movementHistory(adapter, 'inst1', 'item4');
    expect(history).toHaveLength(2); // opening balance + purchase
    expect((history[0] as any).kind).toBe('adjust');
    expect((history[0] as any).qty).toBe(15);

    expect(await quantityOf(adapter, 'inst1', 'item4')).toBe(25); // 15 + 10
  });

  it('syncQuantity updates item.quantity from sum of movements', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item5', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as any);

    await appendMovement(adapter, 'inst1', 'item5', 'purchase', 40);
    const item = await adapter.get('inventoryItem', 'item5', 'inst1');
    expect((item as any).quantity).toBe(40);
  });

  it('instance isolation: movements are scoped to instanceId', async () => {
    const adapter = getMemoryAdapter();
    // different items
    await adapter.create('inventoryItem', { id: 'itemA', instance_id: 'instA', quantity: 0, created_at: '', updated_at: '' } as any);
    await adapter.create('inventoryItem', { id: 'itemB', instance_id: 'instB', quantity: 0, created_at: '', updated_at: '' } as any);

    await appendMovement(adapter, 'instA', 'itemA', 'purchase', 100);
    await appendMovement(adapter, 'instB', 'itemB', 'purchase', 50);

    expect(await quantityOf(adapter, 'instA', 'itemA')).toBe(100);
    expect(await quantityOf(adapter, 'instB', 'itemB')).toBe(50);
  });

  it('adjust handles positive and negative values correctly', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item7', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as any);

    await appendMovement(adapter, 'inst1', 'item7', 'adjust', 20);
    expect(await quantityOf(adapter, 'inst1', 'item7')).toBe(20);

    await appendMovement(adapter, 'inst1', 'item7', 'adjust', -5);
    expect(await quantityOf(adapter, 'inst1', 'item7')).toBe(15);
  });
});
