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
  check?: string;
}

export function inventoryExportFilename(instanceId: string, now: string): string {
  const date = now.split('T')[0];
  return `gara-g-inventory-${instanceId}-${date}.json`;
}

function normalizeKind(k: unknown): 'purchase' | 'use' | 'waste' | 'adjust' {
  if (k === 'purchase' || k === 'use' || k === 'waste' || k === 'adjust') return k;
  return 'adjust';
}

function isValidIsoDate(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  const d = new Date(str);
  return !isNaN(d.getTime()) && d.toISOString() === str;
}

export function validateSnapshot(parsed: any): InventorySnapshot {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InventoryExportError('formato', 'El documento no es un objeto JSON');
  }
  if (parsed.format !== 'swal-inventory-export/v1') {
    throw new InventoryExportError('formato', 'Formato de exportacion desconocido');
  }
  if (!parsed.source || typeof parsed.source !== 'object') throw new InventoryExportError('formato', 'Falta source');
  if (typeof parsed.source.appId !== 'string') throw new InventoryExportError('formato', 'source.appId invalido');
  if (typeof parsed.source.instanceId !== 'string') throw new InventoryExportError('formato', 'source.instanceId invalido');
  if (typeof parsed.source.schemaVersion !== 'number' || !Number.isFinite(parsed.source.schemaVersion)) throw new InventoryExportError('formato', 'source.schemaVersion invalido');
  if (!isValidIsoDate(parsed.source.exportedAt)) throw new InventoryExportError('formato', 'source.exportedAt invalido');
  if (typeof parsed.currency !== 'string') throw new InventoryExportError('formato', 'currency invalido');

  if (!Array.isArray(parsed.locations)) throw new InventoryExportError('formato', 'locations no es array');
  const locations: any[] = [];
  for (const loc of parsed.locations) {
    if (!loc || typeof loc !== 'object') throw new InventoryExportError('formato', 'location no es objeto');
    if (typeof loc.id !== 'string') throw new InventoryExportError('formato', 'location.id invalido');
    if (typeof loc.name !== 'string') throw new InventoryExportError('formato', 'location.name invalido');
    if (loc.type !== 'bodega' && loc.type !== 'sucursal') throw new InventoryExportError('formato', 'location.type invalido');
    locations.push({
      id: loc.id,
      name: loc.name,
      type: loc.type
    });
  }

  if (!Array.isArray(parsed.items)) throw new InventoryExportError('formato', 'items no es array');
  const items: any[] = [];
  for (const item of parsed.items) {
    if (!item || typeof item !== 'object') throw new InventoryExportError('formato', 'item no es objeto');
    if (typeof item.id !== 'string') throw new InventoryExportError('formato', 'item.id invalido');
    if (item.sku !== undefined && typeof item.sku !== 'string') throw new InventoryExportError('formato', 'item.sku invalido');
    if (typeof item.name !== 'string') throw new InventoryExportError('formato', 'item.name invalido');
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) throw new InventoryExportError('formato', 'item.quantity invalido');
    if (item.unit !== undefined && typeof item.unit !== 'string') throw new InventoryExportError('formato', 'item.unit invalido');
    if (typeof item.minStock !== 'number' || !Number.isFinite(item.minStock)) throw new InventoryExportError('formato', 'item.minStock invalido');
    if (typeof item.cost !== 'number' || !Number.isFinite(item.cost)) throw new InventoryExportError('formato', 'item.cost invalido');
    if (typeof item.price !== 'number' || !Number.isFinite(item.price)) throw new InventoryExportError('formato', 'item.price invalido');
    if (item.locationId !== undefined && typeof item.locationId !== 'string') throw new InventoryExportError('formato', 'item.locationId invalido');
    if (!item.customFields || typeof item.customFields !== 'object' || Array.isArray(item.customFields)) throw new InventoryExportError('formato', 'item.customFields invalido');

    items.push({
      id: item.id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      minStock: item.minStock,
      cost: item.cost,
      price: item.price,
      locationId: item.locationId,
      customFields: { ...item.customFields }
    });
  }

  if (!Array.isArray(parsed.movements)) throw new InventoryExportError('formato', 'movements no es array');
  const movements: any[] = [];
  for (const mov of parsed.movements) {
    if (!mov || typeof mov !== 'object') throw new InventoryExportError('formato', 'movement no es objeto');
    if (typeof mov.id !== 'string') throw new InventoryExportError('formato', 'movement.id invalido');
    if (typeof mov.itemId !== 'string') throw new InventoryExportError('formato', 'movement.itemId invalido');
    if (typeof mov.qty !== 'number' || !Number.isFinite(mov.qty)) throw new InventoryExportError('formato', 'movement.qty invalido');
    if (!isValidIsoDate(mov.at)) throw new InventoryExportError('formato', 'movement.at invalido');
    if (mov.customFields !== undefined && (!mov.customFields || typeof mov.customFields !== 'object' || Array.isArray(mov.customFields))) throw new InventoryExportError('formato', 'movement.customFields invalido');

    movements.push({
      id: mov.id,
      itemId: mov.itemId,
      kind: normalizeKind(mov.kind),
      qty: mov.qty,
      at: mov.at,
      ...(mov.customFields ? { customFields: { ...mov.customFields } } : {})
    });
  }

  return {
    format: 'swal-inventory-export/v1',
    source: {
      appId: parsed.source.appId,
      instanceId: parsed.source.instanceId,
      schemaVersion: parsed.source.schemaVersion,
      exportedAt: parsed.source.exportedAt
    },
    currency: parsed.currency,
    locations,
    items,
    movements
  };
}

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 32768; // 32 KiB
  let str = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    // Extracting subarray for chunking, and converting it
    str += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(str);
}

function b642ab(b64: string): ArrayBuffer {
  const s = atob(b64);
  const buf = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    buf[i] = s.charCodeAt(i);
  }
  return buf.buffer;
}

// Timing-safe equal for array buffers
function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  if (va.length !== vb.length) return false;
  let result = 0;
  for (let i = 0; i < va.length; i++) {
    result |= va[i] ^ vb[i];
  }
  return result === 0;
}

async function getDerivationKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
}

export async function sealInventorySnapshot(
  snapshot: InventorySnapshot,
  passphrase: string,
): Promise<SealedInventorySnapshot> {
  validateSnapshot(snapshot);

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const baseKey = await getDerivationKey(passphrase);
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000,
      hash: 'SHA-256',
    },
    baseKey,
    512
  );

  const aesKeyBytes = derivedBits.slice(0, 32);
  const hmacKeyBytes = derivedBits.slice(32, 64);

  const aesKey = await globalThis.crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const hmacKey = await globalThis.crypto.subtle.importKey('raw', hmacKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const enc = new TextEncoder();
  const plainBytes = enc.encode(JSON.stringify(snapshot));

  const cipherBytes = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plainBytes,
  );

  const saltB64 = ab2b64(salt.buffer);
  const ivB64 = ab2b64(iv.buffer);

  const macData = enc.encode(`swal-inventory-export-enc/v1|${saltB64}|${ivB64}`);
  const checkBuf = await globalThis.crypto.subtle.sign('HMAC', hmacKey, macData);
  const check = ab2b64(checkBuf);

  return {
    format: 'swal-inventory-export-enc/v1',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 600000,
    },
    salt: saltB64,
    iv: ivB64,
    ciphertext: ab2b64(cipherBytes),
    check,
  };
}

export async function openInventorySnapshot(
  input: unknown,
  passphrase?: string,
): Promise<InventorySnapshot> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InventoryExportError('formato', 'El documento no es un objeto JSON');
  }
  if ((input as { format?: string }).format === 'swal-inventory-export/v1') {
    return validateSnapshot(input);
  }

  const sealed = input as SealedInventorySnapshot;
  if (sealed.format !== 'swal-inventory-export-enc/v1') {
    throw new InventoryExportError('formato', 'Formato de envoltura desconocido');
  }
  if (sealed.kdf.name !== 'PBKDF2' || sealed.kdf.hash !== 'SHA-256' || sealed.kdf.iterations !== 600000) {
    throw new InventoryExportError('formato', 'Parametros KDF no soportados');
  }
  if (!passphrase) {
    throw new InventoryExportError('clave', 'Se requiere contraseña');
  }

  const salt = b642ab(sealed.salt);
  const iv = b642ab(sealed.iv);
  const cipherBytes = b642ab(sealed.ciphertext);

  const baseKey = await getDerivationKey(passphrase);
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: sealed.kdf.iterations,
      hash: sealed.kdf.hash,
    },
    baseKey,
    512
  );

  const aesKeyBytes = derivedBits.slice(0, 32);
  const hmacKeyBytes = derivedBits.slice(32, 64);

  const hmacKey = await globalThis.crypto.subtle.importKey('raw', hmacKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  if (sealed.check) {
    const enc = new TextEncoder();
    const macData = enc.encode(`swal-inventory-export-enc/v1|${sealed.salt}|${sealed.iv}`);
    const expectedCheckBuf = await globalThis.crypto.subtle.sign('HMAC', hmacKey, macData);
    const expectedCheck = ab2b64(expectedCheckBuf);
    const actualCheckBuf = b642ab(sealed.check);
    const expectedCheckBuf2 = b642ab(expectedCheck);

    if (!timingSafeEqual(actualCheckBuf, expectedCheckBuf2)) {
      throw new InventoryExportError('clave', 'Contraseña incorrecta');
    }
  }

  const aesKey = await globalThis.crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);

  let plainBytes: ArrayBuffer;
  try {
    plainBytes = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      cipherBytes,
    );
  } catch (e) {
    if (sealed.check) {
      throw new InventoryExportError('alterado', 'Documento corrupto o alterado');
    }
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

  return validateSnapshot(parsed);
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
    const data = w as Record<string, unknown>;
    return {
      id: data.id,
      name: data.name || '',
      type: (data.type === 'bodega' || data.type === 'sucursal') ? data.type : 'bodega',
    };
  });

  const items = rawItems.filter(i => !i.deletedAt && !i.deleted_at).map(i => {
    const data = i as Record<string, unknown>;
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
    const data = m as Record<string, unknown>;
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
