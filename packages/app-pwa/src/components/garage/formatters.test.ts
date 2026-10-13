/**
 * formatters.test.ts — Pruebas unitarias para formateadores numéricos, de moneda y fechas.
 */
import { describe, expect, it } from 'vitest';
import { formatCOP, formatKm, formatMoney, formatTimeAgo } from './formatters';
import { MARKETS } from '../../lib/market';

describe('formatKm', () => {
  it('formatea kilómetros positivos con separador de miles y sufijo', () => {
    const res = formatKm(28450);
    expect(res).toContain('28');
    expect(res).toContain('450');
    expect(res).toContain('km');
  });

  it('formatea distancias negativas con signo menos matemático', () => {
    const res = formatKm(-350);
    expect(res).toBe('−350 km');
  });

  it('formatea el horometro de la maquinaria en horas', () => {
    expect(formatKm(1250, 'h')).toBe('1.250 h');
  });

  it('devuelve guion para valores nulos o inválidos', () => {
    expect(formatKm(null)).toBe('—');
    expect(formatKm(undefined)).toBe('—');
    expect(formatKm(NaN)).toBe('—');
  });
});

describe('formatMoney (y su alias heredado formatCOP)', () => {
  it('formatea en la moneda del mercado activo, sin decimales (CLP)', () => {
    expect(formatMoney(45000)).toBe('$45.000');
    expect(formatMoney(186000)).toBe('$186.000');
    // El alias heredado devuelve exactamente lo mismo.
    expect(formatCOP(45000)).toBe(formatMoney(45000));
  });

  it('no mezcla mercados: Colombia sigue leyendose en COP con la misma forma', () => {
    expect(formatMoney(45000, MARKETS.CO)).toBe('$45.000');
    expect(formatMoney(1234567, MARKETS.CL)).toBe('$1.234.567');
  });

  it('maneja valores de costo negativos', () => {
    expect(formatMoney(-12000)).toContain('−$');
  });

  it('devuelve guion para valores nulos o inválidos', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatCOP(null)).toBe('—');
    expect(formatCOP(undefined)).toBe('—');
  });
});

describe('formatTimeAgo', () => {
  it('formatea diferencias en segundos', () => {
    const now = new Date('2026-10-01T12:00:30Z');
    const past = new Date('2026-10-01T12:00:10Z');
    expect(formatTimeAgo(past, now)).toBe('hace 20 s');
  });

  it('formatea diferencias en minutos', () => {
    const now = new Date('2026-10-01T12:15:00Z');
    const past = new Date('2026-10-01T12:10:00Z');
    expect(formatTimeAgo(past, now)).toBe('hace 5 min');
  });

  it('formatea diferencias en horas', () => {
    const now = new Date('2026-10-01T14:00:00Z');
    const past = new Date('2026-10-01T12:00:00Z');
    expect(formatTimeAgo(past, now)).toBe('hace 2 h');
  });

  it('formatea diferencias en días', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const past = new Date('2026-10-01T12:00:00Z');
    expect(formatTimeAgo(past, now)).toBe('hace 3 días');
  });

  it('maneja entradas inválidas con gracia', () => {
    expect(formatTimeAgo(null)).toBe('Sin datos');
    expect(formatTimeAgo('fecha-loca')).toBe('Fecha inválida');
  });
});
