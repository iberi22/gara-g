/**
 * units.ts — Conversion de medidas de ficha tecnica a metros de escena.
 */
import type { TireSize } from '../../contracts';

/** mm → metros. */
export const mm = (v: number): number => v / 1000;

/** Diametro exterior de una llanta en mm: rin + 2 × flanco. 205/55R16 → 631,9. */
export function tireDiameterMm(t: TireSize): number {
  return t.rimIn * 25.4 + 2 * t.widthMm * (t.aspectPct / 100);
}

/** Radio del rin en metros. */
export const rimRadius = (t: TireSize): number => mm((t.rimIn * 25.4) / 2);

/** Radio exterior de la llanta en metros. */
export const tireRadius = (t: TireSize): number => mm(tireDiameterMm(t) / 2);

/**
 * Lee una medida metrica: "205/55R16", "120/70ZR17", "90/90-18", "265/70 R16".
 * Devuelve null si no la entiende (la medida en pulgadas tipo "2.75-18" no entra).
 */
export function parseTireSize(text: string): TireSize | null {
  const m = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:Z?R|-|\s)\s*(\d{2})\s*$/i.exec(text.replace(/\s+R/i, 'R'));
  if (!m) return null;
  const widthMm = Number(m[1]);
  const aspectPct = Number(m[2]);
  const rimIn = Number(m[3]);
  if (widthMm < 50 || widthMm > 450 || aspectPct < 20 || aspectPct > 110 || rimIn < 8 || rimIn > 24) return null;
  return { widthMm, aspectPct, rimIn };
}

export const formatTireSize = (t: TireSize): string => `${t.widthMm}/${t.aspectPct}R${t.rimIn}`;
