import { describe, expect, it, beforeAll } from 'vitest';
import { encryptRecord, decryptRecord } from './recordCrypto';
import type { DomainRecord } from '../domain';

// Polyfill webcrypto for Vitest environment if missing
if (typeof crypto === 'undefined' || !crypto.subtle) {
  const nodeCrypto = await import('node:crypto');
  // @ts-ignore
  globalThis.crypto = nodeCrypto.webcrypto;
}

const mockRecord: DomainRecord = {
  id: 'rec1',
  instance_id: 'test_instance',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  name: 'test record'
};

async function generateTestKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

describe('recordCrypto', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await generateTestKey();
  });

  it('cifra y descifra correctamente', async () => {
    const enc = await encryptRecord('vehicle', 'rec1', mockRecord, key);
    expect(enc.startsWith('v1.')).toBe(true);

    const dec = await decryptRecord('vehicle', 'rec1', enc, key);
    expect(dec).toEqual(mockRecord);
  });

  it('falla con AAD mismatch (entidad distinta)', async () => {
    const enc = await encryptRecord('vehicle', 'rec1', mockRecord, key);

    await expect(decryptRecord('maintenance', 'rec1', enc, key)).rejects.toThrow('Fallo al descifrar');
  });

  it('falla con AAD mismatch (id distinto)', async () => {
    const enc = await encryptRecord('vehicle', 'rec1', mockRecord, key);

    await expect(decryptRecord('vehicle', 'rec2', enc, key)).rejects.toThrow('Fallo al descifrar');
  });

  it('falla si el ciphertext está alterado', async () => {
    const enc = await encryptRecord('vehicle', 'rec1', mockRecord, key);
    const parts = enc.split('.');

    const bin = atob(parts[2]);
    let modBin = '';
    for(let i=0; i<bin.length; i++) {
        if(i === 0) modBin += String.fromCharCode(bin.charCodeAt(0) ^ 1);
        else modBin += bin[i];
    }

    const tampered = `v1.${parts[1]}.${btoa(modBin)}`;
    await expect(decryptRecord('vehicle', 'rec1', tampered, key)).rejects.toThrow('Fallo al descifrar');
  });

  it('falla con formato inválido', async () => {
      await expect(decryptRecord('vehicle', 'rec1', 'v2.abc.def', key)).rejects.toThrow('Formato de cifrado inválido');
  });
});
