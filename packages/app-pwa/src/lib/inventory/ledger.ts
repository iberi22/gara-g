import type { StorageAdapter, DomainRecord } from '../domain';

export const TX_KINDS = ['purchase', 'use', 'waste', 'adjust'] as const;
export type TxKind = (typeof TX_KINDS)[number];

export function isTxKind(value: unknown): value is TxKind {
  return typeof value === 'string' && (TX_KINDS as readonly string[]).includes(value);
}

export function txSign(kind: TxKind, qty: number): number {
  if (kind === 'use' || kind === 'waste') return -Math.abs(qty);
  if (kind === 'purchase') return Math.abs(qty);
  return qty; // adjust: respeta el signo
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AppendMovementOptions {
  /**
   * Id fijo del movimiento. Si ya existe, no se vuelve a sumar: reintentar la
   * misma peticion no duplica el stock.
   */
  id?: string;
  maintenanceId?: string;
}

/**
 * Cantidad con signo de un movimiento.
 */
export function signedQtyOf(tx: Record<string, unknown>): number {
  const qty = Number(tx.qty);
  return isTxKind(tx.kind) && Number.isFinite(qty) ? txSign(tx.kind, qty) : 0;
}

async function itemMovements(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<DomainRecord[]> {
  const all = await adapter.list('stockMovement', instanceId);
  return all.filter((t) => {
    const data = t as any;
    return data.itemId === itemId && !data.deletedAt && !data.deleted_at;
  });
}

/**
 * Un insumo con stock pero sin ningun movimiento recibe un
 * movimiento de saldo inicial: si no, el primer movimiento recalcula desde cero y ese stock desaparece.
 */
async function ensureOpeningBalance(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<void> {
  const item = (await adapter.get('inventoryItem', itemId, instanceId)) as Record<string, unknown> | null;
  const quantity = Number(item?.quantity ?? 0);
  if (!item || !Number.isFinite(quantity) || quantity === 0) return;
  if ((await itemMovements(adapter, instanceId, itemId)).length > 0) return;
  const now = new Date().toISOString();
  await adapter.create('stockMovement', {
    id: `mov-open-${itemId}`,
    instance_id: instanceId,
    itemId,
    kind: 'adjust',
    qty: quantity,
    note: 'saldo inicial (stock anterior al libro de movimientos)',
    created_at: now,
    updated_at: now,
  } as DomainRecord);
}

/** Recalcula el stock del insumo desde el libro y lo guarda. */
export async function syncQuantity(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<number> {
  const quantity = await quantityOf(adapter, instanceId, itemId);
  await adapter.update('inventoryItem', itemId, { quantity }, instanceId);
  return quantity;
}

export async function appendMovement(
  adapter: StorageAdapter,
  instanceId: string,
  itemId: string,
  kind: TxKind,
  qty: number,
  note?: string,
  opts: AppendMovementOptions = {},
): Promise<DomainRecord> {
  if (opts.id) {
    const existing = await adapter.get('stockMovement', opts.id, instanceId);
    if (existing) {
      await syncQuantity(adapter, instanceId, itemId);
      return existing;
    }
  }

  // ensure item exists
  const item = await adapter.get('inventoryItem', itemId, instanceId);
  if (!item) {
    throw new Error(`Item no encontrado: ${itemId}`);
  }

  await ensureOpeningBalance(adapter, instanceId, itemId);

  const now = new Date().toISOString();
  const tx = (await adapter.create('stockMovement', {
    id: opts.id ?? genId(),
    instance_id: instanceId,
    itemId,
    kind,
    qty,
    note: note ?? null,
    ...(opts.maintenanceId !== undefined ? { maintenanceId: opts.maintenanceId } : {}),
    created_at: now,
    updated_at: now,
  } as DomainRecord)) as DomainRecord;

  await syncQuantity(adapter, instanceId, itemId);
  return tx;
}

export async function quantityOf(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<number> {
  // SUM(signedQty) — stock derivado
  return (await itemMovements(adapter, instanceId, itemId)).reduce(
    (sum, t) => sum + signedQtyOf(t as Record<string, unknown>),
    0,
  );
}

export async function movementHistory(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<DomainRecord[]> {
  const all = await adapter.list('stockMovement', instanceId);
  return all
    .filter((t) => (t as Record<string, unknown>).itemId === itemId)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
