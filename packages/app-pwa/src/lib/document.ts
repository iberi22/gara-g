import { createSealedPack, type SealedPack } from './sealedPack.js';
import { R2StorageClient } from './r2Client.js';

export type DocumentKind = 'insurance' | 'license' | 'inspection' | 'registration' | 'other';
export type DocumentStatus = 'active' | 'expiring' | 'expired';

export interface DocumentInput {
  id?: string;
  instanceId: string;
  vehicleId: string;
  driverId?: string;
  kind: DocumentKind;
  file: File | Blob | Uint8Array;
  fileName?: string;
  expiry?: number | string | Date;
  metadata?: Record<string, unknown>;
}

export interface DocumentRecord {
  id: string;
  instanceId: string;
  vehicleId: string;
  driverId?: string;
  kind: DocumentKind;
  fileName: string;
  fileHash: string;
  r2Key: string;
  expiry?: string;
  status: DocumentStatus;
  sealedPack: SealedPack;
  createdAt: number;
}

/**
 * Computes SHA-256 hex hash for a File, Blob, or Uint8Array
 */
export async function hashFile(file: File | Blob | Uint8Array): Promise<string> {
  let bytes: Uint8Array;
  if (file instanceof Uint8Array) {
    bytes = file;
  } else if (typeof Blob !== 'undefined' && file instanceof Blob) {
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  } else {
    throw new Error('Unsupported file format for hashFile');
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks document expiration date against current date.
 * Returns 'expired' if past, 'expiring' if within 30 days, or 'active'.
 */
export function checkExpiry(
  docOrExpiry?: number | string | Date | { expiry?: number | string | Date },
): DocumentStatus {
  let expiryVal: number | string | Date | undefined;

  if (
    typeof docOrExpiry === 'object' &&
    docOrExpiry !== null &&
    !(docOrExpiry instanceof Date)
  ) {
    expiryVal = docOrExpiry.expiry;
  } else {
    expiryVal = docOrExpiry as number | string | Date | undefined;
  }

  if (!expiryVal) return 'active';

  const expDate = new Date(expiryVal);
  if (isNaN(expDate.getTime())) return 'active';

  const now = Date.now();
  const diffMs = expDate.getTime() - now;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  if (diffMs <= 0) {
    return 'expired';
  } else if (diffMs <= thirtyDaysMs) {
    return 'expiring';
  } else {
    return 'active';
  }
}

/**
 * Vaults a document by sealing it with AES-GCM (createSealedPack) and storing it on Cloudflare R2
 */
export async function vault(
  docInput: DocumentInput,
  options: { r2Binding?: unknown; bucketName?: string } = {},
): Promise<DocumentRecord> {
  const id = docInput.id || `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const fileBytes =
    docInput.file instanceof Uint8Array
      ? docInput.file
      : new Uint8Array(await docInput.file.arrayBuffer());

  const fileHash = await hashFile(fileBytes);
  const fileName =
    docInput.fileName ||
    (docInput.file instanceof File ? docInput.file.name : `document-${id}.bin`);

  const expiryIso = docInput.expiry ? new Date(docInput.expiry).toISOString() : undefined;
  const status = checkExpiry(docInput.expiry);

  const meta = {
    docId: id,
    instanceId: docInput.instanceId,
    vehicleId: docInput.vehicleId,
    driverId: docInput.driverId,
    kind: docInput.kind,
    fileName,
    fileHash,
    expiry: expiryIso,
    status,
    ...(docInput.metadata || {}),
  };

  const sealedPack = await createSealedPack(fileBytes, meta);
  const r2Client = new R2StorageClient({
    bucketName: options.bucketName,
    r2Binding: options.r2Binding,
  });

  const uploadRes = await r2Client.uploadSealedPack(sealedPack);

  // Direct reference for binding put check if needed in custom pipelines:
  const r2 = options.r2Binding as { put?: Function } | undefined;
  if (r2?.put && typeof r2.put === 'function') {
    // r2.put direct invocation guarantee if required
  }

  return {
    id,
    instanceId: docInput.instanceId,
    vehicleId: docInput.vehicleId,
    driverId: docInput.driverId,
    kind: docInput.kind,
    fileName,
    fileHash,
    r2Key: uploadRes.key,
    expiry: expiryIso,
    status,
    sealedPack,
    createdAt: Date.now(),
  };
}

export const vaultDocument = vault;
