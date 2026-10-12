import { describe, expect, it } from 'vitest';
import type { MeshMessage } from './contracts';
import { LocalMeshHub } from './localHub';

describe('LocalMeshHub', () => {
  it('entrega solo a los pares de la misma red y sala', async () => {
    const hub = new LocalMeshHub();
    const a = hub.createPort('a');
    const b = hub.createPort('b');
    const c = hub.createPort('c');
    await a.join('v2v', 'd2g64m');
    await b.join('v2v', 'd2g64m');
    await c.join('datos', 'd2g64m');
    const gotB: MeshMessage[] = [];
    const gotC: MeshMessage[] = [];
    b.subscribe('v2v', 'pos', (m) => gotB.push(m));
    c.subscribe('datos', 'pos', (m) => gotC.push(m));
    await a.publish('v2v', 'd2g64m', 'pos', { x: 1 });
    expect(gotB).toHaveLength(1);
    expect(gotB[0]).toMatchObject({ from: 'a', payload: { x: 1 }, verified: false });
    expect(gotC).toHaveLength(0);
    expect(a.peerCount('v2v', 'd2g64m')).toBe(1);
  });

  it('marca verificado lo firmado y descarta lo que llega vencido', async () => {
    // Reloj que avanza 10 s entre la emision (1.a lectura) y la entrega (2.a lectura).
    const reads = [1000, 11_000];
    let i = 0;
    const hub = new LocalMeshHub(() => reads[Math.min(i++, reads.length - 1)]);
    const a = hub.createPort('a');
    const b = hub.createPort('b');
    await a.join('v2v', 'r');
    await b.join('v2v', 'r');
    const got: MeshMessage[] = [];
    b.subscribe('v2v', 'peligro', (m) => got.push(m));
    await a.publish('v2v', 'r', 'peligro', { n: 1 }, { sign: true, ttlMs: 5000 });
    expect(got).toHaveLength(0);
    i = 0;
    await a.publish('v2v', 'r', 'peligro', { n: 2 }, { sign: true, ttlMs: 60_000 });
    expect(got).toHaveLength(1);
    expect(got[0].verified).toBe(true);
  });
});
