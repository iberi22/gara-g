/**
 * probe.test.ts — el sondeo de WebGPU nunca deja colgado el montaje del motor.
 */
import { describe, expect, it } from 'vitest';
import { probeWebGPU } from './index';

describe('probeWebGPU', () => {
  it('false sin navigator.gpu', async () => {
    expect(await probeWebGPU(50, undefined)).toBe(false);
  });
  it('true con adaptador', async () => {
    expect(await probeWebGPU(50, { requestAdapter: async () => ({}) })).toBe(true);
  });
  it('false con adaptador null o error', async () => {
    expect(await probeWebGPU(50, { requestAdapter: async () => null })).toBe(false);
    expect(await probeWebGPU(50, { requestAdapter: async () => { throw new Error('x'); } })).toBe(false);
  });
  it('false si requestAdapter no responde nunca (no se cuelga)', async () => {
    const t0 = Date.now();
    expect(await probeWebGPU(60, { requestAdapter: () => new Promise(() => {}) })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
