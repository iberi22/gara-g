/**
 * formatters.test.ts — Pruebas unitarias para formateadores numéricos, de moneda y fechas.
 */
import { describe, expect, it } from 'vitest';
import { formatCOP, formatKm, formatTimeAgo } from './formatters';

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

  it('devuelve guion para valores nulos o inválidos', () => {
    expect(formatKm(null)).toBe('—');
    expect(formatKm(undefined)).toBe('—');
    expect(formatKm(NaN)).toBe('—');
  });
});

describe('formatCOP', () => {
  it('formatea valores en pesos colombianos con símbolo $', () => {
    const res = formatCOP(45000);
    expect(res).toContain('$');
    expect(res).toContain('45');
    expect(res).toContain('000');
  });

  it('maneja valores de costo negativos', () => {
    const res = formatCOP(-12000);
    expect(res).toContain('−$');
  });

  it('devuelve guion para valores nulos o inválidos', () => {
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
