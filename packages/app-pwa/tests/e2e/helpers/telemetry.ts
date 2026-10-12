import type { Page } from '@playwright/test';
import { getLatestTelemetryByVin, type RawTelemetry, type RawVehicle } from '../../../src/lib/livePoll';

/**
 * helpers/telemetry.ts — Telemetria en vivo para los specs de /fleet/tracking.
 *
 * La telemetria solo existe en la semilla del tenant `demo-flota`, y no hay API
 * que la cree en el tenant de la sesion (`POST /api/fleet/telemetry` no existe:
 * esa ruta solo exporta GET). LiveMap sondea `/api/fleet/telemetry?recent=1`
 * con el tenant de la sesion, asi que en dev la tabla sale vacia. Aqui se
 * responde ese sondeo con filas reales, formateadas por el mismo
 * getLatestTelemetryByVin que usa el endpoint: se prueba la UI de tracking, no
 * el origen de los datos.
 */
const VEHICLES: RawVehicle[] = [
  { vin: '1HGCM82633A004352', plate: 'ABC-001' },
  { vin: '1HGCM82633A004353', plate: 'ABC-002' },
  { vin: '1HGCM82633A004358', plate: 'GHI-201' },
];

export function sampleTelemetry(): RawTelemetry[] {
  const now = Date.now();
  return VEHICLES.map((v, i) => ({
    id: `tel-${i}`,
    vin: v.vin,
    timestamp: now - i * 60_000,
    speed: 62 + i * 9,
    rpm: 2100 + i * 150,
    coolantTemp: 88 + i,
    fuelLevel: 70 - i * 12,
    latitude: 4.65 + i * 0.01,
    longitude: -74.08 - i * 0.01,
  }));
}

/** Responde GET /api/fleet/telemetry?recent=1 con la telemetria de muestra. */
export async function mockLiveTelemetry(page: Page): Promise<void> {
  await page.route('**/api/fleet/telemetry?*', async (route) => {
    const vin = new URL(route.request().url()).searchParams.get('vin');
    const data = getLatestTelemetryByVin(sampleTelemetry(), VEHICLES, vin);
    await route.fulfill({ json: { data, total: data.length } });
  });
}
