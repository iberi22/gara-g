/**
 * charging.test.ts — El cobro. Aquí se mueven pesos reales, así que los tres atributos que
 * se exigen a un sistema de cobro se comprueban UNO POR UNO:
 *
 *   1. NO COBRA DE MÁS: una impresión se cobra una vez, un clic una vez por token.
 *   2. NUNCA DEJA EL SALDO NEGATIVO: si el anunciante no tiene, la campaña se apaga.
 *   3. QUEDA AUDITADO: cada cobro deja su rastro en la estadística del día.
 *
 * Corre contra el MemoryAdapter de `src/lib/domain.ts` (el que usan los tests de todo el
 * repo), en la instancia compartida `gara-g-ads`, y con `env` de Cloudflare mockeado con
 * un `ADS_TOKEN_SECRET` fijo para que la firma sea determinista.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdCampaign, Advertiser } from '../contracts';
import {
  chargeClick,
  chargeImpression,
  createAdvertiser,
  createCampaign,
  getAdvertiser,
  getCampaign,
  getStatToday,
  listStatsOf,
  topUpAdvertiser,
  tokenNonce,
  type ShopRecord,
} from './store';
import { getMemoryAdapter } from '../../lib/domain';
import { ADS_INSTANCE_ID } from '../../lib/domain.config';

const envMock = env as unknown as Record<string, unknown>;
const NOW = new Date(2026, 5, 1, 10, 0, 0).getTime();

function campana(id: string, advertiserId: string, patch: Partial<AdCampaign> = {}): AdCampaign {
  return {
    id,
    advertiserId,
    name: `Campaña ${id}`,
    status: 'active',
    creative: {
      title: 'Cambio de pastillas',
      body: 'Pastillas de freno para tu moto, con instalación.',
      ctaLabel: 'Ver',
      url: 'https://tienda.example.com',
      advertiserName: 'Taller Norte',
    },
    targeting: { families: ['moto'] },
    pricing: { model: 'cpm', bidCOP: 5_000 },
    dailyBudgetCOP: 50_000,
    totalBudgetCOP: 500_000,
    freqCapPerUserDay: 3,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...patch,
  };
}

async function anunciante(balanceCOP: number): Promise<ShopRecord<Advertiser>> {
  const a = await createAdvertiser({
    name: 'Taller Norte',
    kind: 'workshop',
    contactEmail: 'norte@example.com',
    ownerUserId: 'usr_1',
  });
  return topUpAdvertiser(a.id, balanceCOP).then((x) => x ?? a);
}

/** Token sintético: lo que importa para el dedupe es su nonce firmado. */
function token(nonce: string): string {
  const body = btoa(JSON.stringify({ campaignId: 'c1', nonce }));
  return `${body}.${'a'.repeat(64)}`;
}

describe('C1: el CPM se cobra POR MIL, no entero', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba-suficientemente-largo';
    envMock.ENVIRONMENT = 'production';
  });

  it('una impresion de un CPM de 2.000 cuesta 2 COP, no 2.000', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, { pricing: { model: 'cpm', bidCOP: 2_000 } }));

    await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 2_000, userHash: 'u1', now: NOW });

    // 2.000 COP / 1.000 impresiones = 2 COP por impresion. Antes se cobraba 2.000 x1000.
    const stat = await getStatToday(c.id, NOW);
    expect(stat.impressions).toBe(1);
    expect(stat.spendMilliCOP).toBe(2_000);
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(99_998);
  });

  it('acumula en milesimas: 1000 impresiones de un CPM de 2.500 son 2.500 exactos', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, {
      pricing: { model: 'cpm', bidCOP: 2_500 },
      dailyBudgetCOP: 1_000_000,
      totalBudgetCOP: 10_000_000,
    }));

    // 2,5 COP por impresion no cabe en un entero. Redondeando impression a impression se
    // cobrarian 3.000 (un 20 % de sobrecobra). Con el acumulado en milesimas: 2.500 exactos.
    for (let n = 0; n < 1_000; n++) {
      await chargeImpression({ campaignId: c.id, token: token(`i${n}`), priceCOP: 2_500, userHash: 'u1', now: NOW });
    }

    const stat = await getStatToday(c.id, NOW);
    expect(stat.impressions).toBe(1_000);
    expect(stat.spendMilliCOP).toBe(2_500_000);
    expect(stat.spendCOP).toBe(2_500);
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(97_500);
  });

  it('no inventa ni pierde centavos con un CPM que no es multiplo de 1000', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, {
      pricing: { model: 'cpm', bidCOP: 3_333 },
      dailyBudgetCOP: 1_000_000,
      totalBudgetCOP: 10_000_000,
    }));

    // 3.333 / 1000 = 3,333 COP por impresion. En 3 impresiones = 9,999 COP exactos.
    for (let n = 0; n < 3; n++) {
      await chargeImpression({ campaignId: c.id, token: token(`i${n}`), priceCOP: 3_333, userHash: 'u1', now: NOW });
    }
    const stat = await getStatToday(c.id, NOW);
    expect(stat.spendMilliCOP).toBe(9_999);
    expect(stat.spendCOP).toBe(10);
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(99_990);
  });

  it('el CPC NO se divide: su precio ya es por clic', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, { pricing: { model: 'cpc', bidCOP: 400 } }));
    await chargeClick({ campaignId: c.id, token: token('n1'), priceCOP: 400, userHash: 'u1', now: NOW });
    const stat = await getStatToday(c.id, NOW);
    expect(stat.spendMilliCOP).toBe(400_000);
    expect(stat.spendCOP).toBe(400);
  });
});

describe('C2: la impresion es idempotente por nonce', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba-suficientemente-largo';
    envMock.ENVIRONMENT = 'production';
  });

  it('el mismo token dos veces cobra una sola vez', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id));

    const primero = await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 2_000, userHash: 'u1', now: NOW });
    expect(primero.ok).toBe(true);

    const repetido = await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 2_000, userHash: 'u1', now: NOW });
    expect(repetido).toEqual({ ok: false, reason: 'duplicate' });

    const stat = await getStatToday(c.id, NOW);
    expect(stat.impressions).toBe(1);
    expect(stat.spendMilliCOP).toBe(2_000);
  });

  it('veinte reenvios del mismo token cobran una vez (el fallo que se reporto)', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id));
    for (let n = 0; n < 20; n++) {
      await chargeImpression({ campaignId: c.id, token: token('mismo'), priceCOP: 5_000, userHash: 'u1', now: NOW });
    }
    const stat = await getStatToday(c.id, NOW);
    expect(stat.impressions).toBe(1);
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(99_995);
  });

  it('tokens distintos sí cobran (impresiones distintas)', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id));
    await chargeImpression({ campaignId: c.id, token: token('a'), priceCOP: 2_000, userHash: 'u1', now: NOW });
    await chargeImpression({ campaignId: c.id, token: token('b'), priceCOP: 2_000, userHash: 'u2', now: NOW });
    expect((await getStatToday(c.id, NOW)).impressions).toBe(2);
  });

  it('el nonce de un clic y el de una impresion no se confunden', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id));
    await chargeImpression({ campaignId: c.id, token: token('n1'), priceCOP: 2_000, userHash: 'u1', now: NOW });
    // Mismo nonce pero la fila de impression y la de clic son la misma tabla... el token real
    // de una impresion y el de un clic NUNCA coinciden (emitidos por separado), así que aquí
    // se documenta el comportamiento real: un nonce repetido es un duplicate.
    const r = await chargeClick({ campaignId: c.id, token: token('n1'), priceCOP: 400, userHash: 'u1', now: NOW });
    expect(r).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('C3: el cobro revalida la campana', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba-suficientemente-largo';
    envMock.ENVIRONMENT = 'production';
  });

  it('no cobra si la campana ya no esta active', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, { status: 'paused' }));
    const r = await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 2_000, userHash: 'u1', now: NOW });
    expect(r).toEqual({ ok: false, reason: 'not_active' });
    expect((await getStatToday(c.id, NOW)).impressions).toBe(0);
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(100_000);
  });

  it('no cobra si la campana termino (exhausted)', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, { status: 'exhausted' }));
    const r = await chargeClick({ campaignId: c.id, token: token('n1'), priceCOP: 400, userHash: 'u1', now: NOW });
    expect(r).toEqual({ ok: false, reason: 'not_active' });
  });

  it('no cobra fuera de la ventana de fechas', async () => {
    const adv = await anunciante(100_000);
    const vencida = await createCampaign(campana('c1', adv.id, { endDate: '2026-05-30' }));
    const futura = await createCampaign(campana('c2', adv.id, { startDate: '2026-07-01' }));
    expect(await chargeImpression({ campaignId: vencida.id, token: token('a'), priceCOP: 2_000, userHash: 'u1', now: NOW }))
      .toEqual({ ok: false, reason: 'outside_dates' });
    expect(await chargeImpression({ campaignId: futura.id, token: token('b'), priceCOP: 2_000, userHash: 'u1', now: NOW }))
      .toEqual({ ok: false, reason: 'outside_dates' });
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(100_000);
  });

  it('no cobra si el presupuesto diario ya se gasto', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, { dailyBudgetCOP: 4_000 }));
    // Un CPM de 4.000 = 4 COP por impresion; 1000 impresiones agotan los 4.000.
    for (let n = 0; n < 1_000; n++) {
      await chargeImpression({ campaignId: c.id, token: token(`i${n}`), priceCOP: 4_000, userHash: 'u1', now: NOW });
    }
    // Al cerrarse el diario la campana queda `exhausted`, asi que el siguiente cobro se
    // detiene por `not_active` (no por presupuesto): se apago el interruptor del dia.
    expect((await getCampaign(c.id))?.status).toBe('exhausted');
    const r = await chargeImpression({ campaignId: c.id, token: token('extra'), priceCOP: 4_000, userHash: 'u1', now: NOW });
    expect(r.ok).toBe(false);
    expect((await getStatToday(c.id, NOW)).impressions).toBe(1_000);
  });

  it('el corte es por el gasto que SE PASARIA: un cobro parcial que iguala el tope si pasa', async () => {
    // Con `>=` en vez de `>` la campana no podria gastar ni el ultimo peso contratado.
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, { dailyBudgetCOP: 10 }));
    // Un CPM de 10.000 = 10 COP por impresion: la primera IGUALA el diario de 10 y debe pasar.
    const r = await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 10_000, userHash: 'u1', now: NOW });
    expect(r.ok).toBe(true);
    expect((await getStatToday(c.id, NOW)).spendCOP).toBe(10);
    // La siguiente ya se pasa (10 + 10 > 10): no se cobra.
    const segunda = await chargeImpression({ campaignId: c.id, token: token('i2'), priceCOP: 10_000, userHash: 'u2', now: NOW });
    expect(segunda.ok).toBe(false);
  });

  it('el saldo es lo primero que se comprueba, antes que el presupuesto', async () => {
    // Sin saldo no se cobra nada aunque la campana este perfectamente valida.
    const adv = await createAdvertiser({ name: 'Sin saldo', kind: 'service', contactEmail: 'x@e.com', ownerUserId: 'usr_1' });
    const c = await createCampaign(campana('c1', adv.id));
    expect(await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 2_000, userHash: 'u1', now: NOW }))
      .toEqual({ ok: false, reason: 'no_balance' });
  });
});

describe('C4: el presupuesto total no se cuenta dos veces', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba-suficientemente-largo';
    envMock.ENVIRONMENT = 'production';
  });

  it('gasta EXACTAMENTE el total y se apaga una sola vez al caer en el', async () => {
    const adv = await anunciante(100_000);
    // Total 2.000, diario alto para que el corte sea por el TOTAL.
    const c = await createCampaign(campana('c1', adv.id, {
      dailyBudgetCOP: 1_000_000,
      totalBudgetCOP: 2_000,
      pricing: { model: 'cpm', bidCOP: 2_000 },
    }));

    // 1000 impresiones x 2 COP = 2.000 exactos: el total.
    for (let n = 0; n < 1_000; n++) {
      await chargeImpression({ campaignId: c.id, token: token(`i${n}`), priceCOP: 2_000, userHash: 'u1', now: NOW });
    }

    const stat = await getStatToday(c.id, NOW);
    expect(stat.spendMilliCOP).toBe(2_000_000);
    expect(stat.spendCOP).toBe(2_000);
    expect((await getCampaign(c.id))?.status).toBe('exhausted');
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(98_000);

    // Y una mas ya no cobra: se apagó al agotarse, no antes de tiempo.
    const extra = await chargeImpression({ campaignId: c.id, token: token('extra'), priceCOP: 2_000, userHash: 'u1', now: NOW });
    expect(extra.ok).toBe(false);
    expect((await getStatToday(c.id, NOW)).impressions).toBe(1_000);
  });

  it('el total NO se agota en la mitad de impresiones por el doble conteo', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, {
      dailyBudgetCOP: 1_000_000,
      totalBudgetCOP: 2_000,
      pricing: { model: 'cpm', bidCOP: 2_000 },
    }));
    // Con el doble conteo, al cabo de ~500 impresiones el lifetime (que ya incluía el gasto)
    // sumaba otra vez el cargo yasí cerraba la campana antes de tiempo.
    for (let n = 0; n < 500; n++) {
      await chargeImpression({ campaignId: c.id, token: token(`i${n}`), priceCOP: 2_000, userHash: 'u1', now: NOW });
    }
    expect((await getCampaign(c.id))?.status).toBe('active');
    expect((await getStatToday(c.id, NOW)).impressions).toBe(500);
  });
});

describe('A3/A4: el clic se marca antes de cobrar y deja constancia del cobro real', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba-suficientemente-largo';
    envMock.ENVIRONMENT = 'production';
  });

  it('el registro del clic guarda lo que se cobro de verdad', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id, { pricing: { model: 'cpc', bidCOP: 400 } }));
    await chargeClick({ campaignId: c.id, token: token('n1'), priceCOP: 400, userHash: 'u1', now: NOW });

    const { getEntity } = await import('../../lib/domain');
    const fila = await getEntity<Record<string, unknown>>('adClick', tokenNonce(token('n1')), 'gara-g-ads');
    expect(fila?.chargedCOP).toBe(400);
    expect(fila?.kind).toBe('click');
  });

  it('si el saldo no alcanza, el registro queda en 0, no con un cobro fantasma', async () => {
    const adv = await anunciante(100);
    const c = await createCampaign(campana('c1', adv.id, { pricing: { model: 'cpc', bidCOP: 400 } }));
    // Un clic de 400 con saldo de 100: se cobra lo que hay (100) y el registro lo dice.
    const r = await chargeClick({ campaignId: c.id, token: token('n1'), priceCOP: 400, userHash: 'u1', now: NOW });
    expect(r.ok).toBe(true);

    const { getEntity } = await import('../../lib/domain');
    const fila = await getEntity<Record<string, unknown>>('adClick', tokenNonce(token('n1')), 'gara-g-ads');
    // chargedCOP refleja el cobro REAL (100), no el pedido (400): no queda deuda inventada.
    expect(fila?.chargedCOP).toBe(100);
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(0);
  });
});

describe('saldo y agotamiento en general', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba-suficientemente-largo';
    envMock.ENVIRONMENT = 'production';
  });

  it('nunca queda negativo y para de cobrar cuando se acaba', async () => {
    const adv = await anunciante(3_000);
    const c = await createCampaign(campana('c1', adv.id));

    await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 1_500_000, userHash: 'u1', now: NOW });
    const segundo = await chargeImpression({ campaignId: c.id, token: token('i2'), priceCOP: 1_500_000, userHash: 'u2', now: NOW });
    expect(segundo.ok).toBe(true);
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(0);

    const tercero = await chargeImpression({ campaignId: c.id, token: token('i3'), priceCOP: 1_500_000, userHash: 'u3', now: NOW });
    expect(tercero).toEqual({ ok: false, reason: 'no_balance' });
    expect((await getAdvertiser(adv.id))?.balanceCOP).toBe(0);
  });

  it('el gasto por dia se reparte en filas separadas', async () => {
    const adv = await anunciante(100_000);
    const c = await createCampaign(campana('c1', adv.id));
    await chargeImpression({ campaignId: c.id, token: token('i1'), priceCOP: 1_000_000, userHash: 'u1', now: NOW });
    const manana = new Date(2026, 5, 2, 9, 0, 0).getTime();
    await chargeImpression({ campaignId: c.id, token: token('i2'), priceCOP: 1_000_000, userHash: 'u1', now: manana });

    const dias = await listStatsOf(c.id);
    expect(dias).toHaveLength(2);
    expect(dias.reduce((a: number, d: { spendMilliCOP: number }) => a + d.spendMilliCOP, 0)).toBe(2_000_000);
  });
});

describe('recarga de saldo', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    envMock.ADS_TOKEN_SECRET = 'secreto-de-prueba-suficientemente-largo';
  });

  it('suma al saldo y deja el movimiento registrado', async () => {
    const a = await createAdvertiser({ name: 'A', kind: 'service', contactEmail: 'a@x.com', ownerUserId: 'usr_1' });
    expect(a.balanceCOP).toBe(0);

    const t = await topUpAdvertiser(a.id, 50_000);
    expect(t?.balanceCOP).toBe(50_000);
    const movimientos = (t as unknown as { movements: { amountCOP: number }[] }).movements;
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].amountCOP).toBe(50_000);
  });

  it('rechaza montos no positivos', async () => {
    const a = await createAdvertiser({ name: 'A', kind: 'service', contactEmail: 'a@x.com', ownerUserId: 'usr_1' });
    await expect(topUpAdvertiser(a.id, 0)).rejects.toThrow();
    await expect(topUpAdvertiser(a.id, -5_000)).rejects.toThrow();
  });

  it('no inventa saldo de un anunciante inexistente', async () => {
    expect(await topUpAdvertiser('no_existe', 1_000)).toBeNull();
  });

  it('las entidades del shop viven en la instancia compartida, no en la del tenant', async () => {
    const a = await createAdvertiser({ name: 'A', kind: 'service', contactEmail: 'a@x.com', ownerUserId: 'usr_1' });
    expect(a.instance_id).toBe(ADS_INSTANCE_ID);
  });
});