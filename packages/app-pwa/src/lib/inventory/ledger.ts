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
  const kind = isTxKind(tx.kind) ? tx.kind : 'adjust';
  return Number.isFinite(qty) ? txSign(kind, qty) : 0;
}

async function itemMovements(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<DomainRecord[]> {
  const all = await adapter.list('stockMovement', instanceId);
  return all.filter((t) => {
    const data = t as Record<string, unknown>;
    return data.itemId === itemId && !data.deletedAt && !data.deleted_at;
  });
}

const OPENING_NOTE = 'saldo inicial (stock anterior al libro de movimientos)';

/**
 * Cola por id de movimiento: dentro de un mismo contexto serializa el
 * "comprueba si existe y crea" para que dos llamadas concurrentes con el mismo
 * id no se pisen (IndexedDB usa `put`, que sobrescribe).
 */
const movementOps = new Map<string, Promise<void>>();

async function withMovementIdLock<T>(movementId: string, task: () => Promise<T>): Promise<T> {
  const previous = movementOps.get(movementId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  movementOps.set(movementId, queued);
  try {
    await previous;
    return await task();
  } finally {
    release();
    if (movementOps.get(movementId) === queued) movementOps.delete(movementId);
  }
}

/**
 * Reserva un movimiento por id: `true` si lo creo, `false` si el id ya existia.
 * Delega en `createIfAbsent` cuando el adapter lo soporta (atomico, incluso
 * entre pestanas); si no, el llamador lo serializa con `withMovementIdLock`.
 */
async function claimMovement(adapter: StorageAdapter, instanceId: string, movement: DomainRecord): Promise<boolean> {
  if (adapter.createIfAbsent) return adapter.createIfAbsent('stockMovement', movement);
  const existing = await adapter.get('stockMovement', movement.id, instanceId);
  if (existing) return false;
  await adapter.create('stockMovement', movement);
  return true;
}

/**
 * Un insumo con stock pero sin ningun movimiento recibe un
 * movimiento de saldo inicial: si no, el primer movimiento recalcula desde cero y ese stock desaparece.
 */
async function ensureOpeningBalance(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<void> {
  const item = (await adapter.get('inventoryItem', itemId, instanceId)) as Record<string, unknown> | null;
  if (!item) return;
  const quantity = Number(item.quantity ?? 0);
  if (!Number.isFinite(quantity)) {
    throw new Error(`Cantidad inicial invalida para insumo: ${itemId}`);
  }
  if (quantity === 0) return;

  const openingId = `mov-open-${itemId}`;
  await withMovementIdLock(openingId, async () => {
    if ((await itemMovements(adapter, instanceId, itemId)).length > 0) return;
    // El id reservado puede pertenecer a otro insumo (alguien pudo usar
    // "mov-open-b" como id manual de "a"): en ese caso NO se sobrescribe.
    const owner = (await adapter.get('stockMovement', openingId, instanceId)) as Record<string, unknown> | null;
    const id = owner && owner.itemId !== itemId ? `${openingId}-${genId()}` : openingId;
    const now = new Date().toISOString();
    await claimMovement(adapter, instanceId, {
      id,
      instance_id: instanceId,
      itemId,
      kind: 'adjust',
      qty: quantity,
      note: OPENING_NOTE,
      created_at: now,
      updated_at: now,
    } as DomainRecord);
  });
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
  if (!isTxKind(kind)) {
    throw new Error(`Tipo de movimiento invalido: ${kind}`);
  }
  if (!Number.isFinite(qty)) {
    throw new Error(`Cantidad de movimiento invalida: ${qty}`);
  }

  // ensure item exists
  const item = await adapter.get('inventoryItem', itemId, instanceId);
  if (!item) {
    throw new Error(`Item no encontrado: ${itemId}`);
  }

  await ensureOpeningBalance(adapter, instanceId, itemId);

  const fixedId = opts.id;
  const now = new Date().toISOString();
  const candidate = {
    id: fixedId ?? genId(),
    instance_id: instanceId,
    itemId,
    kind,
    qty,
    note: note ?? null,
    ...(opts.maintenanceId !== undefined ? { maintenanceId: opts.maintenanceId } : {}),
    created_at: now,
    updated_at: now,
  } as DomainRecord;

  if (fixedId) {
    // Reserva y comprobacion juntas: si dos peticiones traen el mismo id, solo una
    // crea; la otra ve el movimiento existente y compara (o falla por conflicto).
    return withMovementIdLock(fixedId, async () => {
      const created = await claimMovement(adapter, instanceId, candidate);
      if (!created) {
        const existing = (await adapter.get('stockMovement', fixedId, instanceId)) as Record<string, unknown> | null;
        if (
          !existing ||
          existing.itemId !== itemId ||
          existing.kind !== kind ||
          Number(existing.qty) !== Number(qty) ||
          (existing.note ?? null) !== (note ?? null) ||
          (existing.maintenanceId ?? undefined) !== opts.maintenanceId
        ) {
          throw new Error('Conflicto de movimiento: el id ya existe con datos diferentes');
        }
        await syncQuantity(adapter, instanceId, itemId);
        return existing as DomainRecord;
      }
      await syncQuantity(adapter, instanceId, itemId);
      return candidate;
    });
  }

  await adapter.create('stockMovement', candidate);

  await syncQuantity(adapter, instanceId, itemId);
  return candidate;
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
