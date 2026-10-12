/**
 * fleetCharts.ts — Agregaciones puras y generador de gráficos SVG server-rendered
 * para el dashboard y analítica de flotas (SIN dependencias de librerías externas).
 */

export interface ChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  color?: string;
  sublabel?: string;
}

export interface BarChartOptions {
  title?: string;
  width?: number;
  height?: number;
  color?: string;
  testId?: string;
  unit?: string;
}

export interface LineChartOptions {
  title?: string;
  width?: number;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  testId?: string;
  unit?: string;
}

/**
 * Normaliza y extrae una clave YYYY-MM a partir de date string o timestamp ms.
 */
function toMonthKey(dateOrTs: string | number | undefined): string | null {
  if (!dateOrTs) return null;
  if (typeof dateOrTs === 'number') {
    if (isNaN(dateOrTs) || dateOrTs <= 0) return null;
    const d = new Date(dateOrTs);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 7);
  }
  if (typeof dateOrTs === 'string') {
    const trimmed = dateOrTs.trim();
    if (/^\d{4}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 7);
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 7);
    }
  }
  return null;
}

/**
 * Agrega kilometraje por mes (YYYY-MM).
 * Soporta objetos con date/timestamp/createdAt y km/mileage/distance/value.
 */
export function kmPorMes(records: Array<Record<string, unknown>>): Array<{ month: string; km: number }> {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  const aggregated = new Map<string, number>();

  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const dateVal = (r.date ?? r.timestamp ?? r.createdAt ?? r.created_at) as string | number | undefined;
    const month = toMonthKey(dateVal);
    if (!month) continue;

    const kmVal = Number(r.km ?? r.mileage ?? r.distance ?? r.value ?? 0);
    const validKm = isNaN(kmVal) ? 0 : Math.max(0, kmVal);

    aggregated.set(month, (aggregated.get(month) ?? 0) + validKm);
  }

  return Array.from(aggregated.entries())
    .map(([month, km]) => ({ month, km: Math.round(km) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Agrega consumo de combustible y costo a lo largo del tiempo (por mes YYYY-MM).
 */
export function fuelTimeline(
  fuelLogs: Array<Record<string, unknown>>
): Array<{ month: string; gallons: number; cost: number }> {
  if (!Array.isArray(fuelLogs) || fuelLogs.length === 0) {
    return [];
  }

  const aggregated = new Map<string, { gallons: number; cost: number }>();

  for (const log of fuelLogs) {
    if (!log || typeof log !== 'object') continue;
    const month = toMonthKey((log.date ?? log.timestamp) as string | number | undefined);
    if (!month) continue;

    const gallons = Math.max(0, Number(log.gallons ?? log.liters ?? 0) || 0);
    const cost = Math.max(0, Number(log.cost ?? log.amount ?? 0) || 0);

    const current = aggregated.get(month) ?? { gallons: 0, cost: 0 };
    aggregated.set(month, {
      gallons: current.gallons + gallons,
      cost: current.cost + cost,
    });
  }

  return Array.from(aggregated.entries())
    .map(([month, data]) => ({
      month,
      gallons: Math.round(data.gallons * 10) / 10,
      cost: Math.round(data.cost),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Agrega costo y cantidad de eventos por tipo de mantenimiento.
 */
export function costPorTipo(
  maintenance: Array<Record<string, unknown>>
): Array<{ type: string; cost: number; count: number }> {
  if (!Array.isArray(maintenance) || maintenance.length === 0) {
    return [];
  }

  const aggregated = new Map<string, { cost: number; count: number }>();

  for (const m of maintenance) {
    if (!m || typeof m !== 'object') continue;
    const rawType = String(m.type ?? m.category ?? 'otros').trim().toLowerCase();
    const type = rawType.length > 0 ? rawType : 'otros';
    const cost = Math.max(0, Number(m.cost ?? m.price ?? 0) || 0);

    const current = aggregated.get(type) ?? { cost: 0, count: 0 };
    aggregated.set(type, {
      cost: current.cost + cost,
      count: current.count + 1,
    });
  }

  return Array.from(aggregated.entries())
    .map(([type, data]) => ({
      type,
      cost: Math.round(data.cost),
      count: data.count,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Formatea números grandes para etiquetas SVG (ej: 1.5M, 120k).
 */
function formatCompactNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return String(Math.round(num));
}

/**
 * Genera markup SVG para un gráfico de barras.
 */
export function barChartSVG(data: ChartDataPoint[], options: BarChartOptions = {}): string {
  const {
    title,
    width = 600,
    height = 280,
    color = 'var(--swal-accent)',
    testId = 'bar-chart',
    unit = '',
  } = options;

  const margin = { top: title ? 40 : 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  if (!data || data.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" data-testid="${testId}" class="fleet-svg-chart">
      <rect width="${width}" height="${height}" fill="transparent" rx="0" />
      ${title ? `<text x="${width / 2}" y="25" fill="var(--swal-text)" font-size="14" font-weight="bold" text-anchor="middle">${title}</text>` : ''}
      <text x="${width / 2}" y="${height / 2 + 10}" fill="var(--swal-text-secondary)" font-size="13" text-anchor="middle">Sin datos disponibles</text>
    </svg>`;
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.max(12, Math.floor((chartWidth / data.length) * 0.65));
  const step = chartWidth / data.length;

  // Grid lines y Y-axis labels (4 ticks)
  const yTicks = 4;
  let gridLinesHtml = '';
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxValue / yTicks) * i;
    const y = margin.top + chartHeight - (i / yTicks) * chartHeight;
    gridLinesHtml += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}" stroke="var(--swal-line-grid)" stroke-dasharray="3,3" />`;
    gridLinesHtml += `<text x="${margin.left - 8}" y="${y + 4}" fill="var(--swal-text-secondary)" font-size="10" text-anchor="end">${formatCompactNumber(val)}</text>`;
  }

  let barsHtml = '';
  data.forEach((d, i) => {
    const x = margin.left + i * step + (step - barWidth) / 2;
    const barH = (d.value / maxValue) * chartHeight;
    const y = margin.top + chartHeight - barH;
    const barColor = d.color || color;

    barsHtml += `<g class="bar-group" data-label="${d.label}" data-value="${d.value}">`;
    barsHtml += `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(2, barH)}" fill="${barColor}" rx="0" opacity="0.9">`;
    barsHtml += `<title>${d.label}: ${d.value.toLocaleString()} ${unit}</title>`;
    barsHtml += `</rect>`;
    // Value text on top of bar if space permits
    if (barH > 18) {
      barsHtml += `<text x="${x + barWidth / 2}" y="${y - 4}" fill="var(--swal-text-secondary)" font-size="10" font-weight="600" text-anchor="middle">${formatCompactNumber(d.value)}</text>`;
    }
    // X label
    barsHtml += `<text x="${x + barWidth / 2}" y="${margin.top + chartHeight + 20}" fill="var(--swal-text-secondary)" font-size="11" text-anchor="middle">${d.label}</text>`;
    barsHtml += `</g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" data-testid="${testId}" class="fleet-svg-chart">
    <rect width="${width}" height="${height}" fill="transparent" rx="0" stroke="transparent" stroke-width="0" />
    ${title ? `<text x="20" y="28" fill="var(--swal-text)" font-size="14" font-weight="bold">${title}</text>` : ''}
    ${gridLinesHtml}
    ${barsHtml}
  </svg>`;
}

/**
 * Genera markup SVG para un gráfico de líneas (timeline).
 */
export function lineChartSVG(data: ChartDataPoint[], options: LineChartOptions = {}): string {
  const {
    title,
    width = 600,
    height = 280,
    strokeColor = 'var(--swal-accent)',
    fillColor = 'var(--swal-accent-muted)',
    testId = 'line-chart',
    unit = '',
  } = options;

  const margin = { top: title ? 40 : 20, right: 30, bottom: 40, left: 55 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  if (!data || data.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" data-testid="${testId}" class="fleet-svg-chart">
      <rect width="${width}" height="${height}" fill="transparent" rx="0" />
      ${title ? `<text x="${width / 2}" y="25" fill="var(--swal-text)" font-size="14" font-weight="bold" text-anchor="middle">${title}</text>` : ''}
      <text x="${width / 2}" y="${height / 2 + 10}" fill="var(--swal-text-secondary)" font-size="13" text-anchor="middle">Sin datos disponibles</text>
    </svg>`;
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  // Y-axis grid lines
  const yTicks = 4;
  let gridLinesHtml = '';
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxValue / yTicks) * i;
    const y = margin.top + chartHeight - (i / yTicks) * chartHeight;
    gridLinesHtml += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}" stroke="var(--swal-line-grid)" stroke-dasharray="3,3" />`;
    gridLinesHtml += `<text x="${margin.left - 8}" y="${y + 4}" fill="var(--swal-text-secondary)" font-size="10" text-anchor="end">${formatCompactNumber(val)}</text>`;
  }

  // Calculate coordinates for points
  const points: Array<{ x: number; y: number; d: ChartDataPoint }> = data.map((d, i) => {
    const step = data.length > 1 ? chartWidth / (data.length - 1) : 0;
    const x = data.length === 1 ? margin.left + chartWidth / 2 : margin.left + i * step;
    const y = margin.top + chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y, d };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const firstP = points[0];
  const lastP = points[points.length - 1];
  const areaD = `${pathD} L ${lastP.x.toFixed(1)} ${(margin.top + chartHeight).toFixed(1)} L ${firstP.x.toFixed(1)} ${(margin.top + chartHeight).toFixed(1)} Z`;

  let pointsHtml = '';
  points.forEach((p) => {
    pointsHtml += `<g class="point-group">`;
    pointsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${strokeColor}" stroke="var(--swal-bg-surface)" stroke-width="2">`;
    pointsHtml += `<title>${p.d.label}: ${p.d.value.toLocaleString()} ${unit}</title>`;
    pointsHtml += `</circle>`;
    pointsHtml += `<text x="${p.x.toFixed(1)}" y="${margin.top + chartHeight + 20}" fill="var(--swal-text-secondary)" font-size="11" text-anchor="middle">${p.d.label}</text>`;
    pointsHtml += `</g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" data-testid="${testId}" class="fleet-svg-chart">
    <rect width="${width}" height="${height}" fill="transparent" rx="0" stroke="transparent" stroke-width="0" />
    ${title ? `<text x="20" y="28" fill="var(--swal-text)" font-size="14" font-weight="bold">${title}</text>` : ''}
    ${gridLinesHtml}
    <path d="${areaD}" fill="${fillColor}" />
    <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    ${pointsHtml}
  </svg>`;
}
