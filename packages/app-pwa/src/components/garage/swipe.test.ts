/**
 * swipe.test.ts — Pruebas unitarias para la detección de deslizamiento táctil horizontal.
 */
import { describe, expect, it } from 'vitest';
import { detectSwipe } from './swipe';

describe('detectSwipe', () => {
  it('detecta swipe hacia la izquierda (siguiente vehículo, direction = 1)', () => {
    // Inicia en x=200, termina en x=100 (dx = -100)
    const res = detectSwipe(200, 300, 100, 310, 60);
    expect(res.isSwipe).toBe(true);
    expect(res.direction).toBe(1);
    expect(res.distanceX).toBe(-100);
  });

  it('detecta swipe hacia la derecha (vehículo anterior, direction = -1)', () => {
    // Inicia en x=100, termina en x=220 (dx = +120)
    const res = detectSwipe(100, 300, 220, 290, 60);
    expect(res.isSwipe).toBe(true);
    expect(res.direction).toBe(-1);
    expect(res.distanceX).toBe(120);
  });

  it('ignora movimientos por debajo del umbral mínimo de 60px', () => {
    const res = detectSwipe(100, 100, 140, 100, 60);
    expect(res.isSwipe).toBe(false);
  });

  it('ignora movimientos principalmente verticales (scroll de página/panel)', () => {
    // dx = 70, pero dy = 150 (scroll vertical)
    const res = detectSwipe(100, 100, 170, 250, 60);
    expect(res.isSwipe).toBe(false);
  });
});
