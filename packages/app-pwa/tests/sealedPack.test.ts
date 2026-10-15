import { describe, it, expect } from 'vitest';
import { TelemetryIngestManager, OBD2TelemetryRecord } from '../src/lib/telemetry.js';
import {
  createSealedPack,
  unpackSealedPack,
  verifySealedPackHash,
  splitDEK,
  reconstructDEK,
} from '../src/lib/sealedPack.js';
import { R2StorageClient } from '../src/lib/r2Client.js';

describe('SWAL-GARA 03.03 Telemetry Ingest + Sealed Pack R2', () => {
  it('should ingest OBD2 records into Yjs doc and export binary payload', () => {
    const ingestManager = new TelemetryIngestManager();

    const record1: OBD2TelemetryRecord = {
      vin: '1HGCR2F83HA000001',
      timestamp: Date.now(),
      speed: 65.5,
      rpm: 2200,
      coolantTemp: 88,
      fuelLevel: 75.0,
      latitude: 37.7749,
      longitude: -122.4194,
      troubleCodes: [],
    };

    const record2: OBD2TelemetryRecord = {
      vin: '1HGCR2F83HA000001',
      timestamp: Date.now() + 1000,
      speed: 70.0,
      rpm: 2400,
      coolantTemp: 89,
      fuelLevel: 74.8,
      latitude: 37.7755,
      longitude: -122.4188,
      troubleCodes: ['P0300'],
    };

    ingestManager.ingestOBD2Data(record1);
    ingestManager.ingestOBD2Data(record2);

    expect(ingestManager.getRecordCount()).toBe(2);
    expect(ingestManager.getLatestRecord()?.speed).toBe(70.0);

    const exportedPayload = ingestManager.exportTelemetryPayload();
    expect(exportedPayload).toBeInstanceOf(Uint8Array);
    expect(exportedPayload.length).toBeGreaterThan(0);

    const parsedJson = JSON.parse(new TextDecoder().decode(exportedPayload));
    expect(parsedJson.recordCount).toBe(2);
    expect(parsedJson.records[1].troubleCodes).toContain('P0300');
  });

  it('should perform Shamir 2-of-3 DEK split and reconstruction from any 2 shares', () => {
    const dek = new Uint8Array(32);
    for (let i = 0; i < 32; i++) dek[i] = (i * 7 + 13) % 256;

    const shares = splitDEK(dek);
    expect(shares.length).toBe(3);
    expect(shares[0].index).toBe(1);
    expect(shares[1].index).toBe(2);
    expect(shares[2].index).toBe(3);

    // Reconstruct with shares (1, 2)
    const dek12 = reconstructDEK([shares[0], shares[1]]);
    expect(dek12).toEqual(dek);

    // Reconstruct with shares (2, 3)
    const dek23 = reconstructDEK([shares[1], shares[2]]);
    expect(dek23).toEqual(dek);

    // Reconstruct with shares (1, 3)
    const dek13 = reconstructDEK([shares[0], shares[2]]);
    expect(dek13).toEqual(dek);

    // Assert error on single share
    expect(() => reconstructDEK([shares[0]])).toThrow('At least 2 shares are required');
  });

  it('should create a sealed pack with AES-256-GCM, Ed25519 signature, and SHA-256 content_hash', async () => {
    const ingestManager = new TelemetryIngestManager();
    ingestManager.ingestOBD2Data({
      vin: '1HGCR2F83HA000002',
      timestamp: 1772410000000,
      speed: 82.0,
      rpm: 2800,
      coolantTemp: 92,
      fuelLevel: 60,
      latitude: 34.0522,
      longitude: -118.2437,
    });

    const payload = ingestManager.exportTelemetryPayload();
    const metadata = {
      vehicleId: 'veh-001',
      timestamp: Date.now(),
      recordCount: ingestManager.getRecordCount(),
      deviceId: 'obd2-adapter-99',
    };

    const sealedPack = await createSealedPack(payload, metadata);

    expect(sealedPack.id).toMatch(/^pack-/);
    expect(sealedPack.content_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(sealedPack.ciphertext.length).toBeGreaterThan(0);
    expect(sealedPack.shares.length).toBe(3);
    expect(sealedPack.chain).toBe('polygon');
    expect(sealedPack.chainId).toBe(137);

    // Verify content_hash integrity
    const isValidHash = await verifySealedPackHash(sealedPack);
    expect(isValidHash).toBe(true);

    // Test unpacking with 2 shares (1 and 3)
    const decryptedPayload = await unpackSealedPack(sealedPack, [
      sealedPack.shares[0],
      sealedPack.shares[2],
    ]);
    expect(decryptedPayload).toEqual(payload);
  });

  it('should detect tampered content hash in SealedPack', async () => {
    const payload = new TextEncoder().encode('sample telemetry data');
    const metadata = { vehicleId: 'veh-tamper', timestamp: Date.now(), recordCount: 1 };

    const pack = await createSealedPack(payload, metadata);

    // Tamper with ciphertext
    const tamperedPack = { ...pack, ciphertext: Buffer.from('corrupted').toString('base64') };
    const isValid = await verifySealedPackHash(tamperedPack);
    expect(isValid).toBe(false);
  });

  it('should upload to R2StorageClient and verify integrity', async () => {
    const payload = new TextEncoder().encode('R2 payload sample');
    const metadata = { vehicleId: 'veh-r2', timestamp: Date.now(), recordCount: 1 };
    const pack = await createSealedPack(payload, metadata);

    let putCalledWithPackStr: string | null = null;
    const r2Binding = {
      put: async (key: string, value: string, opts: any) => {
        putCalledWithPackStr = value;
      }
    };

    const r2Client = new R2StorageClient({ bucketName: 'swal-r2-vault', r2Binding });
    const uploadResult = await r2Client.uploadSealedPack(pack);

    expect(uploadResult.contentHash).toBe(pack.content_hash);
    expect(uploadResult.url).toContain('swal-r2-vault');

    expect(putCalledWithPackStr).not.toBeNull();
    const uploadedPack = JSON.parse(putCalledWithPackStr!);
    expect(uploadedPack.shares).toEqual([]);

    const retrievedPack = await r2Client.getSealedPack(pack.content_hash);
    expect(retrievedPack?.content_hash).toBe(pack.content_hash);

    const isIntegrityOk = await r2Client.verifyR2PackIntegrity(pack.content_hash);
    expect(isIntegrityOk).toBe(true);
  });

});
