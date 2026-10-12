import { describe, expect, it } from 'vitest';

import { parseISODate, toISODate } from '../src/lib/maintenance.js';

/**
 * El constructor Date NORMALIZA en vez de fallar: `new Date(2026, 12, 45)`
 * es el 14 de febrero de 2027 y `getTime()` no es NaN. Antes de este test,
 * parseISODate("2026-13-45") devolvia una fecha real y los vehiculos quedaban
 * con el proximo servicio 15 meses antes de tiempo.
 */
describe('parseISODate rechaza fechas fuera de rango', () => {
  it('devuelve null con mes fuera de rango', () => {
    expect(parseISODate('2026-13-01')).toBeNull();
    expect(parseISODate('2026-00-01')).toBeNull();
    expect(parseISODate('2026-13-45')).toBeNull();
  });

  it('devuelve null con dia fuera de rango para ese mes', () => {
    expect(parseISODate('2026-02-30')).toBeNull(); // febrero de 2026 tiene 28
    expect(parseISODate('2026-04-31')).toBeNull(); // abril tiene 30
    expect(parseISODate('2026-01-32')).toBeNull();
  });

  it('acepta los limites validos de cada mes', () => {
    expect(toISODate(parseISODate('2024-02-29')!)).toBe('2024-02-29'); // bisiesto
    expect(parseISODate('2026-02-28')).not.toBeNull();
    expect(parseISODate('2026-12-31')).not.toBeNull();
    expect(parseISODate('2026-01-01')).not.toBeNull();
  });

  it('sigue rechazando lo que no es YYYY-MM-DD', () => {
    expect(parseISODate('invalido')).toBeNull();
    expect(parseISODate('')).toBeNull();
    expect(parseISODate('2026-1-1')).toBeNull();
    expect(parseISODate('01/01/2026')).toBeNull();
  });
});
