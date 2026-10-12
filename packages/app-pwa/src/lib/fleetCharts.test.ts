import { describe, it, expect } from 'vitest';
import {
  kmPorMes,
  fuelTimeline,
  costPorTipo,
  barChartSVG,
  lineChartSVG,
} from './fleetCharts.js';

describe('fleetCharts', () => {
  describe('kmPorMes', () => {
    it('returns empty array when input is empty or invalid', () => {
      expect(kmPorMes([])).toEqual([]);
      expect(kmPorMes(null as any)).toEqual([]);
      expect(kmPorMes(undefined as any)).toEqual([]);
    });

    it('aggregates mileage by month YYYY-MM and sorts chronologically', () => {
      const records = [
        { date: '2025-03-15', km: 120 },
        { date: '2025-01-10', mileage: 200 },
        { date: '2025-03-20', distance: 80 },
        { date: '2025-02-05', value: 150 },
      ];
      const res = kmPorMes(records);
      expect(res).toEqual([
        { month: '2025-01', km: 200 },
        { month: '2025-02', km: 150 },
        { month: '2025-03', km: 200 },
      ]);
    });

    it('handles timestamp numbers as date input', () => {
      const ts1 = new Date('2025-04-01T10:00:00Z').getTime();
      const ts2 = new Date('2025-04-15T12:00:00Z').getTime();
      const records = [
        { timestamp: ts1, km: 300 },
        { timestamp: ts2, km: 150 },
      ];
      expect(kmPorMes(records)).toEqual([{ month: '2025-04', km: 450 }]);
    });

    it('ignores invalid dates or negative values gracefully', () => {
      const records = [
        { date: 'invalid-date', km: 500 },
        { date: '2025-05-10', km: -50 },
        { date: '2025-05-12', km: 'not-a-number' },
      ];
      expect(kmPorMes(records)).toEqual([{ month: '2025-05', km: 0 }]);
    });
  });

  describe('fuelTimeline', () => {
    it('returns empty array when given no fuel logs', () => {
      expect(fuelTimeline([])).toEqual([]);
    });

    it('aggregates fuel gallons and cost by YYYY-MM', () => {
      const fuelLogs = [
        { date: '2025-01-05', gallons: 15.5, cost: 220000 },
        { date: '2025-01-20', gallons: 10, cost: 145000 },
        { date: '2025-02-14', gallons: 20, cost: 290000 },
      ];
      const res = fuelTimeline(fuelLogs);
      expect(res).toEqual([
        { month: '2025-01', gallons: 25.5, cost: 365000 },
        { month: '2025-02', gallons: 20, cost: 290000 },
      ]);
    });

    it('handles fallback property names (liters, amount)', () => {
      const fuelLogs = [{ date: '2025-03-01', liters: 12, amount: 180000 }];
      expect(fuelTimeline(fuelLogs)).toEqual([
        { month: '2025-03', gallons: 12, cost: 180000 },
      ]);
    });
  });

  describe('costPorTipo', () => {
    it('returns empty array when given no maintenance records', () => {
      expect(costPorTipo([])).toEqual([]);
    });

    it('aggregates cost and event count grouped by type sorted by cost desc', () => {
      const maint = [
        { type: 'preventivo', cost: 150000 },
        { type: 'correctivo', cost: 800000 },
        { type: 'preventivo', cost: 200000 },
        { type: 'inspección', cost: 50000 },
      ];
      const res = costPorTipo(maint);
      expect(res).toEqual([
        { type: 'correctivo', cost: 800000, count: 1 },
        { type: 'preventivo', cost: 350000, count: 2 },
        { type: 'inspección', cost: 50000, count: 1 },
      ]);
    });

    it('handles missing type and uses fallback otros', () => {
      const maint = [{ cost: 100000 }];
      expect(costPorTipo(maint)).toEqual([{ type: 'otros', cost: 100000, count: 1 }]);
    });
  });

  describe('barChartSVG', () => {
    it('renders placeholder SVG when data is empty', () => {
      const svg = barChartSVG([], { title: 'KM por mes', testId: 'test-bar' });
      expect(svg).toContain('data-testid="test-bar"');
      expect(svg).toContain('<svg');
      expect(svg).toContain('Sin datos disponibles');
    });

    it('renders SVG with bars, labels, and testId attribute', () => {
      const data = [
        { label: 'Ene', value: 1200 },
        { label: 'Feb', value: 1800 },
      ];
      const svg = barChartSVG(data, { title: 'KM Recorridos', testId: 'km-chart', unit: 'km' });

      expect(svg).toContain('data-testid="km-chart"');
      expect(svg).toContain('KM Recorridos');
      expect(svg).toContain('data-label="Ene"');
      expect(svg).toContain('data-label="Feb"');
      expect(svg).toContain('<rect');
      expect(svg).toContain('1.2k');
      expect(svg).toContain('1.8k');
    });

    it('respects custom height, width, and color options', () => {
      const data = [{ label: 'Q1', value: 50 }];
      const svg = barChartSVG(data, { width: 400, height: 200, color: '#10b981' });
      expect(svg).toContain('viewBox="0 0 400 200"');
      expect(svg).toContain('fill="#10b981"');
    });
  });

  describe('lineChartSVG', () => {
    it('renders placeholder SVG when data is empty', () => {
      const svg = lineChartSVG([], { testId: 'empty-line' });
      expect(svg).toContain('data-testid="empty-line"');
      expect(svg).toContain('Sin datos disponibles');
    });

    it('renders SVG with line path, area path, and points', () => {
      const data = [
        { label: '2025-01', value: 250000 },
        { label: '2025-02', value: 400000 },
      ];
      const svg = lineChartSVG(data, { title: 'Costo Combustible', testId: 'fuel-timeline' });

      expect(svg).toContain('data-testid="fuel-timeline"');
      expect(svg).toContain('Costo Combustible');
      expect(svg).toContain('<path d="M');
      expect(svg).toContain('<circle');
      expect(svg).toContain('2025-01');
      expect(svg).toContain('2025-02');
    });

    it('handles single point data correctly without NaN coordinates', () => {
      const data = [{ label: 'Unico', value: 100 }];
      const svg = lineChartSVG(data, { testId: 'single-point' });

      expect(svg).not.toContain('NaN');
      expect(svg).toContain('<circle');
      expect(svg).toContain('Unico');
    });
  });
});
