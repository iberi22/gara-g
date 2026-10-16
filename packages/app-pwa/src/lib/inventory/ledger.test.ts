import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMemoryAdapter, setStorageAdapter, type DomainRecord, type StorageAdapter } from '../domain';
import { appendMovement, movementHistory, quantityOf, txSign, syncQuantity } from './ledger';

/**
 * Adapter que comparte el almacenamiento entre "pestanas" y retiene la PRIMERA
 * escritura del stock para forzar el entrelazado: la primera llamada a
 * `update`/`updateIfCurrent` avisa (`onFirstWrite`) y espera (`holdFirst`)
 * mientras la segunda operacion completa su ciclo. Reproduce dos pestanas
 * IndexedDB/D1 concurrentes sin necesidad de un navegador real.
 */
class GatedWritesAdapter implements StorageAdapter {
  private firstWriteTaken = false;
  constructor(
    private readonly inner: StorageAdapter,
    private readonly hooks: { holdFirst: Promise<void>; onFirstWrite: () => void },
  ) {}
  create(entity: string, record: DomainRecord): Promise<DomainRecord> {
    return this.inner.create(entity, record);
  }
  createIfAbsent(entity: string, record: DomainRecord): Promise<boolean> {
    if (!this.inner.createIfAbsent) throw new Error('sin createIfAbsent');
    return this.inner.createIfAbsent(entity, record);
  }
  list(entity: string, instanceId: string): Promise<DomainRecord[]> {
    return this.inner.list(entity, instanceId);
  }
  get(entity: string, id: string, instanceId: string): Promise<DomainRecord | null> {
    return this.inner.get(entity, id, instanceId);
  }
  async update(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
  ): Promise<DomainRecord | null> {
    await this.maybeGate(entity);
    return this.inner.update(entity, id, patch, instanceId);
  }
  async updateIfCurrent(
    entity: string,
    id: string,
    patch: Record<string, unknown>,
    instanceId: string,
    expectedUpdatedAt: string,
  ): Promise<DomainRecord | null> {
    await this.maybeGate(entity);
    if (this.inner.updateIfCurrent) {
      return this.inner.updateIfCurrent(entity, id, patch, instanceId, expectedUpdatedAt);
    }
    const cur = (await this.inner.get(entity, id, instanceId)) as Record<string, unknown> | null;
    if (!cur || String(cur.updated_at ?? '') !== expectedUpdatedAt) return null;
    return this.inner.update(entity, id, patch, instanceId);
  }
  del(entity: string, id: string, instanceId: string): Promise<boolean> {
    return this.inner.del(entity, id, instanceId);
  }
  private async maybeGate(entity: string): Promise<void> {
    if (entity !== 'inventoryItem' || this.firstWriteTaken) return;
    this.firstWriteTaken = true;
    this.hooks.onFirstWrite();
    await this.hooks.holdFirst;
  }
}

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

  it('genera el id del movimiento con crypto.randomUUID cuando esta disponible', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'uuid-item', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    const real = globalThis.crypto;
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: real.getRandomValues.bind(real) });
    try {
      const tx = await appendMovement(adapter, 'inst1', 'uuid-item', 'purchase', 3);
      expect(randomUUID).toHaveBeenCalledTimes(1);
      expect(tx.id).toMatch(/^[0-9a-z]+-11111111-2222-4333-8444-555555555555$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('movementHistory oculta movimientos con borrado suave y no altera el stock', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('inventoryItem', { id: 'sd-item', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);
    await appendMovement(adapter, 'inst1', 'sd-item', 'purchase', 10);
    const [live] = await movementHistory(adapter, 'inst1', 'sd-item');

    const now = new Date().toISOString();
    await adapter.create('stockMovement', {
      id: 'sd-del-camel', instance_id: 'inst1', itemId: 'sd-item', kind: 'purchase', qty: 7,
      deletedAt: now, created_at: now, updated_at: now,
    } as unknown as DomainRecord);
    await adapter.create('stockMovement', {
      id: 'sd-del-snake', instance_id: 'inst1', itemId: 'sd-item', kind: 'use', qty: 4,
      deleted_at: now, created_at: now, updated_at: now,
    } as unknown as DomainRecord);

    const history = await movementHistory(adapter, 'inst1', 'sd-item');
    expect(history.map((h) => h.id)).toEqual([live.id]);
    expect(await quantityOf(adapter, 'inst1', 'sd-item')).toBe(10); // 10, nunca 10+7-4
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
    // Wait, the test says: "{id:"mov-open:a"} on an item with initial 15 throws conflict, stock 15, then normal purchase(10) -> 25"
    await expect(appendMovement(adapter, 'inst1', 'a', 'purchase', 10, undefined, { id: 'mov-open:a' }))
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

  it('dos compras concurrentes crean un solo saldo inicial aunque el id determinista este ocupado', async () => {
    const adapter = getMemoryAdapter();
    // Legado: el id determinista del saldo inicial ocupado por otro insumo.
    // Se planta por las dos codificaciones (guion historico y `:` actual)
    // directo en el adapter, porque el libro rechaza el prefijo reservado.
    await adapter.create('inventoryItem', { id: 'a', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);
    const now = new Date().toISOString();
    for (const legacyId of ['mov-open-b', 'mov-open:b']) {
      await adapter.create('stockMovement', {
        id: legacyId, instance_id: 'inst1', itemId: 'a', kind: 'purchase', qty: 1,
        created_at: now, updated_at: now,
      } as unknown as DomainRecord);
    }
    await adapter.create('inventoryItem', { id: 'b', instance_id: 'inst1', quantity: 15, created_at: '', updated_at: '' } as unknown as DomainRecord);

    // Dos "pestanas": dos instancias del modulo (sin cerrojo en memoria
    // compartido) sobre el mismo almacenamiento, como dos tabs IndexedDB.
    vi.resetModules();
    const tab1 = await import('./ledger');
    vi.resetModules();
    const tab2 = await import('./ledger');
    await Promise.all([
      tab1.appendMovement(adapter, 'inst1', 'b', 'purchase', 5),
      tab2.appendMovement(adapter, 'inst1', 'b', 'purchase', 7),
    ]);

    // 15 (un solo saldo inicial) + 5 + 7 = 27, nunca 42 (doble apertura).
    expect(await quantityOf(adapter, 'inst1', 'b')).toBe(27);
    const item = (await adapter.get('inventoryItem', 'b', 'inst1')) as unknown as DomainRecord;
    expect(item.quantity).toBe(27);
    // El movimiento heredado de `a` sigue intacto.
    expect(await quantityOf(adapter, 'inst1', 'a')).toBe(2);
  });

  it('una escritura de stock retrasada no pisa una mas nueva (libro 109, insumo 109)', async () => {
    const inner = getMemoryAdapter();
    let release!: () => void;
    const holdFirst = new Promise<void>((r) => {
      release = r;
    });
    let enteredResolve!: () => void;
    const entered = new Promise<void>((r) => {
      enteredResolve = r;
    });
    const adapter = new GatedWritesAdapter(inner, { holdFirst, onFirstWrite: enteredResolve });
    await inner.create('inventoryItem', { id: 'race-stock', instance_id: 'inst1', quantity: 0, created_at: '', updated_at: '' } as unknown as DomainRecord);

    // Primera compra: calcula 10 y se queda retenida justo antes de guardar el stock.
    const slow = appendMovement(adapter, 'inst1', 'race-stock', 'purchase', 10);
    await entered;
    // Segunda compra: ciclo completo mientras la primera sigue retenida.
    await appendMovement(adapter, 'inst1', 'race-stock', 'purchase', 99);
    release();
    await slow;

    expect(await quantityOf(adapter, 'inst1', 'race-stock')).toBe(109);
    const item = (await inner.get('inventoryItem', 'race-stock', 'inst1')) as unknown as DomainRecord;
    expect(item.quantity).toBe(109);
  });
});
