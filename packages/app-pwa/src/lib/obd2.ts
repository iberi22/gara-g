import type { TelemetryIngestManager, OBD2TelemetryRecord } from './telemetry.js';

export type OBD2ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'unsupported' | 'error';

export interface ParsedOBD2Data {
  speed?: number;
  rpm?: number;
  coolantTemp?: number;
  fuelLevel?: number;
  vin?: string;
  rawResponse?: string;
}

export interface OBD2SimulatorOptions {
  vin?: string;
  intervalMs?: number;
  ingestManager?: TelemetryIngestManager;
  onRecord?: (record: OBD2TelemetryRecord) => void;
}

/**
 * Safe detection of Web Bluetooth support without throwing.
 */
export function isBluetoothSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'bluetooth' in navigator && Boolean(navigator.bluetooth);
}

/**
 * Parses raw ASCII ELM327 hex responses for standard OBD-II PIDs:
 * - PID 0D: Speed (km/h) -> A
 * - PID 0C: Engine RPM -> (A*256 + B) / 4
 * - PID 05: Engine Coolant Temperature (°C) -> A - 40
 * - PID 2F: Fuel Level Input (%) -> (A * 100) / 255
 */
export function parseELM327Response(raw: string): ParsedOBD2Data {
  const result: ParsedOBD2Data = { rawResponse: raw };
  if (!raw || typeof raw !== 'string') return result;

  // Clean raw string: strip prompts (>), whitespace, line breaks
  const cleaned = raw.replace(/[>\r\n]/g, ' ').trim().toUpperCase();
  if (!cleaned || cleaned.includes('NO DATA') || cleaned.includes('UNABLE TO CONNECT') || cleaned.includes('ERROR')) {
    return result;
  }

  // Extract hex tokens
  const hexTokens = cleaned.split(/\s+/).filter(t => /^[0-9A-F]{2}$/.test(t));
  const hexString = hexTokens.join('');

  // Look for PID response headers e.g. 41 0D, 41 0C, 41 05, 41 2F
  // 1. Speed PID 0D (Header: 410D xx)
  const speedMatch = cleaned.match(/(?:41\s*0D|410D)\s*([0-9A-F]{2})/i);
  if (speedMatch) {
    result.speed = parseInt(speedMatch[1], 16);
  } else if (hexTokens.length === 3 && hexTokens[0] === '41' && hexTokens[1] === '0D') {
    result.speed = parseInt(hexTokens[2], 16);
  }

  // 2. RPM PID 0C (Header: 410C xx xx)
  const rpmMatch = cleaned.match(/(?:41\s*0C|410C)\s*([0-9A-F]{2})\s*([0-9A-F]{2})/i);
  if (rpmMatch) {
    const a = parseInt(rpmMatch[1], 16);
    const b = parseInt(rpmMatch[2], 16);
    result.rpm = Math.floor((a * 256 + b) / 4);
  } else if (hexTokens.length === 4 && hexTokens[0] === '41' && hexTokens[1] === '0C') {
    const a = parseInt(hexTokens[2], 16);
    const b = parseInt(hexTokens[3], 16);
    result.rpm = Math.floor((a * 256 + b) / 4);
  }

  // 3. Coolant Temp PID 05 (Header: 4105 xx)
  const tempMatch = cleaned.match(/(?:41\s*05|4105)\s*([0-9A-F]{2})/i);
  if (tempMatch) {
    result.coolantTemp = parseInt(tempMatch[1], 16) - 40;
  } else if (hexTokens.length === 3 && hexTokens[0] === '41' && hexTokens[1] === '05') {
    result.coolantTemp = parseInt(hexTokens[2], 16) - 40;
  }

  // 4. Fuel Level PID 2F (Header: 412F xx)
  const fuelMatch = cleaned.match(/(?:41\s*2F|412F)\s*([0-9A-F]{2})/i);
  if (fuelMatch) {
    result.fuelLevel = Math.round((parseInt(fuelMatch[1], 16) * 100) / 255);
  } else if (hexTokens.length === 3 && hexTokens[0] === '41' && hexTokens[1] === '2F') {
    result.fuelLevel = Math.round((parseInt(hexTokens[2], 16) * 100) / 255);
  }

  return result;
}

/**
 * ELM327 Web Bluetooth GATT UART Adapter.
 */
export class ELM327Adapter {
  private status: OBD2ConnectionStatus = 'disconnected';
  private device: any = null;
  private gattServer: any = null;
  private rxCharacteristic: any = null;
  private ingestManager?: TelemetryIngestManager;
  private listeners: Array<(record: OBD2TelemetryRecord) => void> = [];
  private vin: string;

  constructor(vin = 'VIN-ELM327-01', ingestManager?: TelemetryIngestManager) {
    this.vin = vin;
    this.ingestManager = ingestManager;
  }

  public getStatus(): OBD2ConnectionStatus {
    if (!isBluetoothSupported()) {
      return 'unsupported';
    }
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === 'connected';
  }

  public onRecord(callback: (record: OBD2TelemetryRecord) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  public async connect(): Promise<boolean> {
    if (!isBluetoothSupported()) {
      this.status = 'unsupported';
      return false;
    }

    try {
      this.status = 'connecting';
      // Standard BLE OBD2 Service UUIDs & UART characteristic UUIDs
      const serviceUUIDs = [
        '0000fff0-0000-1000-8000-00805f9b34fb',
        '0000ffe0-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      ];

      this.device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { namePrefix: 'OBD' },
          { namePrefix: 'ELM' },
          { namePrefix: 'V-LINK' },
        ],
        optionalServices: serviceUUIDs,
      });

      if (!this.device || !this.device.gatt) {
        this.status = 'error';
        return false;
      }

      this.gattServer = await this.device.gatt.connect();
      this.status = 'connected';

      // Attach disconnect handler
      this.device.addEventListener('gattserverdisconnected', () => {
        this.status = 'disconnected';
      });

      return true;
    } catch (err) {
      console.warn('[ELM327] Connection error or cancelled:', err);
      this.status = 'error';
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.gattServer && this.gattServer.connected) {
      this.gattServer.disconnect();
    }
    this.status = 'disconnected';
    this.device = null;
    this.gattServer = null;
  }

  public processRawData(rawData: string): OBD2TelemetryRecord {
    const parsed = parseELM327Response(rawData);
    const record: OBD2TelemetryRecord = {
      vin: this.vin,
      timestamp: Date.now(),
      speed: parsed.speed ?? 0,
      rpm: parsed.rpm ?? 0,
      coolantTemp: parsed.coolantTemp ?? 90,
      fuelLevel: parsed.fuelLevel ?? 100,
      latitude: 4.6097,
      longitude: -74.0817,
      troubleCodes: [],
      odometer: 120000,
    };

    if (this.ingestManager) {
      this.ingestManager.ingestOBD2Data(record);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ingest-obd2-record', { detail: record }));
    }

    this.listeners.forEach(cb => cb(record));
    return record;
  }
}

/**
 * OBD2 Synthetic Telemetry Simulator.
 */
export class OBD2Simulator {
  private running = false;
  private intervalId: any = null;
  private vin: string;
  private intervalMs: number;
  private ingestManager?: TelemetryIngestManager;
  private onRecordCb?: (record: OBD2TelemetryRecord) => void;
  private currentSpeed = 60;
  private currentRpm = 2200;
  private currentTemp = 88;
  private currentFuel = 75;
  private odometer = 105000;

  constructor(options: OBD2SimulatorOptions = {}) {
    this.vin = options.vin || 'SIM-OBD2-8888';
    this.intervalMs = options.intervalMs || 2000;
    this.ingestManager = options.ingestManager;
    this.onRecordCb = options.onRecord;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public generateRecord(): OBD2TelemetryRecord {
    // Slight random drift for realistic simulation
    this.currentSpeed = Math.max(0, Math.min(160, this.currentSpeed + Math.floor(Math.random() * 9) - 4));
    this.currentRpm = Math.max(800, Math.min(6000, this.currentRpm + Math.floor(Math.random() * 201) - 100));
    this.currentTemp = Math.max(70, Math.min(110, this.currentTemp + Math.floor(Math.random() * 3) - 1));
    this.currentFuel = Math.max(5, Math.min(100, this.currentFuel - (Math.random() > 0.8 ? 1 : 0)));
    this.odometer += Math.round(this.currentSpeed / 3600);

    const record: OBD2TelemetryRecord = {
      vin: this.vin,
      timestamp: Date.now(),
      speed: this.currentSpeed,
      rpm: this.currentRpm,
      coolantTemp: this.currentTemp,
      fuelLevel: this.currentFuel,
      latitude: 4.6097 + (Math.random() - 0.5) * 0.01,
      longitude: -74.0817 + (Math.random() - 0.5) * 0.01,
      troubleCodes: Math.random() > 0.9 ? ['P0300'] : [],
      odometer: this.odometer,
    };

    if (this.ingestManager) {
      this.ingestManager.ingestOBD2Data(record);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ingest-obd2-record', { detail: record }));
    }

    if (this.onRecordCb) {
      this.onRecordCb(record);
    }

    return record;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    // Emit initial record immediately
    this.generateRecord();
    this.intervalId = setInterval(() => {
      this.generateRecord();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }
}
