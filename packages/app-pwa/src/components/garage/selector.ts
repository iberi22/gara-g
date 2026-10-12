/**
 * selector.ts — Lógica de navegación y selección de vehículos en el parque (flota).
 *
 * Maneja el cálculo de índice circular (wrap-around) hacia adelante (+1) y atrás (-1),
 * así como el formateo del contador "2/5".
 */

export interface SelectorResult {
  nextIndex: number;
  direction: 1 | -1;
}

/**
 * Calcula el siguiente índice circularmente.
 *
 * @param currentIndex Índice actual (0-indexed)
 * @param totalCount Cantidad total de vehículos en el parque
 * @param direction Dirección deseada: 1 = siguiente, -1 = anterior
 */
export function wrapVehicleIndex(
  currentIndex: number,
  totalCount: number,
  direction: 1 | -1,
): SelectorResult {
  if (totalCount <= 1) {
    return { nextIndex: 0, direction };
  }

  let nextIndex: number;
  if (direction === 1) {
    nextIndex = (currentIndex + 1) % totalCount;
  } else {
    nextIndex = (currentIndex - 1 + totalCount) % totalCount;
  }

  return { nextIndex, direction };
}

/**
 * Formatea el contador de posición en el parque ("2/5").
 */
export function formatFleetCounter(index: number, total: number): string {
  if (total <= 0) return '0/0';
  const clampedIndex = Math.max(0, Math.min(index, total - 1));
  return `${clampedIndex + 1}/${total}`;
}
