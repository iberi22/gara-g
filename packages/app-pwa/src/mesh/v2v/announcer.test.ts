import { describe, expect, it } from 'vitest';
import { createAnnouncer, MIN_GAP_MS, REPEAT_SAME_MS } from './announcer';

const P = (key: string, message = 'Peligro') => ({ level: 'peligro' as const, message, key });

describe('anunciador de voz', () => {
  it('solo habla en peligro, nunca en aviso ni sin titular', () => {
    const said: string[] = [];
    const a = createAnnouncer((t) => said.push(t), () => 0);
    expect(a.update(null)).toBe(false);
    expect(a.update({ level: 'aviso', message: 'x', key: 'k' })).toBe(false);
    expect(a.update(P('k1', 'Choque adelante'))).toBe(true);
    expect(said).toEqual(['Choque adelante']);
  });

  it('no repite el mismo peligro hasta pasados 15 s y respeta los 4 s entre voces', () => {
    let t = 0;
    const said: string[] = [];
    const a = createAnnouncer((x) => said.push(x), () => t);
    a.update(P('a', 'uno'));
    t += 1000;
    expect(a.update(P('a', 'uno'))).toBe(false);
    expect(a.update(P('b', 'dos'))).toBe(false); // demasiado pronto tras la voz anterior
    t += MIN_GAP_MS;
    expect(a.update(P('b', 'dos'))).toBe(true);
    t += REPEAT_SAME_MS;
    expect(a.update(P('a', 'uno'))).toBe(true);
    expect(said).toEqual(['uno', 'dos', 'uno']);
  });

  it('reset olvida lo dicho', () => {
    const a = createAnnouncer(() => {}, () => 0);
    a.update(P('a'));
    a.reset();
    expect(a.update(P('a'))).toBe(true);
  });
});
