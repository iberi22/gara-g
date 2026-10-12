/**
 * /api/fleet/stats.ts — Returns aggregated KPIs for dashboard.
 *
 * Los KPIs se cuentan SIEMPRE sobre el tenant de la sesion. Antes esta ruta
 * resolvia el tenant, lo devolvia en el JSON (`instanceId`) para dar la
 * impresion de estar filtrada, y llamaba a `getFleetStats()` sin pasarlo: los
 * ocho `listEntities` de dentro usaban DEMO_INSTANCE_ID, asi que el panel
 * mostraba los numeros del tenant de los datos de ejemplo a todos los clientes.
 */
import type { APIRoute } from 'astro';
import { getFleetStats } from '../../../lib/fleetSeed';
import { json, resolveInstanceId } from '../../../lib/fleetApi';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);
  const stats = await getFleetStats(instanceId);
  return json({ data: stats, instanceId });
};