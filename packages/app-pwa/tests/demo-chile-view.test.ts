/**
 * La vista de solo lectura de la flota demo chilena lee el tenant fijo `flota-demo-chile` y,
 * si el almacen no lo tiene, pinta el dataset empaquetado. Nunca lee otro tenant.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CHILE_DEMO_INSTANCE_ID, buildChileDemo } from '../src/lib/demoChile';
import { loadChileDemo } from '../src/lib/demoChileView';
import { createEntity, getMemoryAdapter, setStorageAdapter } from '../src/lib/domain';

const TODAY = new Date('2026-10-17T12:00:00Z');

describe('loadChileDemo', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    setStorageAdapter(getMemoryAdapter());
  });

  it('sin el tenant en el almacen: dataset empaquetado (10 camiones, 8 conductores, 3 geocercas)', async () => {
    // Otro tenant con datos: no se mezcla.
    await createEntity('vehicle', { plate: 'OTRO-01' }, 'otro-tenant');
    const v = await loadChileDemo(TODAY);
    expect(v.source).toBe('bundled');
    expect(v.vehicles).toHaveLength(10);
    expect(v.drivers).toHaveLength(8);
    expect(v.geofences).toHaveLength(3);
    expect(v.vehicles.some((x) => x.plate === 'OTRO-01')).toBe(false);
  });

  it('con el tenant sembrado: lee del almacen', async () => {
    for (const r of buildChileDemo(TODAY)) await createEntity(r.entity, r.data, CHILE_DEMO_INSTANCE_ID, { id: r.id });
    await createEntity('vehicle', { plate: 'OTRO-01' }, 'otro-tenant');
    const v = await loadChileDemo(TODAY);
    expect(v.source).toBe('storage');
    expect(v.vehicles.map((x) => x.plate)).toContain('ZZBC-11');
    expect(v.vehicles).toHaveLength(10);
    expect(v.fleet?.name).toBe('Camiones tolva · Región de Antofagasta');
  });
});
