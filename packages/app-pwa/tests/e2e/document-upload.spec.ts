import { test, expect } from './fixtures';
import { vault, hashFile, checkExpiry } from '../../src/lib/document.js';
import { R2StorageClient } from '../../src/lib/r2Client.js';
import { verifySealedPackHash } from '../../src/lib/sealedPack.js';

test.describe('Document Vault Upload with R2 Mocking E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local/production PWA root
    await page.goto('/');
  });

  test('should verify PWA page load and title', async ({ page }) => {
    // El fixture inyecta la sesión admin, así que '/' entra en la app: el título es el del
    // panel de flota. El patrón anterior enumeraba títulos de la landing/DePIN ya retirados.
    await expect(page).toHaveTitle(/GARA-G|Gara-G|Panel de flota/i);
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should compute SHA-256 hash, seal document with AES-GCM and store in R2 mock', async () => {
    const mockR2Storage = new Map<string, string>();
    const mockR2Binding = {
      put: async (key: string, val: string) => {
        mockR2Storage.set(key, val);
        return {};
      },
      get: async (key: string) => {
        const data = mockR2Storage.get(key);
        if (!data) return null;
        return { text: async () => data };
      },
    };

    const fileContent = new TextEncoder().encode('SWAL DePIN Vehicle Inspection Report 2025');
    const expectedHash = await hashFile(fileContent);

    const docRecord = await vault(
      {
        instanceId: 'inst-e2e-vault',
        vehicleId: 'VH-E2E-777',
        driverId: 'DRV-E2E-888',
        kind: 'inspection',
        file: fileContent,
        fileName: 'inspection-e2e.pdf',
        expiry: '2026-11-30',
      },
      { r2Binding: mockR2Binding }
    );

    expect(docRecord.id).toMatch(/^doc-/);
    expect(docRecord.vehicleId).toBe('VH-E2E-777');
    expect(docRecord.driverId).toBe('DRV-E2E-888');
    expect(docRecord.kind).toBe('inspection');
    expect(docRecord.fileHash).toBe(expectedHash);
    expect(docRecord.status).toBe(checkExpiry('2026-11-30'));

    // Verify R2 mock storage contains encrypted SealedPack
    expect(mockR2Storage.has(docRecord.r2Key)).toBe(true);
    const storedJson = mockR2Storage.get(docRecord.r2Key)!;
    const storedPack = JSON.parse(storedJson);

    expect(storedPack.content_hash).toBe(docRecord.sealedPack.content_hash);
    expect(storedPack.ciphertext).toBeDefined();

    // Verify cryptographic integrity
    const isValid = await verifySealedPackHash(storedPack);
    expect(isValid).toBe(true);
  });

  test('should retrieve and verify SealedPack integrity from R2StorageClient', async () => {
    const r2Client = new R2StorageClient({ bucketName: 'swal-r2-docs-e2e' });

    const docRecord = await vault({
      instanceId: 'inst-e2e-vault',
      vehicleId: 'VH-E2E-999',
      kind: 'insurance',
      file: new TextEncoder().encode('Insurance Policy Contract Payload'),
    });

    // Upload sealedPack to r2Client instance
    await r2Client.uploadSealedPack(docRecord.sealedPack);

    // Get from memory/r2 store
    const retrievedPack = await r2Client.getSealedPack(docRecord.sealedPack.content_hash);
    expect(retrievedPack).not.toBeNull();
    expect(retrievedPack?.id).toBe(docRecord.sealedPack.id);

    const isIntegrityValid = await r2Client.verifyR2PackIntegrity(docRecord.sealedPack.content_hash);
    expect(isIntegrityValid).toBe(true);
  });
});
