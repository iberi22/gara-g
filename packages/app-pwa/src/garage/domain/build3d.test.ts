import { describe, expect, it } from 'vitest';
import type { VehicleRow } from './records';
import { applyBuild3d, catalogTypeForBody, sanitizeBuild3d } from './build3d';
import { specForVehicle } from './vehicleSpec';
import { bodyForCatalogType, defaultSpec, getTemplate } from '../templates/registry';

const b = (build3d: unknown, extra: VehicleRow = {}): VehicleRow => ({ ...extra, build3d });

describe('build3d', () => {
  it('moto + sport -> sport', () => {
    expect(specForVehicle(b({ v: 1, body: 'sport' }, { type: 'moto' })).body).toBe('sport');
  });
  it('sedan + hatchback uses template dims', () => {
    const s = specForVehicle(b({ v: 1, body: 'hatchback' }, { type: 'sedan' }));
    expect(s.body).toBe('hatchback');
    expect(s.dims).toEqual(defaultSpec('hatchback', 'car').dims);
  });
  it('cross-family body ignored', () => {
    expect(specForVehicle(b({ v: 1, body: 'dump' }, { type: 'moto' })).body).toBe('naked');
  });
  it('dims override applied', () => {
    const s = specForVehicle(b({ v: 1, dims: { lengthMm: 4000 } }, { type: 'sedan' }));
    expect(s.dims.lengthMm).toBe(4000);
    expect(s.dims.widthMm).toBe(defaultSpec('sedan', 'car').dims.widthMm);
  });
  it('garbage ignored', () => {
    for (const g of ['x', Number.NaN, -1, 99999, null, [], [1], { v: 1, dims: { lengthMm: 99999, widthMm: Number.NaN } }]) {
      const s = specForVehicle(b(g, { type: 'sedan' }));
      expect(s.dims).toEqual(defaultSpec('sedan', 'car').dims);
    }
  });
  it('shape clamped, unknown dropped; variants filtered', () => {
    const t = getTemplate('naked', 'moto');
    const id = t.shapeParams[0].id;
    const slot = Object.keys(t.variants)[0];
    const s = specForVehicle(
      b({ v: 1, shape: { [id]: 5, nope: 0.5 }, variants: { [slot]: t.variants[slot][0], [`${slot}`+'x']: 'a', ...{ [slot + '2']: 'zz' } } }, { type: 'moto' }),
    );
    expect(s.shape).toEqual({ [id]: 1 });
    expect(s.variants).toEqual({ [slot]: t.variants[slot][0] });
    const s2 = specForVehicle(b({ v: 1, variants: { [slot]: 'does-not-exist' } }, { type: 'moto' }));
    expect(s2.variants).toBeUndefined();
  });
  it('tires out of range dropped', () => {
    const s = sanitizeBuild3d({ v: 1, tireFront: { widthMm: 10, aspectPct: 50, rimIn: 16 }, tireRear: { widthMm: 200, aspectPct: 50, rimIn: 17 } }, 'car');
    expect(s?.tireFront).toBeUndefined();
    expect(s?.tireRear).toEqual({ widthMm: 200, aspectPct: 50, rimIn: 17 });
  });
  it('wheelbase >= length dropped', () => {
    expect(sanitizeBuild3d({ v: 1, dims: { lengthMm: 4000, wheelbaseMm: 4100 } }, 'car')?.dims?.wheelbaseMm).toBeUndefined();
  });
  it('Corolla keeps its dims with shape', () => {
    const plain = specForVehicle({ make: 'Toyota', model: 'Corolla', year: 2020, type: 'sedan' });
    const t = getTemplate(plain.body, plain.family);
    const s = specForVehicle(b({ v: 1, shape: { [t.shapeParams[0]?.id ?? 'x']: 0.3 } }, { make: 'Toyota', model: 'Corolla', year: 2020, type: 'sedan' }));
    expect(s.dims).toEqual(plain.dims);
  });
  it('no build3d -> identical to base', () => {
    const rows: VehicleRow[] = [
      { make: 'Yamaha', model: 'FZ16', type: 'moto' },
      { make: 'Yamaha', model: 'NMAX', type: 'moto' },
      { make: 'Toyota', model: 'Corolla', type: 'sedan' },
      { make: 'Toyota', model: 'Hilux', type: 'camioneta' },
      { type: 'camion' },
    ];
    for (const r of rows) {
      const s = specForVehicle(r, 'id');
      expect(applyBuild3d(s, undefined)).toBe(s);
      expect(specForVehicle({ ...r, build3d: undefined }, 'id')).toEqual(s);
      expect(s.shape).toBeUndefined();
      expect(s.variants).toBeUndefined();
    }
  });
  it('catalogTypeForBody covers all bodies', () => {
    expect(catalogTypeForBody('car', 'hatchback')).toBe('sedan');
    expect(catalogTypeForBody('moto', 'scooter')).toBe('moto');
    expect(catalogTypeForBody('heavy', 'dump')).toBe('volqueta');
    for (const t of ['sedan', 'suv', 'pickup', 'van', 'camion', 'estacas', 'volqueta', 'tractomula', 'excavadora', 'cargador']) {
      const { family, body } = bodyForCatalogType(t);
      expect(catalogTypeForBody(family, body)).toBe(t);
    }
  });
});
