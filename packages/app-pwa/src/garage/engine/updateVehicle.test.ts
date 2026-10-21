import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VehicleSpec } from '../contracts';

const builtSpecs: VehicleSpec[] = [];
const disposedRoots: unknown[] = [];

vi.mock('../templates/registry', async (orig) => {
  const mod = await orig<typeof import('../templates/registry')>();
  return {
    ...mod,
    getTemplate: (body: never, family: never) => {
      const tpl = mod.getTemplate(body, family);
      return {
        ...tpl,
        build: (spec: VehicleSpec, ctx: never) => {
          builtSpecs.push(spec);
          return tpl.build(spec, ctx);
        },
      };
    },
  };
});

vi.mock('./carousel', async (orig) => {
  const mod = await orig<typeof import('./carousel')>();
  return {
    ...mod,
    disposeVehicleGeometries: (root: unknown) => {
      disposedRoots.push(root);
      (mod.disposeVehicleGeometries as (r: unknown) => void)(root);
    },
  };
});

import { createGarageEngine } from './index';

const spec: VehicleSpec = {
  family: 'moto',
  body: 'naked',
  dims: { lengthMm: 2100, widthMm: 800, heightMm: 1100, wheelbaseMm: 1440 },
  tireFront: { widthMm: 120, aspectPct: 70, rimIn: 17 },
  tireRear: { widthMm: 180, aspectPct: 55, rimIn: 17 },
  shape: { tankVolume: 0.7 },
  paint: { baseColor: '#38bdf8', finish: 'gloss' },
};

describe('engine.updateVehicle', () => {
  const originalWindow = (globalThis as unknown as { window: unknown }).window;

  beforeEach(() => {
    builtSpecs.length = 0;
    disposedRoots.length = 0;
    const mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    (globalThis as unknown as { window: unknown }).window = { matchMedia: vi.fn().mockReturnValue(mq) };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('no hace nada si todavia no hay vehiculo', () => {
    const engine = createGarageEngine({ quality: 'low', forceWebGL: true });
    engine.updateVehicle({ ...spec, variants: { rim_fl: 'mesh' } });
    expect(builtSpecs.length).toBe(0);
    expect(engine.getVehiclesInScene?.()).toBe(0);
    engine.dispose();
  });

  it('reemplaza la raiz in situ y libera las geometrias de la anterior', async () => {
    const engine = createGarageEngine({ quality: 'low', forceWebGL: true });
    await engine.showVehicle(spec);
    expect(engine.getVehiclesInScene?.()).toBe(1);
    const before = builtSpecs.length;

    engine.updateVehicle({ ...spec, variants: { rim_fl: 'mesh' } });

    expect(builtSpecs.length).toBe(before + 1);
    expect(builtSpecs[builtSpecs.length - 1].variants).toEqual({ rim_fl: 'mesh' });
    expect(engine.getVehiclesInScene?.()).toBe(1);
    expect(disposedRoots.length).toBe(1);
    engine.dispose();
  });

  it('setPaint despues de updateVehicle conserva variantes y forma', async () => {
    const engine = createGarageEngine({ quality: 'low', forceWebGL: true });
    await engine.showVehicle(spec);
    engine.updateVehicle({ ...spec, variants: { rim_fl: 'mesh' } });
    engine.setPaint({ baseColor: '#ff0000', finish: 'matte' });

    const last = builtSpecs[builtSpecs.length - 1];
    expect(last.variants).toEqual({ rim_fl: 'mesh' });
    expect(last.shape).toEqual({ tankVolume: 0.7 });
    expect(last.paint.baseColor).toBe('#ff0000');
    expect(engine.getVehiclesInScene?.()).toBe(1);
    engine.dispose();
  });

  it('updateVehicle durante un showVehicle pendiente: gana la ultima llamada', async () => {
    const engine = createGarageEngine({ quality: 'low', forceWebGL: true });
    await engine.showVehicle(spec);
    const other = { ...spec, shape: { tankVolume: 0.1 } };
    const pending = engine.showVehicle(other);
    engine.updateVehicle({ ...spec, variants: { rim_fl: 'mesh' } });
    await pending;

    expect(engine.getVehiclesInScene?.()).toBe(1);
    engine.setPaint({ baseColor: '#00ff00', finish: 'gloss' });
    const last = builtSpecs[builtSpecs.length - 1];
    expect(last.variants).toEqual({ rim_fl: 'mesh' });
    expect(last.shape).toEqual({ tankVolume: 0.7 });
    engine.dispose();
  });
});
