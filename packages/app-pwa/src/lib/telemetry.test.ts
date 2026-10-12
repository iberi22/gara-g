import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { TelemetryIngestManager, type OBD2TelemetryRecord } from './telemetry.js';

describe('TelemetryIngestManager - odometer extension (WAVE-11.03)', () => {
  let doc: Y.Doc;
  let manager: TelemetryIngestManager;

  beforeEach(() => {
    doc = new Y.Doc();
    manager = new TelemetryIngestManager(doc);
  });

  it('ingestOBD2Data accepts record with odometer field and persists it', () => {
    const record: OBD2TelemetryRecord = {
      vin: 'VIN-ODO-001',
      timestamp: 1700000000000,
      speed: 85,
      rpm: 2500,
      coolantTemp: 92,
      fuelLevel: 75,
      latitude: 4.6097,
      longitude: -74.0817,
      troubleCodes: [],
      odometer: 125400,
    };

    const ingested = manager.ingestOBD2Data(record);
    expect(ingested.odometer).toBe(125400);

    const latest = manager.getLatestRecord();
    expect(latest?.odometer).toBe(125400);
    expect(latest?.vin).toBe('VIN-ODO-001');
  });

  it('exportTelemetryPayload includes odometer in JSON output', () => {
    manager.ingestOBD2Data({
      vin: 'VIN-EXPORT-002',
      timestamp: Date.now(),
      speed: 60,
      rpm: 2000,
      coolantTemp: 88,
      fuelLevel: 90,
      latitude: 6.2442,
      longitude: -75.5812,
      troubleCodes: ['P0420'],
      odometer: 98450,
    });

    const payloadBytes = manager.exportTelemetryPayload();
    const payloadJson = JSON.parse(new TextDecoder().decode(payloadBytes));

    expect(payloadJson.recordCount).toBe(1);
    expect(payloadJson.records[0].odometer).toBe(98450);
    expect(payloadJson.records[0].troubleCodes).toEqual(['P0420']);
  });

  it('ingestOBD2Data backfills odometer=0 for legacy records lacking the field', () => {
    const legacyRecord = {
      vin: 'VIN-LEGACY-003',
      timestamp: Date.now(),
      speed: 45,
      rpm: 1800,
      coolantTemp: 85,
      fuelLevel: 50,
      latitude: 3.4516,
      longitude: -76.532,
    } as OBD2TelemetryRecord;

    const ingested = manager.ingestOBD2Data(legacyRecord);
    expect(ingested.odometer).toBe(0);

    const allRecords = manager.getAllRecords();
    expect(allRecords[0].odometer).toBe(0);
  });
});
