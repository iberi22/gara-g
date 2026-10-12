import { describe, it, expect, vi } from 'vitest';
import { escapeCSVCell, toCSV, downloadCSV } from './csvExport';

describe('csvExport module (RFC4180)', () => {
  describe('escapeCSVCell', () => {
    it('1. returns empty string for null or undefined', () => {
      expect(escapeCSVCell(null)).toBe('');
      expect(escapeCSVCell(undefined)).toBe('');
    });

    it('2. returns plain numbers and booleans without quotes', () => {
      expect(escapeCSVCell(123)).toBe('123');
      expect(escapeCSVCell(true)).toBe('true');
      expect(escapeCSVCell(45.67)).toBe('45.67');
    });

    it('3. escapes strings containing double quotes by doubling them', () => {
      expect(escapeCSVCell('Vehículo "Camión"')).toBe('"Vehículo ""Camión"""');
    });

    it('4. wraps strings containing delimiter in double quotes', () => {
      expect(escapeCSVCell('Bogotá, Colombia', ',')).toBe('"Bogotá, Colombia"');
      expect(escapeCSVCell('Semiautónomo; Activo', ';')).toBe('"Semiautónomo; Activo"');
    });

    it('5. wraps strings containing newlines in double quotes', () => {
      expect(escapeCSVCell("Línea 1\nLínea 2")).toBe('"Línea 1\nLínea 2"');
      expect(escapeCSVCell("Fila A\r\nFila B")).toBe('"Fila A\r\nFila B"');
    });

    it('6. formats Date objects to ISO string', () => {
      const date = new Date('2025-03-01T10:00:00.000Z');
      expect(escapeCSVCell(date)).toBe('2025-03-01T10:00:00.000Z');
    });

    it('7. JSON stringifies nested objects and escapes quotes', () => {
      const obj = { key: 'val' };
      expect(escapeCSVCell(obj)).toBe('"{""key"":""val""}"');
    });
  });

  describe('toCSV', () => {
    const columns = [
      { key: 'plate', label: 'Placa' },
      { key: 'make', label: 'Marca / Modelo' },
      { key: 'year', label: 'Año' },
    ];

    const rows = [
      { plate: 'ABC-123', make: 'Toyota "Hilux"', year: 2022 },
      { plate: 'XYZ-987', make: 'Chevrolet; N300', year: 2021 },
    ];

    it('8. includes UTF-8 BOM (\\uFEFF) by default and formats headers and rows with default semicolon delimiter', () => {
      const csv = toCSV(rows, columns);
      expect(csv.startsWith('\uFEFF')).toBe(true);

      const lines = csv.replace('\uFEFF', '').split('\r\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('Placa;Marca / Modelo;Año');
      expect(lines[1]).toBe('ABC-123;"Toyota ""Hilux""";2022');
      expect(lines[2]).toBe('XYZ-987;"Chevrolet; N300";2021');
    });

    it('9. respects custom delimiter options (comma) and includeBOM=false', () => {
      const csv = toCSV(rows, columns, { delimiter: ',', includeBOM: false });
      expect(csv.startsWith('\uFEFF')).toBe(false);

      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('Placa,Marca / Modelo,Año');
      expect(lines[1]).toBe('ABC-123,"Toyota ""Hilux""",2022');
    });

    it('10. handles empty rows array correctly generating header only', () => {
      const csv = toCSV([], columns, { includeBOM: false });
      expect(csv).toBe('Placa;Marca / Modelo;Año');
    });

    it('11. preserves Spanish accents (tildes) and special chars with BOM', () => {
      const spRows = [{ plate: 'GARA-1', make: 'Camión Eléctrico B2', year: '2025' }];
      const csv = toCSV(spRows, columns, { includeBOM: true });
      expect(csv).toContain('Camión Eléctrico B2');
      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });
  });

  describe('downloadCSV', () => {
    it('12. creates a Blob and programmatically clicks download anchor element in browser environment', () => {
      const clickMock = vi.fn();
      const mockElement = {
        setAttribute: vi.fn(),
        style: {},
        click: clickMock,
      };

      const mockDocument = {
        createElement: vi.fn().mockReturnValue(mockElement),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      };

      const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/mock-uuid');
      const revokeObjectURLMock = vi.fn();

      vi.stubGlobal('document', mockDocument);
      vi.stubGlobal('window', {});
      vi.stubGlobal('URL', { createObjectURL: createObjectURLMock, revokeObjectURL: revokeObjectURLMock });

      downloadCSV('vehiculos.csv', '\uFEFFPlaca;Marca\r\nABC-123;Toyota');

      expect(mockDocument.createElement).toHaveBeenCalledWith('a');
      expect(clickMock).toHaveBeenCalled();
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/mock-uuid');

      vi.unstubAllGlobals();
    });
  });
});
