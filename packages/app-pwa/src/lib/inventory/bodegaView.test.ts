import { describe, expect, it } from 'vitest';
import { isLowStock, filterRows, ageInDays } from './bodegaView';

describe('bodegaView helpers', () => {
  describe('isLowStock', () => {
    it('retorna false si minStock es 0 o menor', () => {
      expect(isLowStock(5, 0)).toBe(false);
      expect(isLowStock(5, -1)).toBe(false);
    });

    it('retorna true si cantidad es menor o igual al mínimo', () => {
      expect(isLowStock(5, 5)).toBe(true);
      expect(isLowStock(4, 5)).toBe(true);
      expect(isLowStock(0, 5)).toBe(true);
    });

    it('retorna false si cantidad es mayor al mínimo', () => {
      expect(isLowStock(6, 5)).toBe(false);
    });
  });

  describe('filterRows', () => {
    const items = [
      { name: 'Aceite', sku: 'A-123' },
      { name: 'Filtro de aire', sku: 'F-456' },
      { name: 'Bujía', sku: undefined }
    ];

    it('retorna todos los elementos si el filtro está vacío', () => {
      expect(filterRows(items, '')).toEqual(items);
      expect(filterRows(items, '   ')).toEqual(items);
    });

    it('filtra por nombre ignorando mayúsculas y minúsculas', () => {
      expect(filterRows(items, 'acei')).toEqual([items[0]]);
      expect(filterRows(items, 'FILTRO')).toEqual([items[1]]);
    });

    it('filtra por sku ignorando mayúsculas y minúsculas', () => {
      expect(filterRows(items, 'a-12')).toEqual([items[0]]);
      expect(filterRows(items, 'f-')).toEqual([items[1]]);
    });

    it('retorna vacío si no hay coincidencias', () => {
      expect(filterRows(items, 'Llantas')).toEqual([]);
    });
  });

  describe('ageInDays', () => {
    it('calcula la edad en días correctamente', () => {
      const now = new Date('2026-10-16T12:00:00Z');
      expect(ageInDays('2026-10-15T12:00:00Z', now)).toBe(1);
      expect(ageInDays('2026-10-10T12:00:00Z', now)).toBe(6);
      expect(ageInDays('2026-10-16T10:00:00Z', now)).toBe(0);
    });

    it('retorna 0 para fechas inválidas', () => {
      expect(ageInDays('fecha-invalida')).toBe(0);
    });
  });
});
