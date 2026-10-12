/**
 * /api/fleet/telemetry.ts — GET endpoint for recent telemetry per vehicle.
 *
 * GET /api/fleet/telemetry?recent=1[&vin=...][&instanceId=...]
 * Returns latest telemetry per VIN joined with vehicle info.
 */
import type { APIRoute } from 'astro';
import { json, resolveInstanceId, ensureSeeded } from '../../../lib/fleetApi';
import { listEntities } from '../../../lib/domain';
import { getLatestTelemetryByVin, type RawTelemetry, type RawVehicle } from '../../../lib/livePoll';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  await ensureSeeded();
  const url = new URL(request.url);
  const recent = url.searchParams.get('recent');
  const vin = url.searchParams.get('vin');
  const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);

  const telemetry = (await listEntities('telemetry', instanceId)) as unknown as RawTelemetry[];
  const vehicles = (await listEntities('vehicle', instanceId)) as unknown as RawVehicle[];

  if (recent === '1' || recent === 'true') {
    const liveRows = getLatestTelemetryByVin(telemetry, vehicles, vin);
    return json({ data: liveRows, total: liveRows.length });
  }

  // Fallback: list all telemetry records
  let filtered = telemetry;
  if (vin) {
    filtered = telemetry.filter((t) => t.vin && t.vin.toLowerCase() === vin.toLowerCase());
  }

  return json({ data: filtered, total: filtered.length });
};
