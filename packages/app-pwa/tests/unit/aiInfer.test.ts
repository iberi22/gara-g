import { describe, it, expect } from 'vitest';
import { POST, OPTIONS } from '../../src/pages/api/ai/infer.js';
import { TIER_LABEL } from '../../src/lib/domain.config.js';

describe('/api/ai/infer Endpoint Unit Tests', () => {
  it('handles OPTIONS preflight with 204 status', async () => {
    const res = await (OPTIONS as any)({ request: new Request('http://localhost/api/ai/infer', { method: 'OPTIONS' }) });
    expect(res.status).toBe(204);
  });

  it('rejects empty or missing prompt with 400', async () => {
    const req = new Request('http://localhost/api/ai/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    const res = await (POST as any)({ request: req });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('prompt requerido');
  });

  it('gates free and mesh-only tiers with 402 Payment Required', async () => {
    const reqFree = new Request('http://localhost/api/ai/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Generar métricas', tierId: 'free' }),
    });
    const resFree = await (POST as any)({ request: reqFree });
    expect(resFree.status).toBe(402);
    const dataFree = await resFree.json();
    // El nombre del tier sale de domain.config.ts: no queda el tier heredado "Socio".
    expect(dataFree.error).toContain(TIER_LABEL);
    expect(dataFree.error).not.toContain('Socio');

    const reqMesh = new Request('http://localhost/api/ai/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Generar métricas', tierId: 'mesh-only' }),
    });
    const resMesh = await (POST as any)({ request: reqMesh });
    expect(resMesh.status).toBe(402);
  });

  it('allows payg socio tier and returns valid AuiSpec with offline fallback', async () => {
    const req = new Request('http://localhost/api/ai/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Generar tabla de mantenimiento preventivo', tierId: 'payg' }),
    });
    const res = await (POST as any)({ request: req });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tokensUsed).toBeGreaterThan(0);
    expect(data.cost).toBeGreaterThan(0);
    expect(data.spec).toBeDefined();
    expect(data.spec.version).toBe(1);
    expect(Array.isArray(data.spec.components)).toBe(true);
    expect(data.spec.components.length).toBeGreaterThan(0);
  });
});
