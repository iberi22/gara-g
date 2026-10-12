import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalMeshHub } from '../localHub';
import { createDemoWorld } from './demo';
import { acquireV2VPort } from './port';
import { createV2VNode } from './v2vNode';

afterEach(() => vi.useRealTimers());

describe('puerto del radar', () => {
  it('devuelve siempre un puerto utilizable (real si existe node.ts, hub en memoria si no)', async () => {
    const a = await acquireV2VPort();
    expect(typeof a.portFactory).toBe('function');
    if (a.simulated) {
      const p1 = await a.portFactory();
      const p2 = await a.portFactory();
      // Cada llamada es un puerto distinto: de ahi sale un `from` distinto por ranura.
      expect(p1.nodeId).not.toBe(p2.nodeId);
      await p1.close();
      await p2.close();
    }
  });
});

describe('mundo de demostracion', () => {
  it('el nodo ve a los coches simulados y acaba en peligro por el que viene de frente', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const hub = new LocalMeshHub();
    const world = createDemoWorld((id) => hub.createPort(id));
    const node = createV2VNode({
      portFactory: async () => hub.createPort('yo'),
      geo: world.geo,
      motion: { start: async () => ({ ok: false, reason: 'test' }), stop() {} },
    });
    await node.start();
    let danger = false;
    for (let s = 0; s < 14; s++) {
      await vi.advanceTimersByTimeAsync(1000);
      if (node.getState().level === 'peligro') danger = true;
    }
    const st = node.getState();
    expect(st.status).toBe('active');
    expect(st.nearby).toBeGreaterThanOrEqual(2);
    expect(danger).toBe(true);
    await node.stop();
    world.stop();
  });
});
