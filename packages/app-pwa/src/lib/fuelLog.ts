import type { DomainRecord } from './domain';
import { MARKET, LITERS_PER_GALLON, formatDecimal, volumeLiters, type MarketConfig } from './market';

export interface FuelLogData {
  vehicleId: string;
  driverId: string;
  date: string;
  km: number;
  /**
   * Volumen cargado. El modelo nacio en galones (`gallons`) y la semilla chilena guarda
   * ademas `liters`. Ver `volumeLiters` de lib/market.ts: la interfaz lee las dos formas.
   */
  gallons?: number;
  liters?: number;
  cost: number;
  station: string;
  /** Rendimiento guardado, en galones (campo heredado) y en litros (unidad de Chile). */
  kmPerGallon?: number;
  kmPerLiter?: number;
}

export type FuelLogRecord = DomainRecord<FuelLogData>;

/** Kilometros por unidad de volumen del mercado a partir de una distancia y un volumen. */
export function kmPerVolume(distanceKm: number, volume: number): number {
  if (!(volume > 0) || !(distanceKm > 0)) return 0;
  return distanceKm / volume;
}

/**
 * Rellena `kmPerLiter` (y su equivalente en galones) de cada carga a partir de la lectura
 * anterior del mismo vehiculo: `km / volumen`.
 *
 * El volumen de cada fila se lee con `volumeLiters`, asi que da igual si la fila trae
 * `liters` (semilla chilena) o solo `gallons` (filas anteriores). Sin lectura anterior la
 * eficiencia es 0, no un valor inventado.
 */
export function computeKmPerLiter(
  allLogs: FuelLogRecord[],
  market: MarketConfig = MARKET,
): FuelLogRecord[] {
  const byVehicle: Record<string, FuelLogRecord[]> = {};

  for (const log of allLogs) {
    const vId = log.vehicleId || 'unknown';
    if (!byVehicle[vId]) byVehicle[vId] = [];
    byVehicle[vId].push(log);
  }

  const calculatedMap = new Map<string, number>();
  // Valor sin redondear, para derivar el equivalente en galones sin acumular error.
  const rawMap = new Map<string, number>();

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
        continue;
      }
      const previous = vehicleLogs[i - 1];
      const diffKm = (Number(current.km) || 0) - (Number(previous.km) || 0);
      const volume = volumeLiters(current) ?? 0;
      const raw = kmPerVolume(diffKm, volume);
      // Se guarda el valor redondeado, pero el equivalente en galones sale del valor CRUDO:
      // derivarlo del redondeado acumulaba error (35,0 km/gal salia 35,02).
      calculatedMap.set(current.id, Number.isFinite(raw) && raw > 0 ? Number(raw.toFixed(2)) : 0);
      rawMap.set(current.id, Number.isFinite(raw) && raw > 0 ? raw : 0);
    }
  }

  return allLogs.map((log) => {
    const kmPerLiter = calculatedMap.get(log.id) ?? 0;
    const rawKmPerLiter = rawMap.get(log.id) ?? 0;
    return {
      ...log,
      kmPerLiter,
      // El campo heredado sigue poblado para no romper consumidores que aun lo lean.
      kmPerGallon: rawKmPerLiter > 0 ? Number((rawKmPerLiter * LITERS_PER_GALLON).toFixed(2)) : 0,
    };
  });
}

/**
 * Alias heredado del nombre anterior (`computeKmPerGallon`).
 * @deprecated usa `computeKmPerLiter`.
 */
export const computeKmPerGallon = computeKmPerLiter;

export interface FleetFuelEfficiency {
  /** Distancia recorrida entre la primera y la ultima carga, sumada por vehiculo (km). */
  km: number;
  /** Combustible consumido en ese tramo, en la unidad del mercado. */
  volume: number;
  /** Combustible consumido en ese tramo (galones), para los consumidores heredados. */
  gallons: number;
  /** km por litro de la flota; null cuando no hay al menos dos lecturas validas. */
  kmPerLiter: number | null;
  /** km por galon de la flota (equivalente); null cuando no hay datos. */
  kmPerGallon: number | null;
}

/**
 * Eficiencia real de la flota por el metodo de tanque lleno.
 *
 * Por vehiculo: distancia = odometro maximo - odometro minimo del periodo; combustible =
 * suma del volumen de TODAS las cargas salvo la primera (la mas antigua). Ese primer
 * llenado repone lo gastado ANTES de la primera lectura, asi que el combustible del tramo
 * medido es el de las cargas posteriores. Flota = distancia total / combustible total.
 *
 * El volumen se lee con `volumeLiters`, asi que acepta filas en litros o en galones.
 * Un vehiculo con menos de dos lecturas de odometro, sin avance o sin combustible en el
 * tramo no aporta (ni distancia ni combustible): no se inventa un cero. Sin ningun vehiculo
 * valido la eficiencia es null y la interfaz muestra "—".
 * (Antes se dividia la SUMA de los odometros por el combustible, que no es una eficiencia.)
 */
export function fleetFuelEfficiency(
  logs: Array<{ vehicleId?: string; date?: string; km?: number; gallons?: number; liters?: number }>,
  market: MarketConfig = MARKET,
): FleetFuelEfficiency {
  const byVehicle = new Map<string, Array<{ t: number; km: number; volume: number }>>();
  for (const log of logs) {
    const km = Number(log.km);
    if (!Number.isFinite(km) || km <= 0) continue;
    const key = log.vehicleId || 'unknown';
    const t = new Date(log.date as string).getTime();
    const list = byVehicle.get(key) ?? [];
    list.push({ t: Number.isFinite(t) ? t : 0, km, volume: Math.max(0, volumeLiters(log) ?? 0) });
    byVehicle.set(key, list);
  }

  let km = 0;
  let volume = 0;
  for (const list of byVehicle.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.t - b.t || a.km - b.km);
    const dist = Math.max(...list.map((r) => r.km)) - Math.min(...list.map((r) => r.km));
    const fuel = list.slice(1).reduce((acc, r) => acc + r.volume, 0);
    if (dist > 0 && fuel > 0) {
      km += dist;
      volume += fuel;
    }
  }
  const kmPerLiter = volume > 0 ? km / volume : null;
  // `volume` esta en litros (volumeLiters); se devuelve en la unidad del mercado y ademas en
  // galones, para que los consumidores heredados no tengan que convertir. Se redondea a 6
  // decimales porque el ida y vuelta litros<->galones deja ruido de coma flotante
  // (25 galones salian 25,000000000000004) y esas cifras se muestran al usuario.
  const r6 = (n: number) => Number(n.toFixed(6));
  return {
    km,
    volume: r6(market.volumeUnit === 'L' ? volume : volume / LITERS_PER_GALLON),
    gallons: r6(volume / LITERS_PER_GALLON),
    kmPerLiter,
    kmPerGallon: kmPerLiter === null ? null : r6(kmPerLiter * LITERS_PER_GALLON),
  };
}

/**
 * Rendimiento en km/L con un decimal y los separadores del mercado ("—" sin datos).
 * Recibe el valor YA en km/L (antes recibia km/galon y convertia: el nombre mentia).
 */
export function formatKmPerLiter(
  kmPerLiter: number | null,
  market: MarketConfig = MARKET,
): string {
  return kmPerLiter === null || !Number.isFinite(kmPerLiter)
    ? '—'
    : formatDecimal(kmPerLiter, 1, market);
}

/** Etiqueta de la columna de rendimiento ("Km/L" en Chile, "Km/Gal" en Colombia). */
export const EFFICIENCY_COLUMN = MARKET.efficiencyColumn;
