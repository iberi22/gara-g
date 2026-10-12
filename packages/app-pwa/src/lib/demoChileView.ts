/**
 * demoChileView.ts — Lectura (solo lectura) de la flota demo chilena para
 * /fleet/garage/flota-demo-chile.
 *
 * Lee SIEMPRE el tenant fijo `flota-demo-chile`: nunca uno que venga de la URL, la cookie o
 * la sesion, asi que abrir la pagina sin cuenta no expone otra flota. Si el almacen no tiene
 * ese tenant (produccion, dev sin D1, D1 sin sembrar) o falla, pinta el dataset empaquetado
 * de src/lib/demoChile.ts. No escribe nada.
 */
import { CHILE_DEMO_INSTANCE_ID, type DemoRow, buildChileDemo } from './demoChile';
import { listEntities } from './domain';

type Row = Record<string, unknown> & { id: string };

export interface ChileDemoView {
  source: 'storage' | 'bundled';
  fleet: Row | null;
  vehicles: Row[];
  drivers: Row[];
  maintenance: Row[];
  fuelLogs: Row[];
  documents: Row[];
  geofences: Row[];
  alerts: Row[];
}

const ENTITIES = ['fleet', 'vehicle', 'driver', 'maintenance', 'fuelLog', 'document', 'geofence', 'alert'] as const;

function shape(source: ChileDemoView['source'], by: Record<string, Row[]>): ChileDemoView {
  const byId = (a: Row, b: Row) => String(a.id).localeCompare(String(b.id));
  const list = (e: string) => [...(by[e] ?? [])].sort(byId);
  return {
    source,
    fleet: list('fleet')[0] ?? null,
    vehicles: list('vehicle'),
    drivers: list('driver'),
    maintenance: list('maintenance'),
    fuelLogs: list('fuelLog'),
    documents: list('document'),
    geofences: list('geofence'),
    alerts: list('alert'),
  };
}

export function bundledChileDemo(today: Date = new Date()): ChileDemoView {
  const by: Record<string, Row[]> = {};
  for (const r of buildChileDemo(today) as DemoRow[]) (by[r.entity] ??= []).push({ ...r.data, id: r.id });
  return shape('bundled', by);
}

export async function loadChileDemo(today: Date = new Date()): Promise<ChileDemoView> {
  try {
    const vehicles = await listEntities('vehicle', CHILE_DEMO_INSTANCE_ID);
    if (vehicles.length === 0) return bundledChileDemo(today);
    const by: Record<string, Row[]> = { vehicle: vehicles as Row[] };
    for (const e of ENTITIES) {
      if (e === 'vehicle') continue;
      by[e] = (await listEntities(e, CHILE_DEMO_INSTANCE_ID)) as Row[];
    }
    return shape('storage', by);
  } catch {
    return bundledChileDemo(today);
  }
}
