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
  // Prefijo temporal (mantiene los ids ordenables por creacion, igual que antes)
  // + sufijo aleatorio criptografico: randomUUID cuando existe y, si no,
  // getRandomValues. Math.random queda solo como ultimo recurso sin Web Crypto.
  const prefix = Date.now().toString(36);
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(8));
    return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
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
 * Prefijo reservado de los saldos iniciales. El `:` separa el id del insumo:
 * como el libro rechaza los ids manuales con este prefijo, el id del saldo
 * inicial nunca colisiona con un movimiento de otro insumo (codificacion
 * libre de colisiones) y es determinista por insumo: dos pestanas reservan
 * el MISMO id y el `createIfAbsent` atomico deja una sola apertura.
 */
export const OPENING_ID_PREFIX = 'mov-open:';

/** Id determinista del saldo inicial de un insumo (unicidad atomica por insumo). */
export function openingIdFor(itemId: string): string {
  return `${OPENING_ID_PREFIX}${itemId}`;
}

/** Intentos de la cadena de reserva del saldo inicial antes de rendirse. */
const OPENING_FALLBACK_ATTEMPTS = 8;

/** Intentos de sincronizacion del stock antes de rendirse (contienda alta). */
const SYNC_MAX_ATTEMPTS = 10;

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

  const baseId = openingIdFor(itemId);
  await withMovementIdLock(baseId, async () => {
    if ((await itemMovements(adapter, instanceId, itemId)).length > 0) return;
    // Cadena determinista: si el id esta ocupado por otro insumo (basura
    // historica: el libro ya rechaza plantar estos ids a mano), se prueba con
    // los sufijos `:2`, `:3`, ... — identicos en todas las pestanas, asi que el
    // `createIfAbsent` atomico sigue dejando una sola apertura. Nunca aleatorio.
    const now = new Date().toISOString();
    let candidateId = baseId;
    for (let attempt = 0; ; attempt++) {
      const created = await claimMovement(adapter, instanceId, {
        id: candidateId,
        instance_id: instanceId,
        itemId,
        kind: 'adjust',
        qty: quantity,
        note: OPENING_NOTE,
        created_at: now,
        updated_at: now,
      } as DomainRecord);
      if (created) return;
      const existing = (await adapter.get('stockMovement', candidateId, instanceId)) as Record<
        string,
        unknown
      > | null;
      // La otra pestana gano la carrera con el mismo id: apertura unica, listo.
      if (existing && existing.itemId === itemId) return;
      if (attempt + 1 >= OPENING_FALLBACK_ATTEMPTS) {
        throw new Error('Conflicto de movimiento: no se pudo reservar el saldo inicial');
      }
      candidateId = `${baseId}:${attempt + 2}`;
    }
  });
}

/**
 * Recalcula el stock del insumo desde el libro y lo guarda con compare-and-set
 * sobre `updated_at` (relee version y suma en cada intento). Si otra pestana
 * escribio entre la lectura y la escritura, el intento se descarta y se
 * reintenta: la ultima escritura ganadora siempre suma todos los movimientos
 * visibles en su relectura, asi que al cesar la contienda el insumo converge
 * al total del libro en vez de quedarse con un valor obsoleto.
 */
export async function syncQuantity(adapter: StorageAdapter, instanceId: string, itemId: string): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    if (!adapter.updateIfCurrent) {
      const quantity = await quantityOf(adapter, instanceId, itemId);
      await adapter.update('inventoryItem', itemId, { quantity }, instanceId);
      return quantity;
    }
    // Version primero: todo movimiento creado antes de esta lectura queda
    // incluido en la suma posterior; si el CAS tiene exito, ningun escritor se
    // intercalo y la suma es completa.
    const item = (await adapter.get('inventoryItem', itemId, instanceId)) as Record<string, unknown> | null;
    if (!item) return quantityOf(adapter, instanceId, itemId);
    const quantity = await quantityOf(adapter, instanceId, itemId);
    const next = await adapter.updateIfCurrent(
      'inventoryItem',
      itemId,
      { quantity },
      instanceId,
      String(item.updated_at ?? ''),
    );
    if (next) return quantity;
    if (attempt + 1 >= SYNC_MAX_ATTEMPTS) {
      throw new Error('Conflicto de concurrencia al sincronizar el stock: reintente la operacion');
    }
  }
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
  // El prefijo del saldo inicial esta reservado: plantarlo a mano colisionaria
  // con la reserva determinista (misma codificacion en todas las pestanas).
  if (fixedId?.startsWith(OPENING_ID_PREFIX)) {
    throw new Error('Conflicto de movimiento: id reservado para el saldo inicial');
  }
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
  // Mismo filtro que `quantityOf` (incluye borrado suave): el historial nunca
  // muestra movimientos que el stock ya ignora.
  const movements = await itemMovements(adapter, instanceId, itemId);
  return movements.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
