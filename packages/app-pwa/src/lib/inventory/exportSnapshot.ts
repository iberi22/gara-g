import type { StorageAdapter } from '../domain';

export type InventoryExportErrorKind = 'formato' | 'clave' | 'alterado';

export class InventoryExportError extends Error {
  constructor(public kind: InventoryExportErrorKind, message: string) {
    super(message);
    this.name = 'InventoryExportError';
  }
}

export interface InventorySnapshot {
  format: 'swal-inventory-export/v1';
  source: {
    appId: string;
    instanceId: string;
    schemaVersion: number;
    exportedAt: string;
  };
  currency: string;
  locations: Array<{
    id: string;
    name: string;
    type: 'bodega' | 'sucursal';
  }>;
  items: Array<{
    id: string;
    sku?: string;
    name: string;
    quantity: number;
    unit?: string;
    minStock: number;
    cost: number;
    price: number;
    locationId?: string;
    customFields: Record<string, unknown>;
  }>;
  movements: Array<{
    id: string;
    itemId: string;
    kind: 'purchase' | 'use' | 'waste' | 'adjust';
    qty: number;
    at: string;
    customFields?: Record<string, unknown>;
  }>;
}

export interface SealedInventorySnapshot {
  format: 'swal-inventory-export-enc/v1';
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
  };
  salt: string;
  iv: string;
  ciphertext: string;
}

export function inventoryExportFilename(instanceId: string, now: string): string {
  const date = now.split('T')[0];
  return `gara-g-inventory-${instanceId}-${date}.json`;
}

function normalizeKind(k: unknown): 'purchase' | 'use' | 'waste' | 'adjust' {
  if (k === 'purchase' || k === 'use' || k === 'waste' || k === 'adjust') return k;
  return 'adjust';
}

function ab2b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b642ab(b64: string): ArrayBuffer {
  const s = atob(b64);
  const buf = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    buf[i] = s.charCodeAt(i);
  }
  return buf.buffer;
}

async function getDerivationKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
}

export async function sealInventorySnapshot(
  snapshot: InventorySnapshot,
  passphrase: string,
): Promise<SealedInventorySnapshot> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const baseKey = await getDerivationKey(passphrase);
  const aesKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const enc = new TextEncoder();
  const plainBytes = enc.encode(JSON.stringify(snapshot));

  const cipherBytes = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plainBytes,
  );

  return {
    format: 'swal-inventory-export-enc/v1',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 600000,
    },
    salt: ab2b64(salt.buffer),
    iv: ab2b64(iv.buffer),
    ciphertext: ab2b64(cipherBytes),
  };
}

export async function openInventorySnapshot(
  sealed: SealedInventorySnapshot,
  passphrase: string,
): Promise<InventorySnapshot> {
  if (sealed.format !== 'swal-inventory-export-enc/v1') {
    throw new InventoryExportError('formato', 'Formato de envoltura desconocido');
  }

  const salt = b642ab(sealed.salt);
  const iv = b642ab(sealed.iv);
  const cipherBytes = b642ab(sealed.ciphertext);

  const baseKey = await getDerivationKey(passphrase);
  const aesKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: sealed.kdf.iterations,
      hash: sealed.kdf.hash,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  let plainBytes: ArrayBuffer;
  try {
    plainBytes = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      cipherBytes,
    );
  } catch (e) {
    throw new InventoryExportError('clave', 'Contraseña incorrecta');
  }

  const dec = new TextDecoder();
  const json = dec.decode(plainBytes);

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new InventoryExportError('alterado', 'Documento corrupto o alterado');
  }

  if (parsed.format !== 'swal-inventory-export/v1') {
    throw new InventoryExportError('formato', 'Formato de exportacion desconocido');
  }

  return parsed as InventorySnapshot;
}

import { signedQtyOf } from './ledger';

export async function buildInventorySnapshot(
  adapter: StorageAdapter,
  instanceId: string,
  now = new Date().toISOString()
): Promise<InventorySnapshot> {
  const rawWarehouses = await adapter.list('warehouse', instanceId);
  const rawItems = await adapter.list('inventoryItem', instanceId);
  const rawMovements = await adapter.list('stockMovement', instanceId);

  const locations = rawWarehouses.filter(w => !w.deletedAt && !w.deleted_at).map(w => {
    const data = w as any;
    return {
      id: data.id,
      name: data.name || '',
      type: (data.type === 'bodega' || data.type === 'sucursal') ? data.type : 'bodega',
    };
  });

  const items = rawItems.filter(i => !i.deletedAt && !i.deleted_at).map(i => {
    const data = i as any;
    const customFields: Record<string, unknown> = {};
    if (data.vehicleTypes) customFields.vehicleTypes = String(data.vehicleTypes);
    if (data.notes) customFields.notes = String(data.notes);

    return {
      id: data.id,
      sku: data.sku || undefined,
      name: data.name || '',
      quantity: Number(data.quantity) || 0,
      unit: data.unit || undefined,
      minStock: Number(data.minStock) || 0,
      cost: Number(data.cost) || 0,
      price: Number(data.price) || 0,
      locationId: data.warehouseId || undefined,
      customFields,
    };
  });

  const movements = rawMovements.filter(m => !m.deletedAt && !m.deleted_at).map(m => {
    const data = m as any;
    return {
      id: data.id,
      itemId: data.itemId || '',
      kind: normalizeKind(data.kind),
      qty: signedQtyOf(data),
      at: data.created_at || now,
      ...(data.maintenanceId ? { customFields: { maintenanceId: String(data.maintenanceId) } } : {}),
    };
  });

  return {
    format: 'swal-inventory-export/v1',
    source: {
      appId: 'gara-g',
      instanceId,
      schemaVersion: 1,
      exportedAt: now,
    },
    currency: 'COP',
    locations,
    items,
    movements,
  };
}
