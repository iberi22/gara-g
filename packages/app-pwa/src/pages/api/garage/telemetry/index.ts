/**
 * /api/garage/telemetry/index.ts — POST: ingesta de muestras de la APK (u OBD2).
 *
 * POST /api/garage/telemetry  { samples: TelemetrySample[] }  →  { accepted, rejected }
 *
 * Reglas (docs/garage/ARCHITECTURE.md):
 *  - Sesion obligatoria (401 sin sesion) y tenant SIEMPRE de la sesion.
 *  - Solo admin y operator (can(role, 'telemetry', 'create') de src/lib/rbac.ts): escribir
 *    telemetria es crear filas de la entidad `telemetry`; un observer solo lee.
 *  - Cada VIN tiene que ser de un vehiculo DEL TENANT. Sin esta comprobacion un operator
 *    del cliente A inyectaria muestras en el VIN de un vehiculo del cliente B y su mapa en
 *    vivo se moveria solo. Las muestras de VIN ajeno se cuentan como `vin_ajeno` y NO se
 *    escriben.
 *  - Lote de 200 (`MAX_BATCH`). Lo que exceda se descarta contando el motivo.
 *
 * Respuesta: `{ accepted: n, rejected: { <motivo>: n } }` — los motivos son los de
 * telemetry/ingest.ts mas `vin_ajeno`, que decide esta ruta.
 */
import type { APIRoute } from 'astro';
import { type VehicleRow, vinOf } from '../../../../garage/domain/records';
import { instanceIdFor } from '../../../../garage/domain/tenant';
import {
  REJECT_FOREIGN_VIN,
  type RouteRejectedCounts,
  ingestSamples,
  toTelemetryRow,
} from '../../../../garage/telemetry/ingest';
import { createEntity, listEntities } from '../../../../lib/domain';
import { bad, ensureSeeded, json } from '../../../../lib/fleetApi';
import { can } from '../../../../lib/rbac';
import { forbidden, getAuthUser, unauthorized } from '../../fleetApi/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, 'telemetry', 'create')) {
    return forbidden(`Rol ${user.role} no puede escribir telemetría`);
  }

  const instanceId = instanceIdFor(request, locals);
  await ensureSeeded();

  const body = await request.json().catch(() => null);
  const samples = (body as { samples?: unknown } | null)?.samples;
  if (!Array.isArray(samples)) return bad('Se espera { samples: [...] }');

  const result = ingestSamples(samples);
  const rejected: RouteRejectedCounts = { ...result.rejected };

  // VINs del tenant: solo se acepta telemetria de estos vehiculos.
  const vehicles = await listEntities<VehicleRow>('vehicle', instanceId);
  const ownVins = new Set<string>();
  for (const v of vehicles) {
    const vin = vinOf(v);
    if (vin) ownVins.add(vin);
  }

  let accepted = 0;
  for (const sample of result.accepted) {
    if (!ownVins.has(sample.vin)) {
      rejected[REJECT_FOREIGN_VIN] = (rejected[REJECT_FOREIGN_VIN] ?? 0) + 1;
      continue;
    }
    await createEntity('telemetry', toTelemetryRow(sample), instanceId);
    accepted += 1;
  }

  return json({ accepted, rejected });
};
