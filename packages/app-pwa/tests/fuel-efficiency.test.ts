import { describe, expect, it } from 'vitest';
import { fleetFuelEfficiency, formatKmPerLiter } from '../src/lib/fuelLog';
import { LITERS_PER_GALLON, MARKETS } from '../src/lib/market';

describe('fleetFuelEfficiency (tanque lleno)', () => {
  it('un vehiculo: (max-min odometro) / galones sin el primer llenado', () => {
    // 10000 -> 10300 -> 10650 km; galones 12 (excluido), 10, 15 => 650 km / 25 gal = 26
    const r = fleetFuelEfficiency([
      { vehicleId: 'a', date: '2026-01-01', km: 10000, gallons: 12 },
      { vehicleId: 'a', date: '2026-01-10', km: 10300, gallons: 10 },
      { vehicleId: 'a', date: '2026-01-20', km: 10650, gallons: 15 },
    ]);
    // Con el mercado colombiano la eficiencia se sigue leyendo en km/gal...
    expect(r).toMatchObject({ km: 650, gallons: 25, kmPerGallon: 26 });
    // ...y con el chileno (el activo) ademas en km/L, que es la unidad que se muestra.
    expect(r.kmPerLiter).toBeCloseTo(26 / LITERS_PER_GALLON, 9);
  });

  it('no depende del orden de entrada ni suma odometros entre si', () => {
    const r = fleetFuelEfficiency([
      { vehicleId: 'a', date: '2026-01-20', km: 10650, gallons: 15 },
      { vehicleId: 'a', date: '2026-01-01', km: 10000, gallons: 12 },
      { vehicleId: 'a', date: '2026-01-10', km: 10300, gallons: 10 },
    ]);
    expect(r.kmPerGallon).toBe(26);
  });

  it('flota: distancia total / combustible total (no promedio de promedios)', () => {
    // a: 300 km / 10 gal = 30 ; b: 200 km / 30 gal = 6.67
    const r = fleetFuelEfficiency([
      { vehicleId: 'a', date: '2026-01-01', km: 5000, gallons: 8 },
      { vehicleId: 'a', date: '2026-01-05', km: 5300, gallons: 10 },
      { vehicleId: 'b', date: '2026-01-01', km: 90000, gallons: 9 },
      { vehicleId: 'b', date: '2026-01-05', km: 90200, gallons: 30 },
    ]);
    // 500 km / 40 gal = 12.5 (promedio de promedios seria (30+6.67)/2 = 18.3)
    expect(r).toMatchObject({ km: 500, gallons: 40, kmPerGallon: 12.5 });
  });

  it('un vehiculo con una sola lectura no aporta; sin pares validos es null', () => {
    expect(fleetFuelEfficiency([{ vehicleId: 'a', date: '2026-01-01', km: 100, gallons: 5 }]).kmPerGallon).toBeNull();
    expect(fleetFuelEfficiency([{ vehicleId: 'a', date: '2026-01-01', km: 100, liters: 20 }]).kmPerLiter).toBeNull();
    expect(fleetFuelEfficiency([]).kmPerGallon).toBeNull();
    const r = fleetFuelEfficiency([
      { vehicleId: 'a', date: '2026-01-01', km: 100, gallons: 5 },
      { vehicleId: 'b', date: '2026-01-01', km: 1000, gallons: 5 },
      { vehicleId: 'b', date: '2026-01-08', km: 1100, gallons: 5 },
    ]);
    expect(r).toMatchObject({ km: 100, gallons: 5, kmPerGallon: 20 });
  });

  it('una fila en litros (semilla chilena) da la misma eficiencia que su equivalente en galones', () => {
    const inLiters = fleetFuelEfficiency([
      { vehicleId: 'a', date: '2026-01-01', km: 10000, liters: 10 * LITERS_PER_GALLON },
      { vehicleId: 'a', date: '2026-01-10', km: 10300, liters: 10 * LITERS_PER_GALLON },
    ]);
    expect(inLiters.kmPerLiter).toBeCloseTo(300 / (10 * LITERS_PER_GALLON), 9);
    expect(inLiters.kmPerGallon).toBeCloseTo(30, 9);
  });

  it('odometro sin avance o galones en cero: null, nunca Infinity/NaN', () => {
    expect(
      fleetFuelEfficiency([
        { vehicleId: 'a', date: '2026-01-01', km: 100, gallons: 5 },
        { vehicleId: 'a', date: '2026-01-02', km: 100, gallons: 5 },
      ]).kmPerGallon,
    ).toBeNull();
    expect(
      fleetFuelEfficiency([
        { vehicleId: 'a', date: '2026-01-01', km: 100, gallons: 5 },
        { vehicleId: 'a', date: '2026-01-02', km: 200, gallons: 0 },
      ]).kmPerGallon,
    ).toBeNull();
  });
});

describe('formatKmPerLiter', () => {
  it('formatea km/L con un decimal y el separador del mercado (recibe km/L, no km/gal)', () => {
    expect(formatKmPerLiter(10, MARKETS.CL)).toBe('10,0');
    expect(formatKmPerLiter(26 / LITERS_PER_GALLON, MARKETS.CL)).toBe('6,9');
    expect(formatKmPerLiter(26 / LITERS_PER_GALLON, MARKETS.CO)).toBe('6,9');
  });
  it('"—" sin datos', () => {
    expect(formatKmPerLiter(null)).toBe('—');
  });
});
