/**
 * ads.ts — Seguimiento de impresiones de anuncios patrocinados vía IntersectionObserver.
 *
 * Registra una impresión (POST /api/garage/ads/impression) únicamente cuando el elemento
 * del anuncio se mantiene al menos un 50% visible durante 1 segundo continuo (≥ 1000 ms),
 * garantizando que se registre una sola vez por token.
 */
import { garageApi } from './api';

export class AdImpressionTracker {
  private recordedTokens = new Set<string>();
  private timers = new Map<Element, number>();
  private observer: IntersectionObserver | null = null;
  private elementTokens = new Map<Element, string>();

  constructor(private recordFn: (token: string) => Promise<boolean> = (t) => garageApi.recordImpression(t)) {
    this.ensureObserver();
  }

  private ensureObserver(): void {
    if (!this.observer && typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          this.handleEntries(entries);
        },
        { threshold: 0.5 },
      );
    }
  }

  /**
   * Empieza a observar un elemento publicitario asociado a un token.
   */
  observe(element: HTMLElement, token: string): void {
    if (this.recordedTokens.has(token)) return;
    this.ensureObserver();
    if (!this.observer) return;
    this.elementTokens.set(element, token);
    this.observer.observe(element);
  }

  /**
   * Deja de observar un elemento específico.
   */
  unobserve(element: HTMLElement): void {
    if (this.timers.has(element)) {
      window.clearTimeout(this.timers.get(element));
      this.timers.delete(element);
    }
    this.elementTokens.delete(element);
    this.observer?.unobserve(element);
  }

  /**
   * Verifica si un token ya ha sido registrado como impreso.
   */
  hasRecorded(token: string): boolean {
    return this.recordedTokens.has(token);
  }

  /**
   * Limpia todos los temporizadores y observadores.
   * Se desconecta el IntersectionObserver al desmontar componentes.
   */
  destroy(): void {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
    this.elementTokens.clear();
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * Maneja las entradas de intersección.
   * Expuesto para permitir pruebas unitarias con simulación de intersección.
   */
  handleEntries(entries: Array<{ target: Element; isIntersecting: boolean; intersectionRatio: number }>): void {
    for (const entry of entries) {
      const el = entry.target;
      const token = this.elementTokens.get(el);
      if (!token || this.recordedTokens.has(token)) {
        this.unobserve(el as HTMLElement);
        continue;
      }

      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        // Iniciar temporizador de 1 segundo si no está corriendo
        if (!this.timers.has(el)) {
          const timerId = window.setTimeout(() => {
            if (this.recordedTokens.has(token)) {
              this.timers.delete(el);
              this.unobserve(el as HTMLElement);
              return;
            }
            this.recordedTokens.add(token);
            void this.recordFn(token);
            this.timers.delete(el);
            this.unobserve(el as HTMLElement);
          }, 1000);
          this.timers.set(el, timerId);
        }
      } else {
        // Salió del umbral antes de 1 s: cancelar temporizador
        if (this.timers.has(el)) {
          window.clearTimeout(this.timers.get(el));
          this.timers.delete(el);
        }
      }
    }
  }
}

export const adTracker = new AdImpressionTracker();
