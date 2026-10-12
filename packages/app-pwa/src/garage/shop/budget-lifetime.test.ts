/**
 * budget-lifetime.test.ts — al cobrar, el tope TOTAL se mide contra el gasto de toda la
 * campaña, no contra el del dia. Antes la revalidacion comparaba el gasto de HOY con el
 * presupuesto total, asi que el segundo dia una campaña podia cobrar por encima de su total
 * mientras quedaran tokens servidos (30 min de vida) antes de pasar a `exhausted`.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdCampaign } from '../contracts';
import { getMemoryAdapter } from '../../lib/domain';
import { chargeClick, createAdvertiser, createCampaign, getAdvertiser, patchCampaign, topUpAdvertiser } from './store';

const envMock = env as unknown as Record<string, unknown>;
const DIA1 = new Date(2026, 5, 1, 10, 0, 0).getTime();
const DIA2 = new Date(2026, 5, 2, 10, 0, 0).getTime();

function token(nonce: string): string {
  return `${btoa(JSON.stringify({ campaignId: 'c1', nonce }))}.${'a'.repeat(64)}`;
}

describe('tope total al cobrar', () => {
  beforeEach(() => {
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba';
    getMemoryAdapter().clear();
    envMock.ENVIRONMENT = 'production';
  });

  it('el dia 2 no cobra si el dia 1 ya consumio el presupuesto total', async () => {
    const a = await createAdvertiser({ name: 'Taller', kind: 'workshop', contactEmail: 't@example.com', ownerUserId: 'u' });
    await topUpAdvertiser(a.id, 1_000_000);
    const campaign: Omit<AdCampaign, 'id' | 'createdAt'> = {
      advertiserId: a.id,
      name: 'CPC',
      status: 'active',
      creative: { title: 'x', body: 'y', ctaLabel: 'Ver', url: 'https://t.example.com', advertiserName: 'Taller' },
      targeting: {},
      pricing: { model: 'cpc', bidCOP: 400 },
      dailyBudgetCOP: 1_000,
      totalBudgetCOP: 1_000,
      freqCapPerUserDay: 0,
    };
    const c = await createCampaign(campaign);

    const d1 = await chargeClick({ campaignId: c.id, token: token('k1'), priceCOP: 1_000, userHash: 'u1', now: DIA1 });
    expect(d1.ok).toBe(true);
    // Aunque applySpend la marque exhausted, se reactiva a mano para probar la barrera del cobro.
    await patchCampaign(c.id, { status: 'active' });
    const saldoAntes = (await getAdvertiser(a.id))?.balanceCOP;

    const d2 = await chargeClick({ campaignId: c.id, token: token('k2'), priceCOP: 400, userHash: 'u2', now: DIA2 });
    expect(d2).toMatchObject({ ok: false, reason: 'total_budget_exhausted' });
    expect((await getAdvertiser(a.id))?.balanceCOP).toBe(saldoAntes);
  });
});

describe('tope diario sin redondeos', () => {
  beforeEach(() => {
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba';
    getMemoryAdapter().clear();
    envMock.ENVIRONMENT = 'production';
  });

  it('2,4 + 2,4 COP no caben en un tope de 4 COP (antes se redondeaba 2 + 2 = 4 y pasaba)', async () => {
    const a = await createAdvertiser({ name: 'Taller', kind: 'workshop', contactEmail: 't@example.com', ownerUserId: 'u' });
    await topUpAdvertiser(a.id, 1_000_000);
    const c = await createCampaign({
      advertiserId: a.id,
      name: 'CPM',
      status: 'active',
      creative: { title: 'x', body: 'y', ctaLabel: 'Ver', url: 'https://t.example.com', advertiserName: 'Taller' },
      targeting: {},
      pricing: { model: 'cpm', bidCOP: 2_400 },
      dailyBudgetCOP: 4,
      totalBudgetCOP: 1_000,
      freqCapPerUserDay: 0,
    });
    const { chargeImpression } = await import('./store');
    const first = await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 2_400, userHash: 'u1', now: DIA1 });
    expect(first.ok).toBe(true);
    const second = await chargeImpression({ campaignId: c.id, token: token('i2'), priceCOP: 2_400, userHash: 'u1', now: DIA1 });
    expect(second).toMatchObject({ ok: false, reason: 'daily_budget_exhausted' });
  });
});
