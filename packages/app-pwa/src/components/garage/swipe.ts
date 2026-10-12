/**
 * swipe.ts — Detección de gestos de deslizamiento horizontal (swipe) en el lienzo 3D.
 *
 * Exige superar el umbral de distancia (por defecto 60 px) y ser predominantemente
 * horizontal (|dx| > |dy| * 1.2) para no interferir con el scroll vertical de paneles.
 */

export interface SwipeResult {
  isSwipe: boolean;
  direction: 1 | -1;
  distanceX: number;
  distanceY: number;
}

/**
 * Evalúa las coordenadas de inicio y fin de un toque para determinar si es un swipe válido.
 *
 * Deslizar hacia la izquierda (dx < 0) avanza al siguiente vehículo (direction = 1).
 * Deslizar hacia la derecha (dx > 0) regresa al vehículo anterior (direction = -1).
 */
export function detectSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold = 60,
): SwipeResult {
  const distanceX = endX - startX;
  const distanceY = endY - startY;
  const absX = Math.abs(distanceX);
  const absY = Math.abs(distanceY);

  const isHorizontalEnough = absX > absY * 1.2;
  const exceedsThreshold = absX >= threshold;

  if (exceedsThreshold && isHorizontalEnough) {
    return {
      isSwipe: true,
      direction: distanceX < 0 ? 1 : -1,
      distanceX,
      distanceY,
    };
  }

  return {
    isSwipe: false,
    direction: 1,
    distanceX,
    distanceY,
  };
}
