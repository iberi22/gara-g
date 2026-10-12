/**
 * tests/cloud-local.test.ts — Sin el modulo cloud (build publico) la app no factura, no cobra
 * ni ancla nada, y las rutas de pago responden 404 "cloud disabled". Ver src/cloud/.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_DISABLED, cloud } from '../src/cloud';
import { llmComplete } from '../src/lib/llm';
import { POST as stripeWebhook } from '../src/pages/api/webhooks/stripe';

afterEach(() => vi.unstubAllGlobals());

describe('modulo cloud local (por defecto)', () => {
  it('esta apagado: sin facturacion ni anclaje', () => {
    expect(cloud.enabled).toBe(false);
    expect(cloud.billing.canAffordInference(1_000_000, 1_000_000, 'payg')).toBe(true);
    expect(cloud.billing.creditStatus(5, 'payg').limit).toBe(Number.POSITIVE_INFINITY);
    expect(cloud.anchor.registerOnPolygon({} as any, {})).toBeUndefined();
  });

  it('mesh-only y free siguen sin inferencia cloud (mismo criterio que antes)', () => {
    expect(cloud.billing.isMeshOnlyMode('mesh-only')).toBe(true);
    expect(cloud.billing.isMeshOnlyMode('free')).toBe(true);
    expect(cloud.billing.isMeshOnlyMode('swal-managed')).toBe(false);
  });

  it('POST /api/webhooks/stripe responde 404 {"error":"cloud disabled"}', async () => {
    const res = await stripeWebhook({
      request: new Request('https://gara-g.swal.network/api/webhooks/stripe', { method: 'POST', body: '{}' }),
    } as any);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: CLOUD_DISABLED });
  });

  it('la inferencia no llama a la nube: cfAiInfer devuelve null y llm usa el camino local', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('window', {});
    expect(await cloud.billing.cfAiInfer('hola')).toBeNull();
    const out = await llmComplete({ prompt: 'estado de la flota', tierId: 'socio' });
    expect(out.via).toBe('local');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ningun fichero de src/ importa la facturacion ni el SDK econ directamente', () => {
    const files = ['src/lib/llm.ts', 'src/lib/telemetry.ts', 'src/lib/sealedPack.ts', 'src/pages/api/ai/infer.ts'];
    for (const f of files) {
      const code = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(code, f).not.toMatch(/billing(\.core)?(\.js)?['"]/);
      expect(code, f).not.toContain('@swal/econ-sdk');
    }
  });
});
