import type { DomainRecord } from '../domain';

export class LockedError extends Error {
  constructor(message = 'Base de datos bloqueada') {
    super(message);
    this.name = 'LockedError';
  }
}

export class TransitionInProgressError extends Error {
  constructor(message = 'Transición en progreso') {
    super(message);
    this.name = 'TransitionInProgressError';
  }
}

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function encryptRecord(entity: string, id: string, record: DomainRecord, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = enc.encode(`gara-local|${entity}|${id}`);
  const plaintext = enc.encode(JSON.stringify(record));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext
  );

  return `v1.${bufferToBase64(iv)}.${bufferToBase64(ciphertext as ArrayBuffer)}`;
}

export async function decryptRecord(entity: string, id: string, encrypted: string, key: CryptoKey): Promise<DomainRecord> {
  const parts = encrypted.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Formato de cifrado inválido');
  }

  const iv = base64ToBuffer(parts[1]);
  const ciphertext = base64ToBuffer(parts[2]);
  const aad = enc.encode(`gara-local|${entity}|${id}`);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      key,
      ciphertext
    );
    return JSON.parse(dec.decode(plaintext));
  } catch (err) {
    throw new Error('Fallo al descifrar (AAD incorrecto o dañado)');
  }
}
