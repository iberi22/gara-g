/**
 * announcer.ts — Cuando hablar y que decir en el radar (la voz en si la pone la UI).
 *
 * Reglas: solo "peligro" habla (un aviso suave se ve en pantalla; un coche que habla por
 * cada aviso se apaga a los 5 minutos y entonces ya no avisa del grave). El mismo evento no
 * se repite (misma clave) y entre dos voces distintas pasan al menos 4 s para que no se
 * pisen; un peligro nuevo mas grave que el que ya sono entra sin esperar.
 */
import type { RiskLevel } from './risk';

export interface Headline {
  level: RiskLevel;
  message: string;
  key: string;
}

export const REPEAT_SAME_MS = 15_000;
export const MIN_GAP_MS = 4_000;

export function createAnnouncer(speak: (text: string) => void, now: () => number = () => Date.now()) {
  const said = new Map<string, number>();
  let lastAt = -Infinity;
  return {
    /** Llamar con cada cambio de titular; devuelve true si hablo. */
    update(h: Headline | null): boolean {
      if (!h || h.level !== 'peligro') return false;
      const t = now();
      const prev = said.get(h.key);
      if (prev !== undefined && t - prev < REPEAT_SAME_MS) return false;
      if (t - lastAt < MIN_GAP_MS) return false;
      said.set(h.key, t);
      lastAt = t;
      speak(h.message);
      return true;
    },
    reset() {
      said.clear();
      lastAt = -Infinity;
    },
  };
}
