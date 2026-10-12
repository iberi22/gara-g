import type { DomainRecord } from './domain';

export interface FuelLogData {
  vehicleId: string;
  driverId: string;
  date: string;
  km: number;
  gallons: number;
  cost: number;
  station: string;
  kmPerGallon: number;
}

export type FuelLogRecord = DomainRecord<FuelLogData>;

/**
 * Calculate kmPerGallon for a list of fuel logs.
 * kmPerGallon = (currentKm - previousKm) / gallons
 * If no previous log exists for the same vehicleId, returns 0.
 */
export function computeKmPerGallon(allLogs: FuelLogRecord[]): FuelLogRecord[] {
  // Group logs by vehicleId and sort ascending by date and km
  const byVehicle: Record<string, FuelLogRecord[]> = {};

  for (const log of allLogs) {
    const vId = log.vehicleId || 'unknown';
    if (!byVehicle[vId]) byVehicle[vId] = [];
    byVehicle[vId].push(log);
  }

  const calculatedMap = new Map<string, number>();

  for (const vId in byVehicle) {
    const vehicleLogs = [...byVehicle[vId]].sort((a, b) => {
      const dA = new Date(a.date).getTime();
      const dB = new Date(b.date).getTime();
      if (dA !== dB) return dA - dB;
      return (Number(a.km) || 0) - (Number(b.km) || 0);
    });

    for (let i = 0; i < vehicleLogs.length; i++) {
      const current = vehicleLogs[i];
      if (i === 0) {
        calculatedMap.set(current.id, 0);
      } else {
        const previous = vehicleLogs[i - 1];
        const diffKm = (Number(current.km) || 0) - (Number(previous.km) || 0);
        const gal = Number(current.gallons) || 0;
        if (gal > 0 && diffKm > 0) {
          const val = diffKm / gal;
          calculatedMap.set(current.id, Number.isFinite(val) ? Number(val.toFixed(2)) : 0);
        } else {
          calculatedMap.set(current.id, 0);
        }
      }
    }
  }

  return allLogs.map((log) => ({
    ...log,
    kmPerGallon: calculatedMap.get(log.id) ?? 0,
  }));
}

export interface FleetFuelEfficiency {
  /** Distancia recorrida entre la primera y la ultima carga, sumada por vehiculo (km). */
  km: number;
  /** Combustible consumido en ese tramo (galones). */
  gallons: number;
  /** km por galon de la flota; null cuando no hay al menos dos lecturas validas. */
  kmPerGallon: number | null;
}

/**
 * Eficiencia real de la flota (km/galon) por el metodo de tanque lleno.
 *
 * Por vehiculo: distancia = odometro maximo - odometro minimo del periodo; combustible =
 * suma de los galones de TODAS las cargas salvo la primera (la mas antigua). Ese primer
 * llenado repone lo gastado ANTES de la primera lectura, asi que el combustible del tramo
 * medido es el de las cargas posteriores. Flota = distancia total / combustible total.
 *
 * Un vehiculo con menos de dos lecturas de odometro, sin avance o sin galones en el tramo no
 * aporta (ni distancia ni combustible): no se inventa un cero. Sin ningun vehiculo valido
 * kmPerGallon es null y la interfaz muestra "—".
 * (Antes se dividia la SUMA de los odometros por el combustible, que no es una eficiencia.)
 */
export function fleetFuelEfficiency(
  logs: Array<{ vehicleId?: string; date?: string; km?: number; gallons?: number }>,
): FleetFuelEfficiency {
  const byVehicle = new Map<string, Array<{ t: number; km: number; gal: number }>>();
  for (const log of logs) {
    const km = Number(log.km);
    if (!Number.isFinite(km) || km <= 0) continue;
    const key = log.vehicleId || 'unknown';
    const t = new Date(log.date as string).getTime();
    const list = byVehicle.get(key) ?? [];
    list.push({ t: Number.isFinite(t) ? t : 0, km, gal: Math.max(0, Number(log.gallons) || 0) });
    byVehicle.set(key, list);
  }

  let km = 0;
  let gallons = 0;
  for (const list of byVehicle.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.t - b.t || a.km - b.km);
    const dist = Math.max(...list.map((r) => r.km)) - Math.min(...list.map((r) => r.km));
    const fuel = list.slice(1).reduce((acc, r) => acc + r.gal, 0);
    if (dist > 0 && fuel > 0) {
      km += dist;
      gallons += fuel;
    }
  }
  return { km, gallons, kmPerGallon: gallons > 0 ? km / gallons : null };
}

/** km/L formateado con un decimal ("—" sin datos). 1 galon US = 3.78541 L. */
export function formatKmPerLiter(kmPerGallon: number | null): string {
  return kmPerGallon === null || !Number.isFinite(kmPerGallon)
    ? '—'
    : (kmPerGallon / 3.78541).toFixed(1);
}
