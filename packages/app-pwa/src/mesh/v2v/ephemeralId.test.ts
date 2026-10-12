import { describe, expect, it } from 'vitest';
import { createEphemeralIdSource, ID_ROTATE_MS } from './ephemeralId';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Math.floor(1_800_000_000_000 / DAY) * DAY; // 00:00 UTC

function counterRandom() {
  let n = 0;
  return (len: number) => {
    n++;
    return Uint8Array.from({ length: len }, (_, i) => (n * 37 + i * 11 + n * i) & 0xff);
  };
}

describe('id efimero', () => {
  it('es estable dentro de una ranura de 10 min', () => {
    let t = T0 + 5_000;
    const s = createEphemeralIdSource({ now: () => t, randomBytes: counterRandom() });
    const a = s.current();
    t += ID_ROTATE_MS - 10_000;
    expect(s.current()).toBe(a);
  });

  it('rota cada 10 minutos', () => {
    let t = T0 + 1_000;
    const s = createEphemeralIdSource({ now: () => t, randomBytes: counterRandom() });
    const ids = new Set<number>();
    for (let i = 0; i < 20; i++) {
      ids.add(s.current());
      t += ID_ROTATE_MS;
    }
    expect(ids.size).toBe(20);
  });

  it('cambia al cruzar el limite del dia UTC con semilla nueva', () => {
    let t = T0 + DAY - 1_000;
    const s = createEphemeralIdSource({ now: () => t, randomBytes: counterRandom() });
    const before = s.current();
    const slotBefore = s.slot();
    t = T0 + DAY + 1_000;
    expect(s.current()).not.toBe(before);
    expect(s.slot()).not.toBe(slotBefore);
    // Misma ranura (0) del dia siguiente: con semilla distinta no puede repetirse el id del dia anterior.
    t = T0 + 1_000;
    const dayA = createEphemeralIdSource({ now: () => t, randomBytes: counterRandom() }).current();
    t = T0 + DAY + 1_000;
    const rnd = counterRandom();
    rnd(16);
    const dayB = createEphemeralIdSource({ now: () => t, randomBytes: rnd }).current();
    expect(dayA).not.toBe(dayB);
  });

  it('dispositivos con semillas distintas no comparten id', () => {
    const a = createEphemeralIdSource({ now: () => T0, randomBytes: () => new Uint8Array(16).fill(1) });
    const b = createEphemeralIdSource({ now: () => T0, randomBytes: () => new Uint8Array(16).fill(2) });
    expect(a.current()).not.toBe(b.current());
  });

  it('es un u32 y nunca se deriva de datos de cuenta (solo usa la fuente aleatoria)', () => {
    let calls = 0;
    const s = createEphemeralIdSource({
      now: () => T0,
      randomBytes: (n) => {
        calls++;
        return new Uint8Array(n).fill(7);
      },
    });
    const id = s.current();
    expect(Number.isInteger(id) && id >= 0 && id <= 0xffffffff).toBe(true);
    s.current();
    expect(calls).toBe(1);
  });
});
