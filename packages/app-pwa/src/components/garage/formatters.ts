/**
 * formatters.ts — Formateadores para valores numéricos y temporales del HUD del Garage.
 *
 * Convierte distancias, monedas y fechas ISO a cadenas legibles para la interfaz,
 * respetando las convenciones colombianas (pesos COP, separadores de miles con punto).
 */

/**
 * Formatea el contador de uso con separador de miles: km, u horas de motor en maquinaria
 * (`GarageVehicle.usageUnit`). Ej: 28450 -> "28.450 km", -350 -> "−350 km", (1250, 'h') -> "1.250 h".
 */
export function formatKm(km: number | undefined | null, unit: 'km' | 'h' = 'km'): string {
  if (km === undefined || km === null || Number.isNaN(km)) {
    return '—';
  }
  const isNegative = km < 0;
  const absVal = Math.abs(Math.round(km));
  const formatted = absVal.toLocaleString('es-CO');
  return `${isNegative ? '−' : ''}${formatted} ${unit}`;
}

/**
 * Formatea un valor monetario en pesos colombianos (COP).
 * Ej: 45000 -> "$45.000", 186000 -> "$186.000"
 */
export function formatCOP(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) {
    return '—';
  }
  const isNegative = amount < 0;
  const absVal = Math.abs(Math.round(amount));
  const formatted = absVal.toLocaleString('es-CO');
  return `${isNegative ? '−$' : '$'}${formatted}`;
}

/**
 * Formatea una fecha o cadena ISO en formato relativo ("hace X s", "hace X min", etc.)
 */
export function formatTimeAgo(isoOrDate: string | Date | undefined | null, now = new Date()): string {
  if (!isoOrDate) return 'Sin datos';
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';

  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) {
    return `hace ${diffSec} s`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `hace ${diffMin} min`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `hace ${diffHours} h`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `hace ${diffDays} día${diffDays === 1 ? '' : 's'}`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  return `hace ${diffMonths} mes${diffMonths === 1 ? '' : 'es'}`;
}
