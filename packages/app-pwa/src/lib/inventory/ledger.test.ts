import { describe, it, expect, beforeEach } from 'vitest';
import { getMemoryAdapter, setStorageAdapter, type DomainRecord } from '../domain';
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
    await adapter.create('inventoryItem', { id: 'item1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    await appendMovement(adapter, 'inst1', 'item1', 'purchase', 50);
    expect(await quantityOf(adapter, 'inst1', 'item1')).toBe(50);

    const history = await movementHistory(adapter, 'inst1', 'item1');
    expect(history).toHaveLength(1);
    expect((history[0] as unknown as DomainRecord).kind).toBe('purchase');
    expect((history[0] as unknown as DomainRecord).qty).toBe(50);
  });

  it('appendMovement correctly handles multiple movements and signs', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item2', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

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
    await adapter.create('inventoryItem', { id: 'item3', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    const tx1 = await appendMovement(adapter, 'inst1', 'item3', 'purchase', 20, undefined, { id: 'tx-fixed-1' });
    expect(await quantityOf(adapter, 'inst1', 'item3')).toBe(20);

    const tx2 = await appendMovement(adapter, 'inst1', 'item3', 'purchase', 20, undefined, { id: 'tx-fixed-1' });
    expect(await quantityOf(adapter, 'inst1', 'item3')).toBe(20); // still 20
    expect(tx2.id).toEqual(tx1.id); // returns same tx id
  });

  it('creates opening balance if item has quantity but no movements', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item4', instance_id: 'inst1', quantity: 15, created_at: '', updated_at: '' } as unknown as DomainRecord);

    await appendMovement(adapter, 'inst1', 'item4', 'purchase', 10);

    const history = await movementHistory(adapter, 'inst1', 'item4');
    expect(history).toHaveLength(2); // opening balance + purchase
    expect((history[0] as unknown as DomainRecord).kind).toBe('adjust');
    expect((history[0] as unknown as DomainRecord).qty).toBe(15);

    expect(await quantityOf(adapter, 'inst1', 'item4')).toBe(25); // 15 + 10
  });

  it('syncQuantity updates item.quantity from sum of movements', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item5', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    await appendMovement(adapter, 'inst1', 'item5', 'purchase', 40);
    const item = await adapter.get('inventoryItem', 'item5', 'inst1');
    expect((item as unknown as DomainRecord).quantity).toBe(40);
  });

  it('instance isolation: movements are scoped to instanceId', async () => {
    const adapter = getMemoryAdapter();
    // different items
    await adapter.create('inventoryItem', { id: 'itemA', instance_id: 'instA', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);
    await adapter.create('inventoryItem', { id: 'itemB', instance_id: 'instB', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    await appendMovement(adapter, 'instA', 'itemA', 'purchase', 100);
    await appendMovement(adapter, 'instB', 'itemB', 'purchase', 50);

    expect(await quantityOf(adapter, 'instA', 'itemA')).toBe(100);
    expect(await quantityOf(adapter, 'instB', 'itemB')).toBe(50);
  });

  it('adjust handles positive and negative values correctly', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'item7', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    await appendMovement(adapter, 'inst1', 'item7', 'adjust', 20);
    expect(await quantityOf(adapter, 'inst1', 'item7')).toBe(20);

    await appendMovement(adapter, 'inst1', 'item7', 'adjust', -5);
    expect(await quantityOf(adapter, 'inst1', 'item7')).toBe(15);
  });

  it('appendMovement rejects invalid kinds', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'i1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    await expect(appendMovement(adapter, 'inst1', 'i1', 'magic' as unknown as unknown as import('./ledger').TxKind, 10))
      .rejects.toThrow(/Tipo de movimiento invalido/);
  });

  it('appendMovement rejects invalid quantities', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'i1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    await expect(appendMovement(adapter, 'inst1', 'i1', 'purchase', NaN))
      .rejects.toThrow(/Cantidad de movimiento invalida/);
  });

  it('appendMovement rejects fixed id conflicts', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'i1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);
    await adapter.create('inventoryItem', { id: 'i2', instance_id: 'inst1', quantity: 0 } as unknown as DomainRecord);

    await appendMovement(adapter, 'inst1', 'i1', 'purchase', 10, undefined, { id: 'conflict-id' });

    await expect(appendMovement(adapter, 'inst1', 'i2', 'purchase', 10, undefined, { id: 'conflict-id' }))
      .rejects.toThrow(/Conflicto de movimiento/);
  });

  it('appendMovement returns existing when id matches with identical data', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'i1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);
    const tx1 = await appendMovement(adapter, 'inst1', 'i1', 'purchase', 10, 'note', { id: 'tx-same', maintenanceId: 'job1' });
    const tx2 = await appendMovement(adapter, 'inst1', 'i1', 'purchase', 10, 'note', { id: 'tx-same', maintenanceId: 'job1' });
    expect(tx1.id).toBe(tx2.id);
    expect(await quantityOf(adapter, 'inst1', 'i1')).toBe(10);
  });

  it('appendMovement throws conflict when id matches but qty is different', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'i1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);
    await appendMovement(adapter, 'inst1', 'i1', 'purchase', 10, 'note', { id: 'tx-diff', maintenanceId: 'job1' });
    await expect(appendMovement(adapter, 'inst1', 'i1', 'purchase', 99, 'note', { id: 'tx-diff', maintenanceId: 'job1' }))
      .rejects.toThrow(/Conflicto de movimiento/);
    expect(await quantityOf(adapter, 'inst1', 'i1')).toBe(10);
  });

  it('appendMovement throws conflict when id matches but maintenanceId is different', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'i1', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);
    await appendMovement(adapter, 'inst1', 'i1', 'purchase', 10, 'note', { id: 'tx-diff-maint', maintenanceId: 'job1' });
    await expect(appendMovement(adapter, 'inst1', 'i1', 'purchase', 10, 'note', { id: 'tx-diff-maint', maintenanceId: 'job2' }))
      .rejects.toThrow(/Conflicto de movimiento/);
    expect(await quantityOf(adapter, 'inst1', 'i1')).toBe(10);
  });

  it('appendMovement throws conflict for opening balance id manually provided', async () => {
    const adapter = getMemoryAdapter();
    // Item with initial 15
    await adapter.create('inventoryItem', { id: 'a', instance_id: 'inst1', quantity: 15, created_at: '', updated_at: '' } as unknown as DomainRecord);

    // Trying to use opening balance id manually should throw conflict because the system will generate it first and it will clash or be created.
    // Wait, the test says: "{id:"mov-open-a"} on an item with initial 15 throws conflict, stock 15, then normal purchase(10) -> 25"
    await expect(appendMovement(adapter, 'inst1', 'a', 'purchase', 10, undefined, { id: 'mov-open-a' }))
      .rejects.toThrow(/Conflicto de movimiento/);
    expect(await quantityOf(adapter, 'inst1', 'a')).toBe(15);

    // Normal purchase
    await appendMovement(adapter, 'inst1', 'a', 'purchase', 10);
    expect(await quantityOf(adapter, 'inst1', 'a')).toBe(25);
  });

  it('el saldo inicial no sobrescribe un movimiento de otro insumo con el mismo id reservado', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'a', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    // "mov-open-b" es el id reservado del saldo inicial de b, pero se usa como id manual de a.
    await appendMovement(adapter, 'inst1', 'a', 'purchase', 10, undefined, { id: 'mov-open-b' });
    expect(await quantityOf(adapter, 'inst1', 'a')).toBe(10);

    await adapter.create('inventoryItem', { id: 'b', instance_id: 'inst1', quantity: 15, created_at: '', updated_at: '' } as unknown as DomainRecord);
    await appendMovement(adapter, 'inst1', 'b', 'purchase', 5);

    expect(await quantityOf(adapter, 'inst1', 'a')).toBe(10); // el saldo inicial de b no lo pisa
    expect(await quantityOf(adapter, 'inst1', 'b')).toBe(20); // 15 saldo inicial + 5

    const aHistory = await movementHistory(adapter, 'inst1', 'a');
    expect(aHistory).toHaveLength(1);
    expect((aHistory[0] as unknown as DomainRecord).id).toBe('mov-open-b');
    expect((aHistory[0] as unknown as DomainRecord).itemId).toBe('a');
  });

  it('dos altas concurrentes con el mismo id rechazan la incompatible', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'c', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    const results = await Promise.allSettled([
      appendMovement(adapter, 'inst1', 'c', 'purchase', 10, undefined, { id: 'race-id' }),
      appendMovement(adapter, 'inst1', 'c', 'purchase', 99, undefined, { id: 'race-id' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(((rejected[0] as PromiseRejectedResult).reason as Error).message).toMatch(/Conflicto de movimiento/);

    const history = await movementHistory(adapter, 'inst1', 'c');
    expect(history).toHaveLength(1);
    // El stock refleja exactamente el unico movimiento que gano la carrera.
    expect(await quantityOf(adapter, 'inst1', 'c')).toBe(Number((history[0] as unknown as DomainRecord).qty));
  });
});
