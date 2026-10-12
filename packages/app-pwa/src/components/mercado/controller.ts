/**
 * controller.ts — Pegamento entre las paginas del mercado y `src/mesh/datos`: crea el mercado
 * una sola vez por pestana, y carga los vehiculos del garage local para emparejar.
 *
 * SOLO NAVEGADOR (lo importan componentes `client:only`). Los vehiculos se leen en el
 * dispositivo (IndexedDB en modo local, API del tenant con cuenta) y nunca se mandan a la
 * red: `OwnerVehicle` es para emparejar; la malla solo ve `DemandSignal`.
 */
import { getClientMode } from '../../lib/appMode';
import { type Market, createMarket } from '../../mesh/datos/market';
import { acquireDatosPorts } from '../../mesh/datos/port';
import { createIdbStore } from '../../mesh/datos/store';
import { regionOf } from '../../mesh/datos/topics';
import { type OwnerVehicle, vehiclesFromSnapshot } from '../../mesh/datos/vehicles';
import type { GarageSnapshot } from '../../garage/contracts';

export interface CityOption {
  name: string;
  lat: number;
  lon: number;
}

/** Ciudades para elegir la region a mano. Se guarda solo la celda de ~39 km, no el punto. */
export const CITIES: CityOption[] = [
  { name: 'Bogotá', lat: 4.711, lon: -74.072 },
  { name: 'Medellín', lat: 6.244, lon: -75.581 },
  { name: 'Cali', lat: 3.452, lon: -76.532 },
  { name: 'Barranquilla', lat: 10.964, lon: -74.796 },
  { name: 'Cartagena', lat: 10.391, lon: -75.479 },
  { name: 'Bucaramanga', lat: 7.119, lon: -73.123 },
  { name: 'Pereira', lat: 4.814, lon: -75.694 },
  { name: 'Cúcuta', lat: 7.894, lon: -72.507 },
];

export const cityRegions = (): { name: string; cell: string }[] =>
  CITIES.map((c) => ({ name: c.name, cell: regionOf(c.lat, c.lon) }));

export interface MarketHandle {
  market: Market;
  /** false = sin nodo real todavia (fallback en memoria): no hay pares. */
  real: boolean;
}

let handle: Promise<MarketHandle> | null = null;

export function getMarket(): Promise<MarketHandle> {
  handle ??= (async () => {
    const { port, demandPortFactory, real } = await acquireDatosPorts();
    const market = createMarket({ port, demandPortFactory, store: createIdbStore() });
    await market.start();
    return { market, real };
  })();
  return handle;
}

/** Vehiculos del garage de este dispositivo/cuenta, listos para emparejar. [] si no se pueden leer. */
export async function loadOwnerVehicles(): Promise<OwnerVehicle[]> {
  try {
    if (getClientMode() === 'guest') {
      const { loadLocalSnapshot } = await import('../garage/guestGarage');
      return vehiclesFromSnapshot(await loadLocalSnapshot());
    }
    const res = await fetch('/api/garage/vehicles');
    if (!res.ok) return [];
    return vehiclesFromSnapshot((await res.json()) as GarageSnapshot);
  } catch {
    return [];
  }
}

/** Region aproximada con la ubicacion del navegador; la coordenada se descarta aqui mismo. */
export function regionFromGeolocation(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('sin geolocalización'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(regionOf(p.coords.latitude, p.coords.longitude)),
      (e) => reject(new Error(e.message)),
      { maximumAge: 3_600_000, timeout: 10_000, enableHighAccuracy: false },
    );
  });
}

/** Suscribe una funcion al estado del mercado y devuelve como cancelar. */
export function watchMarket(market: Market, cb: Parameters<Market['subscribe']>[0]): () => void {
  const off = market.subscribe(cb);
  const timer = setInterval(() => void market.tick(), 30_000);
  return () => {
    off();
    clearInterval(timer);
  };
}
