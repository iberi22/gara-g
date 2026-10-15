// vaultRecoveryKit.ts — kit de recuperacion del vault: cifra los shares de recuperacion (x=2)
// con un codigo de respaldo para poder restaurarlos en otro dispositivo. Cripto pura: sin red ni IndexedDB.
import { parseBackupCode, b64urlEncode, b64urlDecode } from './e2ee/crypto';

export { generateBackupCode as generateRecoveryKitCode } from './e2ee/crypto';

export type RecoveryKitErrorCode = 'bad-format' | 'app-mismatch' | 'instance-mismatch' | 'bad-code' | 'decrypt-failed' | 'empty';

export class RecoveryKitError extends Error {
  code: RecoveryKitErrorCode;
  constructor(code: RecoveryKitErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RecoveryKitError';
    this.code = code;
  }
}

export interface RecoveryKitEntry {
  entity: string;
  id: string;
  share: unknown;
}

export interface RecoveryKitV1 {
  format: 'swal-vault-recovery-kit';
  v: 1;
  appId: string;
  instanceId: string;
  createdAt: string;
  salt: string;
  iv: string;
  ct: string;
}

const INFO = new TextEncoder().encode('swal-vault-kit/v1/enc');

function aad(appId: string, instanceId: string, createdAt: string, salt: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`swal-vault-kit/v1|${appId}|${instanceId}|${createdAt}|${salt}`) as Uint8Array<ArrayBuffer>;
}

async function parseCode(kitCode: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return (await parseBackupCode(kitCode)).secret;
  } catch {
    throw new RecoveryKitError('bad-code');
  }
}

async function deriveKey(secret: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealRecoveryKit(
  appId: string,
  instanceId: string,
  entries: RecoveryKitEntry[],
  kitCode: string,
): Promise<RecoveryKitV1> {
  if (!entries || entries.length === 0) throw new RecoveryKitError('empty');
  const secret = await parseCode(kitCode);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const salt = b64urlEncode(saltBytes);
  const createdAt = new Date().toISOString();
  const key = await deriveKey(secret, saltBytes);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ appId, instanceId, entries: entries.map((e) => ({ entity: e.entity, id: e.id, share: e.share })) }),
  );
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: aad(appId, instanceId, createdAt, salt), tagLength: 128 },
    key,
    plaintext,
  );
  return {
    format: 'swal-vault-recovery-kit',
    v: 1,
    appId,
    instanceId,
    createdAt,
    salt,
    iv: b64urlEncode(ivBytes),
    ct: b64urlEncode(new Uint8Array(ct)),
  };
}

// Forma aceptada del valor de un share: base64 de 32 bytes, la longitud de una share real.
// Solo base64 que decodifica a 32 bytes, la longitud de una share real.
function validShareValue(v: unknown): boolean {
  if (typeof v !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(v)) return false;
  return atob(v).length === 32;
}

export async function openRecoveryKit(
  kit: unknown,
  kitCode: string,
  expected: { appId: string; instanceId: string },
): Promise<RecoveryKitEntry[]> {
  const k = kit as Partial<RecoveryKitV1> | null;
  if (
    !k ||
    typeof k !== 'object' ||
    k.format !== 'swal-vault-recovery-kit' ||
    k.v !== 1 ||
    typeof k.appId !== 'string' ||
    typeof k.instanceId !== 'string' ||
    typeof k.createdAt !== 'string' ||
    typeof k.salt !== 'string' ||
    typeof k.iv !== 'string' ||
    typeof k.ct !== 'string'
  ) {
    throw new RecoveryKitError('bad-format');
  }
  if (k.appId !== expected.appId) throw new RecoveryKitError('app-mismatch');
  if (k.instanceId !== expected.instanceId) throw new RecoveryKitError('instance-mismatch');
  const secret = await parseCode(kitCode);

  let plain: ArrayBuffer;
  try {
    const saltBytes = b64urlDecode(k.salt);
    const key = await deriveKey(secret, saltBytes);
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(k.iv), additionalData: aad(k.appId, k.instanceId, k.createdAt, k.salt), tagLength: 128 },
      key,
      b64urlDecode(k.ct),
    );
  } catch {
    throw new RecoveryKitError('decrypt-failed');
  }

  let inner: any;
  try {
    inner = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new RecoveryKitError('bad-format');
  }
  if (
    !inner ||
    inner.appId !== expected.appId ||
    inner.instanceId !== expected.instanceId ||
    !Array.isArray(inner.entries) ||
    inner.entries.some((e: any) => !e || typeof e.entity !== 'string' || typeof e.id !== 'string' || !e.share || typeof e.share !== 'object' || !Number.isInteger(e.share.index) || e.share.index !== 2 || !validShareValue(e.share.value))
  ) {
    throw new RecoveryKitError('bad-format');
  }
  return inner.entries.map((e: any) => ({ entity: e.entity, id: e.id, share: e.share }));
}

export function serializeRecoveryKit(kit: RecoveryKitV1): string {
  return JSON.stringify(kit);
}
