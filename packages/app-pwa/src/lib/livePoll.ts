/**
 * livePoll.ts — Pure helper functions & poller manager for live telemetry tracking.
 */

export interface RawTelemetry {
  id?: string;
  vin: string;
  speed?: number;
  rpm?: number;
  coolantTemp?: number;
  fuelLevel?: number;
  latitude?: number;
  longitude?: number;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface RawVehicle {
  vin: string;
  plate?: string;
  [key: string]: unknown;
}

export interface TelemetryLiveRow {
  id: string;
  vin: string;
  plate: string;
  speed: number;
  rpm: number;
  coolantTemp: number;
  fuelLevel: number;
  latitude: number;
  longitude: number;
  timestamp: number;
  formattedSpeed: string;
  formattedRpm: string;
  formattedTemp: string;
  formattedFuel: string;
  formattedLat: string;
  formattedLng: string;
  lastUpdate: string;
}

/**
 * Filter telemetry records to get the latest record per VIN and format for UI map/table.
 */
export function getLatestTelemetryByVin(
  telemetry: RawTelemetry[],
  vehicles: RawVehicle[],
  filterVin?: string | null
): TelemetryLiveRow[] {
  const latestByVin = new Map<string, RawTelemetry>();

  for (const item of telemetry) {
    if (!item.vin) continue;
    if (filterVin && item.vin.toLowerCase() !== filterVin.toLowerCase()) continue;

    const ts = typeof item.timestamp === 'string' ? new Date(item.timestamp).getTime() : Number(item.timestamp || 0);
    const existing = latestByVin.get(item.vin);
    if (!existing) {
      latestByVin.set(item.vin, item);
    } else {
      const existingTs = typeof existing.timestamp === 'string' ? new Date(existing.timestamp).getTime() : Number(existing.timestamp || 0);
      if (ts > existingTs) {
        latestByVin.set(item.vin, item);
      }
    }
  }

  const vehicleMap = new Map(vehicles.map((v) => [v.vin, v]));

  return Array.from(latestByVin.values()).map((t) => {
    const veh = vehicleMap.get(t.vin);
    const ts = typeof t.timestamp === 'string' ? new Date(t.timestamp).getTime() : Number(t.timestamp || Date.now());
    const speed = Number(t.speed || 0);
    const rpm = Number(t.rpm || 0);
    const coolantTemp = Number(t.coolantTemp || 0);
    const fuelLevel = Number(t.fuelLevel || 0);
    const lat = Number(t.latitude || 0);
    const lng = Number(t.longitude || 0);

    return {
      id: t.id || `telemetry-${t.vin}-${ts}`,
      vin: t.vin,
      plate: veh?.plate || '—',
      speed,
      rpm,
      coolantTemp,
      fuelLevel,
      latitude: lat,
      longitude: lng,
      timestamp: ts,
      formattedSpeed: `${speed} km/h`,
      formattedRpm: rpm.toLocaleString('es-CO'),
      formattedTemp: `${coolantTemp}°C`,
      formattedFuel: `${fuelLevel}%`,
      formattedLat: lat.toFixed(4),
      formattedLng: lng.toFixed(4),
      lastUpdate: new Date(ts).toISOString(),
    };
  });
}

export interface LivePollerOptions {
  fetchUrl: string | (() => string);
  intervalMs?: number; // default 5000
  onUpdate: (rows: TelemetryLiveRow[]) => void;
  onError?: (err: Error) => void;
}

export interface LivePoller {
  start: () => void;
  stop: () => void;
  pollNow: () => Promise<void>;
  isPaused: () => boolean;
}

/**
 * Creates a poller that fetches telemetry every intervalMs (5s default)
 * and automatically pauses when document is hidden (visibilitychange).
 */
export function createLivePoller(options: LivePollerOptions): LivePoller {
  const { fetchUrl, intervalMs = 5000, onUpdate, onError } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let pausedByVisibility = false;

  async function pollNow() {
    if (typeof document !== 'undefined' && document.hidden) {
      pausedByVisibility = true;
      return;
    }
    pausedByVisibility = false;

    try {
      const url = typeof fetchUrl === 'function' ? fetchUrl() : fetchUrl;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching live telemetry`);
      }
      const json = await res.json();
      const rows: TelemetryLiveRow[] = json.data || [];
      onUpdate(rows);
    } catch (err: any) {
      if (onError) onError(err);
    }
  }

  function handleVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      pausedByVisibility = true;
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      pollNow();
    }
  }

  function start() {
    stop();
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    pollNow();
    intervalId = setInterval(pollNow, intervalMs);
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }

  function isPaused() {
    if (typeof document !== 'undefined' && document.hidden) return true;
    return pausedByVisibility;
  }

  return {
    start,
    stop,
    pollNow,
    isPaused,
  };
}
