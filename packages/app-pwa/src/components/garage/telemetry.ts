/**
 * telemetry.ts — Gestor del flujo de telemetría en tiempo real y sondeo de estado.
 *
 * Realiza polling de /api/garage/telemetry/:vin cada 5 s solo mientras la pestaña esté visible,
 * y escucha el evento 'gara:telemetry' emitido por el puente nativo en WebView.
 */
import { ONLINE_WINDOW_S, type MonitoringState, type TelemetrySample } from '../../garage/contracts';
import { garageApi } from './api';

export type TelemetryListener = (state: MonitoringState) => void;

export class TelemetryManager {
  private currentVin: string | null = null;
  private pollIntervalId: number | null = null;
  private listeners = new Set<TelemetryListener>();
  private state: MonitoringState | null = null;
  private isListeningEvents = false;

  constructor() {
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleBridgeEvent = this.handleBridgeEvent.bind(this);
  }

  /**
   * Vincula el gestor a un VIN de vehículo específico e inicia el monitoreo.
   */
  start(vin: string): void {
    if (this.currentVin === vin && this.pollIntervalId !== null) return;
    this.stop();
    this.currentVin = vin;

    // Configurar estado inicial
    this.state = {
      vin,
      connected: false,
      series: [],
    };

    if (typeof window !== 'undefined') {
      if (!this.isListeningEvents) {
        window.addEventListener('gara:telemetry', this.handleBridgeEvent as EventListener);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        this.isListeningEvents = true;
      }
      this.pollOnce();
      this.restartPolling();
    }
  }

  /**
   * Detiene el monitoreo del vehículo actual.
   */
  stop(): void {
    if (this.pollIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.currentVin = null;
  }

  /**
   * Suscribe un callback a actualizaciones de estado de telemetría.
   */
  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    if (this.state) {
      listener(this.state);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Destruye todos los listeners y timers.
   */
  destroy(): void {
    this.stop();
    if (typeof window !== 'undefined' && this.isListeningEvents) {
      window.removeEventListener('gara:telemetry', this.handleBridgeEvent as EventListener);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.isListeningEvents = false;
    }
    this.listeners.clear();
  }

  /**
   * Procesa una muestra entrante (sea por polling o por el evento puente gara:telemetry).
   */
  ingestSample(sample: TelemetrySample): void {
    if (this.currentVin && sample.vin !== this.currentVin) return;

    const sampleDate = new Date(sample.ts);
    const now = Date.now();
    const diffSec = Math.max(0, (now - sampleDate.getTime()) / 1000);
    const isConnected = diffSec <= ONLINE_WINDOW_S;

    const series = this.state?.series ? [...this.state.series] : [];
    series.push(sample);
    if (series.length > 60) series.shift();

    this.state = {
      vin: sample.vin,
      connected: isConnected,
      lastSeen: sample.ts,
      latest: sample,
      series,
    };

    this.notify();
  }

  private handleBridgeEvent(event: CustomEvent<TelemetrySample>): void {
    if (event.detail && typeof event.detail === 'object') {
      this.ingestSample(event.detail);
    }
  }

  private handleVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      this.pollOnce();
      this.restartPolling();
    } else {
      if (this.pollIntervalId !== null && typeof window !== 'undefined') {
        window.clearInterval(this.pollIntervalId);
        this.pollIntervalId = null;
      }
    }
  }

  private restartPolling(): void {
    if (this.pollIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.pollIntervalId);
    }
    if (typeof window !== 'undefined') {
      this.pollIntervalId = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.pollOnce();
        }
      }, 5000);
    }
  }

  private pollOnce(): void {
    if (!this.currentVin) return;
    const vin = this.currentVin;
    void garageApi.getTelemetry(vin).then((res) => {
      if (this.currentVin === vin) {
        if (res.latest) {
          this.ingestSample(res.latest);
        } else {
          this.state = res;
          this.notify();
        }
      }
    });
  }

  private notify(): void {
    if (this.state) {
      for (const listener of this.listeners) {
        listener(this.state);
      }
    }
  }
}

export const telemetryManager = new TelemetryManager();
