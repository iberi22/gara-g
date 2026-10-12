/**
 * ads.test.ts — Pruebas unitarias para el rastreador de impresiones de anuncios (AdImpressionTracker).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdImpressionTracker } from './ads';

class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe('AdImpressionTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', MockObserverHelper);
    vi.stubGlobal('window', {
      IntersectionObserver: MockObserverHelper,
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function MockObserverHelper() {
    return new MockIntersectionObserver();
  }

  it('registra la impresión exactamente una vez cuando el elemento permanece visible >= 1s', async () => {
    const recordFn = vi.fn().mockResolvedValue(true);
    const tracker = new AdImpressionTracker(recordFn);

    const el = { nodeName: 'DIV' } as unknown as HTMLElement;
    const token = 'tok_vis_123';

    tracker.observe(el, token);

    // Entrada a viewport con ratio 0.6
    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.6 },
    ]);

    expect(recordFn).not.toHaveBeenCalled();

    // Avanzar 500 ms (todavía no debe registrarse)
    vi.advanceTimersByTime(500);
    expect(recordFn).not.toHaveBeenCalled();

    // Avanzar otros 500 ms (total 1000 ms)
    vi.advanceTimersByTime(500);
    expect(recordFn).toHaveBeenCalledTimes(1);
    expect(recordFn).toHaveBeenCalledWith(token);
    expect(tracker.hasRecorded(token)).toBe(true);

    tracker.destroy();
  });

  it('cancela el temporizador si el anuncio sale de pantalla antes de cumplir 1s continuo', () => {
    const recordFn = vi.fn().mockResolvedValue(true);
    const tracker = new AdImpressionTracker(recordFn);

    const el = { nodeName: 'DIV' } as unknown as HTMLElement;
    const token = 'tok_cancel_456';

    tracker.observe(el, token);

    // Entra al viewport
    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.7 },
    ]);

    // Pasan 600 ms
    vi.advanceTimersByTime(600);

    // Sale del viewport (< 0.5)
    tracker.handleEntries([
      { target: el, isIntersecting: false, intersectionRatio: 0.1 },
    ]);

    // Pasan otros 600 ms (superando los 1000 ms desde el inicio pero no continuo)
    vi.advanceTimersByTime(600);

    expect(recordFn).not.toHaveBeenCalled();
    expect(tracker.hasRecorded(token)).toBe(false);

    tracker.destroy();
  });

  it('permite registrar la impresión si entra, sale antes de 1s y vuelve a entrar permaneciendo 1s', () => {
    const recordFn = vi.fn().mockResolvedValue(true);
    const tracker = new AdImpressionTracker(recordFn);

    const el = { nodeName: 'DIV' } as unknown as HTMLElement;
    const token = 'tok_reentry_789';

    tracker.observe(el, token);

    // Primer intento: entra y sale tras 400 ms
    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.8 },
    ]);
    vi.advanceTimersByTime(400);

    tracker.handleEntries([
      { target: el, isIntersecting: false, intersectionRatio: 0.2 },
    ]);
    vi.advanceTimersByTime(300);
    expect(recordFn).not.toHaveBeenCalled();

    // Segundo intento: vuelve a entrar y se queda 1000 ms
    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.8 },
    ]);
    vi.advanceTimersByTime(1000);

    expect(recordFn).toHaveBeenCalledTimes(1);
    expect(recordFn).toHaveBeenCalledWith(token);

    tracker.destroy();
  });

  it('no vuelve a mandar el POST si el anuncio entra y sale de pantalla después de haberse registrado', () => {
    const recordFn = vi.fn().mockResolvedValue(true);
    const tracker = new AdImpressionTracker(recordFn);

    const el = { nodeName: 'DIV' } as unknown as HTMLElement;
    const token = 'tok_once_999';

    tracker.observe(el, token);

    // Cumple 1s
    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.9 },
    ]);
    vi.advanceTimersByTime(1000);
    expect(recordFn).toHaveBeenCalledTimes(1);

    // Sale de pantalla
    tracker.handleEntries([
      { target: el, isIntersecting: false, intersectionRatio: 0.0 },
    ]);
    vi.advanceTimersByTime(500);

    // Vuelve a entrar
    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.9 },
    ]);
    vi.advanceTimersByTime(2000);

    // Se mantiene en 1 sola llamada
    expect(recordFn).toHaveBeenCalledTimes(1);

    tracker.destroy();
  });

  it('desconecta el observador y cancela los temporizadores pendientes al destruir', () => {
    const recordFn = vi.fn().mockResolvedValue(true);
    const tracker = new AdImpressionTracker(recordFn);

    const el = { nodeName: 'DIV' } as unknown as HTMLElement;
    const token = 'tok_destroy_000';

    tracker.observe(el, token);

    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.8 },
    ]);

    // Destruir a los 500 ms
    vi.advanceTimersByTime(500);
    tracker.destroy();

    // Avanzar más tiempo
    vi.advanceTimersByTime(1000);

    // No debe disparar recordFn porque se destruyó
    expect(recordFn).not.toHaveBeenCalled();
  });

  it('cancela el temporizador al desobservar un elemento específico', () => {
    const recordFn = vi.fn().mockResolvedValue(true);
    const tracker = new AdImpressionTracker(recordFn);

    const el = { nodeName: 'DIV' } as unknown as HTMLElement;
    const token = 'tok_unobserve_111';

    tracker.observe(el, token);

    tracker.handleEntries([
      { target: el, isIntersecting: true, intersectionRatio: 0.8 },
    ]);

    vi.advanceTimersByTime(500);
    tracker.unobserve(el);

    vi.advanceTimersByTime(1000);
    expect(recordFn).not.toHaveBeenCalled();

    tracker.destroy();
  });
});
