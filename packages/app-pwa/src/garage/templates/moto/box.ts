/**
 * box.ts — Caja con aristas redondeadas, pero a prueba de segmentos 0.
 *
 * Por que existe: `roundedBox()` del kit comun pasa `segments` tal cual a
 * RoundedBoxGeometry, y three con `segments = 0` NO falla: ignora las dimensiones y
 * devuelve un cubo de 1x1x1 centrado en el origen. Es un fallo silencioso que destroza
 * el modelo (una aleta de radiador se convierte en un cubo de un metro) y que solo se
 * detecta mirando las capturas, no los tests de tipos.
 *
 * Este envoltorio es el unico lugar de la isla de motos donde se crean cajas
 * redondeadas: clampa los segmentos a >= 1 y avisa en desarrollo si alguien pasa 0.
 */
import { roundedBox as kitRoundedBox } from '../common/geometry';

/** Caja redondeada segura: `segments` se fuerza a 1 o mas. */
export function box(w: number, h: number, d: number, radius: number, segments = 1): ReturnType<typeof kitRoundedBox> {
  return kitRoundedBox(w, h, d, radius, Math.max(1, Math.round(segments)));
}

/** Caja plana tipo chapa/lamina (la usan aletas, faldones y rejillas). */
export function plate(w: number, h: number, d: number, radius = 0.002): ReturnType<typeof kitRoundedBox> {
  return box(w, h, d, Math.min(radius, Math.min(w, Math.min(h, d)) * 0.45), 1);
}