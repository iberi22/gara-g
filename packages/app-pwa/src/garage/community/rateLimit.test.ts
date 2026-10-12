/**
 * rateLimit.test.ts — Tope de 5 mensajes / 10 min y 30 / dia por autor.
 *
 * El reloj se inyecta en las funciones en vez de usar `Date.now()` mockeado, para
 * que el test sea explicito sobre cuando caduca cada ventana: los contadores viven
 * en memoria de modulo, asi que el tiempo es un parametro, no una cosa que "pasa".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RATE_DAILY_LIMIT,
  RATE_SHORT_LIMIT,
  checkRateLimit,
  consumeRateLimit,
  hitRateLimit,
  resetRateLimits,
} from './rateLimit';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

describe('rateLimit', () => {
  beforeEach(() => resetRateLimits());

  it('permite 5 mensajes seguidos y bloquea el sexto', () => {
    for (let i = 0; i < RATE_SHORT_LIMIT; i++) {
      expect(hitRateLimit('autor-a', T0).ok).toBe(true);
    }
    const sexto = hitRateLimit('autor-a', T0);
    expect(sexto.ok).toBe(false);
    expect(sexto.scope).toBe('short');
  });

  it('cada autor tiene su propia cuota', () => {
    for (let i = 0; i < RATE_SHORT_LIMIT; i++) hitRateLimit('autor-a', T0);
    expect(hitRateLimit('autor-a', T0).ok).toBe(false);
    // El bloqueo de uno no puede cerrar el foro de los demas.
    expect(hitRateLimit('autor-b', T0).ok).toBe(true);
  });

  it('la ventana de 10 min se reabre justo cuando caduca la marca mas antigua', () => {
    for (let i = 0; i < RATE_SHORT_LIMIT; i++) hitRateLimit('autor-a', T0);
    // Justo ANTES de caducar sigue bloqueado (la marca mas antigua sigue dentro).
    expect(checkRateLimit('autor-a', T0 + 10 * MIN - 1).ok).toBe(false);
    // Y en el instante exacto en que `now - t` alcanza la ventana, la marca sale:
    // el criterio de `prune` es `now - t < ventanaMs`, sin <=.
    expect(checkRateLimit('autor-a', T0 + 10 * MIN).ok).toBe(true);
  });

  it('el limite diario manda cuando la ventana corta ya caduco', () => {
    // 30 mensajes: 5 cada 11 minutos, para que la ventana de 10 min nunca sea el tope.
    let t = T0;
    for (let i = 0; i < RATE_DAILY_LIMIT; i++) {
      expect(hitRateLimit('autor-c', t).ok).toBe(true);
      t += 11 * MIN;
    }
    const diario = hitRateLimit('autor-c', t);
    expect(diario.ok).toBe(false);
    expect(diario.scope).toBe('daily');
  });

  it('el limite diario se reabue al pasar las 24 h', () => {
    let t = T0;
    for (let i = 0; i < RATE_DAILY_LIMIT; i++) {
      hitRateLimit('autor-d', t);
      t += 11 * MIN;
    }
    expect(checkRateLimit('autor-d', t).ok).toBe(false);
    expect(checkRateLimit('autor-d', t + 24 * 60 * MIN).ok).toBe(true);
  });

  it('Retry-After dice cuanto falta, y es al menos 1 s', () => {
    for (let i = 0; i < RATE_SHORT_LIMIT; i++) hitRateLimit('autor-e', T0);
    const v = checkRateLimit('autor-e', T0 + 60 * 1000);
    expect(v.ok).toBe(false);
    expect(v.retryAfterSec).toBeGreaterThan(0);
    // La marca mas antigua es la de T0: en este momento le quedan 9 min.
    expect(v.retryAfterSec).toBe(9 * 60);
  });

  it('checkRateLimit no consume cuota: mirar no es escribir', () => {
    for (let i = 0; i < RATE_SHORT_LIMIT; i++) {
      expect(checkRateLimit('autor-f', T0).ok).toBe(true);
    }
    // Cinco consultas no cuentan como ningun mensaje.
    expect(hitRateLimit('autor-f', T0).ok).toBe(true);
  });

  it('consumeRateLimit suma sin comprobar (la ruta ya valido antes)', () => {
    consumeRateLimit('autor-g', T0);
    consumeRateLimit('autor-g', T0);
    expect(checkRateLimit('autor-g', T0).ok).toBe(true);
    for (let i = 0; i < 3; i++) consumeRateLimit('autor-g', T0);
    expect(checkRateLimit('autor-g', T0).ok).toBe(false);
  });

  it('las marcas caducadas se limpian al consultar (el mapa no crece sin limite)', () => {
    consumeRateLimit('autor-h', T0);
    consumeRateLimit('autor-h', T0);
    // Una consulta muy posterior podaria ambas marcas.
    expect(checkRateLimit('autor-h', T0 + 25 * 60 * MIN).ok).toBe(true);
    expect(checkRateLimit('autor-h', T0 + 25 * 60 * MIN).ok).toBe(true);
  });
});
