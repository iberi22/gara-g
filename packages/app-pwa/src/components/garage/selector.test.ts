/**
 * selector.test.ts — Pruebas unitarias para la envoltura circular del selector de flota.
 */
import { describe, expect, it } from 'vitest';
import { formatFleetCounter, wrapVehicleIndex } from './selector';

describe('wrapVehicleIndex', () => {
  it('avanza al siguiente índice circularmente (+1)', () => {
    expect(wrapVehicleIndex(0, 5, 1)).toEqual({ nextIndex: 1, direction: 1 });
    expect(wrapVehicleIndex(3, 5, 1)).toEqual({ nextIndex: 4, direction: 1 });
    // Envoltura de fin a principio
    expect(wrapVehicleIndex(4, 5, 1)).toEqual({ nextIndex: 0, direction: 1 });
  });

  it('retrocede al índice anterior circularmente (-1)', () => {
    expect(wrapVehicleIndex(2, 5, -1)).toEqual({ nextIndex: 1, direction: -1 });
    // Envoltura de principio a fin
    expect(wrapVehicleIndex(0, 5, -1)).toEqual({ nextIndex: 4, direction: -1 });
  });

  it('maneja listas con 0 o 1 elemento sin desbordar', () => {
    expect(wrapVehicleIndex(0, 1, 1)).toEqual({ nextIndex: 0, direction: 1 });
    expect(wrapVehicleIndex(0, 1, -1)).toEqual({ nextIndex: 0, direction: -1 });
    expect(wrapVehicleIndex(0, 0, 1)).toEqual({ nextIndex: 0, direction: 1 });
  });
});

describe('formatFleetCounter', () => {
  it('formatea correctamente la posición actual respecto al total', () => {
    expect(formatFleetCounter(0, 5)).toBe('1/5');
    expect(formatFleetCounter(1, 5)).toBe('2/5');
    expect(formatFleetCounter(4, 5)).toBe('5/5');
  });

  it('maneja totales vacíos o anómalos', () => {
    expect(formatFleetCounter(0, 0)).toBe('0/0');
  });
});
