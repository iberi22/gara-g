import { cloud } from '../cloud/index.js';
import type { AnchorResult } from '../cloud/types.js';
import * as Y from 'yjs';
import { R2StorageClient, type UploadResult } from './r2Client.js';
import { createSealedPack, type SealedPack } from './sealedPack.js';

export interface OBD2TelemetryRecord {
  vin: string;
  timestamp: number;
  speed: number;
  rpm: number;
  coolantTemp: number;
  fuelLevel: number;
  latitude: number;
  longitude: number;
  troubleCodes?: string[];
  odometer?: number;
}

export interface IngestAndSealResult {
  record: OBD2TelemetryRecord;
  sealedPack: SealedPack;
  uploadResult: UploadResult;
  polygonAnchorResult?: AnchorResult;
}

export class TelemetryIngestManager {
  private doc: Y.Doc;
  private streamArray: Y.Array<OBD2TelemetryRecord>;

  constructor(doc?: Y.Doc) {
    this.doc = doc || new Y.Doc();
    this.streamArray = this.doc.getArray<OBD2TelemetryRecord>('telemetry_stream');
  }

  public getDoc(): Y.Doc {
    return this.doc;
  }

  public ingestOBD2Data(record: OBD2TelemetryRecord): OBD2TelemetryRecord {
    if (!record.vin || typeof record.vin !== 'string') {
      throw new Error('Invalid OBD2 telemetry record: VIN is required');
    }
    if (typeof record.timestamp !== 'number' || record.timestamp <= 0) {
      record.timestamp = Date.now();
    }
    if (typeof record.speed !== 'number') {
      throw new Error('Invalid OBD2 telemetry record: speed is required');
    }

    const cleanRecord: OBD2TelemetryRecord = {
      vin: record.vin,
      timestamp: record.timestamp,
      speed: record.speed,
      rpm: record.rpm ?? 0,
      coolantTemp: record.coolantTemp ?? 90,
      fuelLevel: record.fuelLevel ?? 100,
      latitude: record.latitude ?? 0,
      longitude: record.longitude ?? 0,
      troubleCodes: Array.isArray(record.troubleCodes) ? [...record.troubleCodes] : [],
      odometer: record.odometer ?? 0,
    };

    this.streamArray.push([cleanRecord]);
    return cleanRecord;
  }

  public getLatestRecord(): OBD2TelemetryRecord | null {
    const len = this.streamArray.length;
    if (len === 0) return null;
    return this.streamArray.get(len - 1);
  }

  public getAllRecords(): OBD2TelemetryRecord[] {
    return this.streamArray.toArray();
  }

  public getRecordCount(): number {
    return this.streamArray.length;
  }

  public exportTelemetryPayload(): Uint8Array {
    const records = this.getAllRecords();
    const payloadJson = JSON.stringify({
      version: '1.0.0',
      recordCount: records.length,
      records,
      exportedAt: Date.now(),
    });
    return new TextEncoder().encode(payloadJson);
  }

  public async sealAndUploadPayload(
    metadata: Record<string, unknown> = {},
    r2Client: R2StorageClient = new R2StorageClient(),
    /** Bus del modulo cloud (econ). Sin modulo cloud no se ancla nada. */
    bus?: unknown,
  ): Promise<{
    sealedPack: SealedPack;
    uploadResult: UploadResult;
    polygonAnchorResult?: AnchorResult;
  }> {
    const payload = this.exportTelemetryPayload();
    const metaWithTelemetry = {
      ...metadata,
      recordCount: this.getRecordCount(),
      timestamp: Date.now(),
    };

    const sealedPack = await createSealedPack(payload, metaWithTelemetry);
    const uploadResult = await r2Client.uploadSealedPack(sealedPack);

    let polygonAnchorResult: AnchorResult | undefined;
    if (bus) {
      polygonAnchorResult = cloud.anchor.registerOnPolygon(sealedPack, bus);
    }

    return {
      sealedPack,
      uploadResult,
      polygonAnchorResult,
    };
  }

  public clearTelemetry(): void {
    if (this.streamArray.length > 0) {
      this.streamArray.delete(0, this.streamArray.length);
    }
  }
}
