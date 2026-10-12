import { describe, it, expect } from 'vitest';
import { hashFile, checkExpiry, vaultDocument } from '../document.js';

describe('Document Vault Library', () => {
  it('should compute valid SHA-256 hex string for Uint8Array file content', async () => {
    const payload = new TextEncoder().encode('SWAL Document Test Payload 2025');
    const hash = await hashFile(payload);

    expect(hash).toBeTypeOf('string');
    expect(hash.length).toBe(64);
    // Known SHA-256 verification or consistency
    const secondHash = await hashFile(payload);
    expect(hash).toBe(secondHash);
  });

  it('should evaluate document expiry status correctly (active, expiring, expired)', () => {
    const now = Date.now();
    const pastDate = new Date(now - 86400 * 1000); // 1 day ago
    const soonDate = new Date(now + 15 * 86400 * 1000); // 15 days from now
    const farDate = new Date(now + 60 * 86400 * 1000); // 60 days from now

    expect(checkExpiry(pastDate)).toBe('expired');
    expect(checkExpiry(soonDate)).toBe('expiring');
    expect(checkExpiry(farDate)).toBe('active');
    expect(checkExpiry(undefined)).toBe('active');
  });

  it('should seal, encrypt with AES-GCM and vault document returning DocumentRecord and R2 key', async () => {
    const mockR2PutCalls: { key: string; val: string }[] = [];
    const mockR2Binding = {
      put: async (key: string, val: string) => {
        mockR2PutCalls.push({ key, val });
        return {};
      },
    };

    const docInput = {
      instanceId: 'inst-test-99',
      vehicleId: 'VH-999',
      driverId: 'DRV-123',
      kind: 'insurance' as const,
      file: new TextEncoder().encode('Confidential Vehicle Insurance Contract Content'),
      fileName: 'insurance-2025.pdf',
      expiry: new Date('2026-12-31'),
    };

    const docRecord = await vaultDocument(docInput, { r2Binding: mockR2Binding });

    expect(docRecord.id).toBeDefined();
    expect(docRecord.instanceId).toBe('inst-test-99');
    expect(docRecord.vehicleId).toBe('VH-999');
    expect(docRecord.kind).toBe('insurance');
    expect(docRecord.fileHash.length).toBe(64);
    expect(docRecord.r2Key).toContain(`packs/${docRecord.sealedPack.content_hash}.json`);
    expect(docRecord.sealedPack.ciphertext).toBeDefined();
    expect(docRecord.sealedPack.iv).toBeDefined();
    expect(docRecord.sealedPack.shares.length).toBe(3);

    expect(mockR2PutCalls.length).toBe(1);
    expect(mockR2PutCalls[0].key).toBe(docRecord.r2Key);
  });
});
