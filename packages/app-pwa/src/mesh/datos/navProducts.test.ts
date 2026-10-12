import { describe, expect, it } from 'vitest';
import { LocalMeshHub } from '../localHub';
import { type NavReading, NavProducts, parseNavCell } from './navProducts';
import { TOPIC_NAV } from './topics';

const CELL = 'd2g6u1'; // p6, dentro de la region 'd2g6'
const T0 = 1_000_000;
const reading = (over: Partial<NavReading> = {}): NavReading => ({ cell: CELL, kind: 'density', value: 40, ts: T0, ...over });

describe('NavProducts', () => {
  it('suprime las celdas con menos de k fuentes distintas', () => {
    const nav = new NavProducts({ k: 3, clock: () => T0 });
    nav.ingest(reading({ src: 'a' }));
    nav.ingest(reading({ src: 'b' }));
    nav.ingest(reading({ src: 'a' })); // la misma fuente insistiendo no suma
    expect(nav.compute()).toEqual([]);
    nav.ingest(reading({ src: 'c' }));
    const out = nav.compute();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ v: 1, kind: 'density', cell: CELL, eps: 1 });
  });

  it('sin src cada lectura cuenta como una fuente', () => {
    const nav = new NavProducts({ k: 3, clock: () => T0 });
    for (let i = 0; i < 3; i++) nav.ingest(reading());
    expect(nav.compute()).toHaveLength(1);
  });

  it('peligros y densidad son productos separados', () => {
    const nav = new NavProducts({ k: 2, clock: () => T0 });
    nav.ingest(reading({ src: 'a' }));
    nav.ingest(reading({ src: 'b', kind: 'hazard', value: 5 }));
    expect(nav.compute()).toEqual([]); // 1 + 1: ninguno llega a 2
  });

  it('el valor publicado queda dentro de [0, valueMax] aunque el ruido lo saque', () => {
    const nav = new NavProducts({ k: 3, epsilon: 0.01, clock: () => T0 }); // ruido enorme
    for (const s of ['a', 'b', 'c']) nav.ingest(reading({ src: s, value: 500 }));
    for (let i = 0; i < 50; i++) for (const c of nav.compute()) expect(c.value >= 0 && c.value <= 100).toBe(true);
  });

  it('menor epsilon da mas ruido (el epsilon de la config manda)', () => {
    const spread = (epsilon: number) => {
      const nav = new NavProducts({ k: 3, epsilon, clock: () => T0 });
      for (const s of ['a', 'b', 'c']) nav.ingest(reading({ src: s, value: 50 }));
      const vals = Array.from({ length: 300 }, () => nav.compute()[0].value);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return vals.reduce((a, b) => a + Math.abs(b - mean), 0) / vals.length;
    };
    expect(spread(0.1)).toBeGreaterThan(spread(5));
  });

  it('descarta lecturas fuera de la ventana y las invalidas', () => {
    let t = T0;
    const nav = new NavProducts({ k: 1, windowMs: 1000, clock: () => t });
    expect(nav.ingest(reading({ value: Number.NaN }))).toBe(false);
    expect(nav.ingest(reading({ cell: 'xx' }))).toBe(false);
    expect(nav.ingest(reading())).toBe(true);
    t = T0 + 5000;
    expect(nav.compute()).toEqual([]);
  });

  it('publica por la sala de la region p4, firmado, sin contribuyentes ni fuentes', async () => {
    const hub = new LocalMeshHub();
    const pub = hub.createPort('nodo-a');
    const rx = hub.createPort('nodo-b');
    await rx.join('datos', 'd2g6');
    const got: unknown[] = [];
    let verified = false;
    rx.subscribe('datos', TOPIC_NAV, (m) => {
      got.push(m.payload);
      verified = m.verified;
    });
    const nav = new NavProducts({ k: 2, clock: () => hub.now() });
    nav.ingest(reading({ src: 'secreto-1', ts: hub.now() }));
    nav.ingest(reading({ src: 'secreto-2', ts: hub.now() }));
    const sent = await nav.publishRound(pub);
    expect(sent).toHaveLength(1);
    expect(got).toHaveLength(1);
    expect(verified).toBe(true);
    expect(JSON.stringify(got[0])).not.toContain('secreto');
    expect(Object.keys(got[0] as object).sort()).toEqual(['cell', 'eps', 'kind', 'ts', 'v', 'value']);
    expect(parseNavCell(got[0])).not.toBeNull();
  });
});
