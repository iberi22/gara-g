/**
 * auction.test.ts — La subasta, que es la parte que mueve plata.
 *
 * Cada filtro tiene su propio caso y se comprueba la RAZON de exclusion, no solo que la
 * campana no aparezca: sin el motivo, el anunciante que pregunta "por que no sale mi
 * anuncio" no tiene nada que leer en el log. Los casos de precio son exactos a proposito
 * (segundo precio en CPM, en CPC y mixto): una aproximacion aqui es plata que se le
 * cobra de mas a alguien.
 */
import { describe, expect, it } from 'vitest';
import type { AdCampaign, AdContext, Advertiser } from '../contracts';
import {
  CPM_FLOOR_COP,
  CPC_FLOOR_COP,
  bayesianPCtr,
  priceFloorCOP,
  runAuction,
  type AuctionCandidate,
  type AuctionOptions,
} from './auction';

/** Momento fijo: 2026-06-01 10:00 hora local. Controla fechas y fraccion de dia. */
const NOW = new Date(2026, 5, 1, 10, 0, 0).getTime();

function advertiser(id: string, balanceCOP = 100_000): Advertiser {
  return {
    id,
    name: `Anunciante ${id}`,
    kind: 'workshop',
    contactEmail: `${id}@example.com`,
    balanceCOP,
    verified: true,
    ownerUserId: 'usr_owner',
  };
}

function campaign(id: string, patch: Partial<AdCampaign> = {}): AdCampaign {
  return {
    id,
    advertiserId: `adv_${id}`,
    name: `Campaña ${id}`,
    status: 'active',
    creative: {
      title: `Título ${id}`,
      body: `Cuerpo del anuncio ${id}`,
      ctaLabel: 'Ver',
      url: 'https://example.com',
      advertiserName: `Anunciante ${id}`,
    },
    targeting: {},
    pricing: { model: 'cpm', bidCOP: 10_000 },
    dailyBudgetCOP: 50_000,
    totalBudgetCOP: 500_000,
    freqCapPerUserDay: 3,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...patch,
  };
}

function candidate(id: string, patch: Partial<AdCampaign> = {}, extra: Partial<AuctionCandidate> = {}): AuctionCandidate {
  const c = campaign(id, patch);
  return { campaign: c, advertiser: extra.advertiser ?? advertiser(c.advertiserId), ...extra };
}

function ctx(patch: Partial<AdContext> = {}): AdContext {
  return {
    slot: 'shop_feed',
    family: 'moto',
    body: 'naked',
    make: 'Yamaha',
    model: 'FZ16',
    versionKey: 'yamaha-fz16-2018-2024',
    city: 'Bogotá',
    userHash: 'hash-usuario-1',
    ...patch,
  };
}

/** `rand` fijo: no frena nada por ritmo (0 siempre pasa) o frena siempre (1 siempre). */
function opts(patch: Partial<AuctionOptions> = {}): AuctionOptions {
  return { slots: 3, now: NOW, rand: () => 0, ...patch };
}

function reasonOf(excluded: { campaignId: string; reason: string }[], campaignId: string): string | undefined {
  return excluded.find((e) => e.campaignId === campaignId)?.reason;
}

describe('filtros: cada uno deja una razón auditable', () => {
  it('excluye la campaña que no está activa', () => {
    const r = runAuction([candidate('c1', { status: 'pending_review' })], ctx(), opts());
    expect(r.winners).toHaveLength(0);
    expect(reasonOf(r.excluded, 'c1')).toBe('not_active');
    expect(r.excluded[0].detail).toContain('pending_review');
  });

  it('excluye fuera de la ventana de fechas', () => {
    const pasada = candidate('c1', { endDate: '2026-05-30' });
    const futura = candidate('c2', { startDate: '2026-07-01' });
    const r = runAuction([pasada, futura], ctx(), opts());
    expect(reasonOf(r.excluded, 'c1')).toBe('outside_dates');
    expect(reasonOf(r.excluded, 'c2')).toBe('outside_dates');
  });

  it('excluye con el presupuesto diario ya gastado', () => {
    const r = runAuction(
      [candidate('c1', { dailyBudgetCOP: 10_000 }, { today: { campaignId: 'c1', day: '2026-06-01', impressions: 5, clicks: 0, spendCOP: 10_000, freq: {} } })],
      ctx(),
      opts(),
    );
    expect(reasonOf(r.excluded, 'c1')).toBe('daily_budget_exhausted');
  });

  it('excluye con el presupuesto total ya gastado', () => {
    const r = runAuction([candidate('c1', { totalBudgetCOP: 200_000 }, { lifetimeSpendCOP: 200_000 })], ctx(), opts());
    expect(reasonOf(r.excluded, 'c1')).toBe('total_budget_exhausted');
  });

  it('excluye al anunciante sin saldo', () => {
    const r = runAuction([candidate('c1', {}, { advertiser: advertiser('adv_c1', 0) })], ctx(), opts());
    expect(reasonOf(r.excluded, 'c1')).toBe('no_balance');
    expect(r.excluded[0].detail).toContain('0');
  });

  it('excluye cuando la segmentación no coincide', () => {
    const r = runAuction([candidate('c1', { targeting: { makes: ['Honda'] } })], ctx(), opts());
    expect(reasonOf(r.excluded, 'c1')).toBe('not_targeted');
  });

  it('excluye al usuario que ya vio el tope de frecuencia', () => {
    const r = runAuction(
      [candidate('c1', { freqCapPerUserDay: 2 }, {
        today: { campaignId: 'c1', day: '2026-06-01', impressions: 2, clicks: 0, spendCOP: 0, freq: { 'hash-usuario-1': 2 } },
      })],
      ctx(),
      opts(),
    );
    expect(reasonOf(r.excluded, 'c1')).toBe('freq_cap');
  });

  it('el tope de frecuencia cuenta por usuario, no global', () => {
    const r = runAuction(
      [candidate('c1', { freqCapPerUserDay: 2 }, {
        today: { campaignId: 'c1', day: '2026-06-01', impressions: 7, clicks: 0, spendCOP: 0, freq: { 'otro-usuario': 7 } },
      })],
      ctx(),
      opts(),
    );
    expect(r.winners).toHaveLength(1);
  });

  it('excluye por ritmo cuando ya se gastó de más para esta hora, con rand = 1', () => {
    // 10:00 → fracción de día ≈ 0.4167. Con presupuesto 10.000, el ritmo permite ≈ 5.000.
    const r = runAuction(
      [candidate('c1', { dailyBudgetCOP: 10_000 }, {
        today: { campaignId: 'c1', day: '2026-06-01', impressions: 3, clicks: 0, spendCOP: 9_000, freq: {} },
      })],
      ctx(),
      opts({ rand: () => 1 }),
    );
    expect(reasonOf(r.excluded, 'c1')).toBe('pacing');
  });

  it('el mismo caso de ritmo ENTRA con rand = 0 (el azar frena, no mata)', () => {
    const r = runAuction(
      [candidate('c1', { dailyBudgetCOP: 10_000 }, {
        today: { campaignId: 'c1', day: '2026-06-01', impressions: 3, clicks: 0, spendCOP: 9_000, freq: {} },
      })],
      ctx(),
      opts({ rand: () => 0 }),
    );
    expect(r.winners).toHaveLength(1);
  });

  it('a media mañana NO penaliza el ritmo si el gasto va a su tiempo', () => {
    const r = runAuction(
      [candidate('c1', { dailyBudgetCOP: 10_000 }, {
        today: { campaignId: 'c1', day: '2026-06-01', impressions: 3, clicks: 0, spendCOP: 3_000, freq: {} },
      })],
      ctx(),
      opts({ rand: () => 1 }),
    );
    expect(r.winners).toHaveLength(1);
  });
});

describe('puntaje: eCPM × relevancia', () => {
  it('ordena por puntaje, no por puja', () => {
    const alta = candidate('alta', { pricing: { model: 'cpm', bidCOP: 30_000 }, targeting: { makes: ['yamaha'] } });
    const baja = candidate('baja', { pricing: { model: 'cpm', bidCOP: 25_000 }, targeting: { makes: ['yamaha'] } });
    const r = runAuction([baja, alta], ctx(), opts());
    // relevance 0.8 en ambos: 30.000×0.8 = 24.000 > 25.000×0.8 = 20.000
    expect(r.winners.map((w) => w.campaignId)).toEqual(['alta', 'baja']);
  });

  it('a igualdad de puja gana la segmentación más específica', () => {
    const porVersion = candidate('v', { targeting: { versionKeys: ['yamaha-fz16-2018-2024'] } });
    const sinSegmentar = candidate('n', { targeting: {} });
    const r = runAuction([sinSegmentar, porVersion], ctx(), opts());
    expect(r.winners[0].campaignId).toBe('v');
    expect(r.winners[0].relevance).toBe(1);
  });

  it('el eCPM de una campaña CPC usa el pCTR bayesiano', () => {
    // 2 clics / 200 impresiones → (2+1)/(200+100) = 1 %.
    const r = runAuction(
      [candidate('cpc', { pricing: { model: 'cpc', bidCOP: 500 }, targeting: { makes: ['yamaha'] } }, { lifetime: { impressions: 200, clicks: 2 } })],
      ctx(),
      opts(),
    );
    expect(r.winners[0].pCtr).toBeCloseTo(0.01, 6);
    expect(r.winners[0].eCpmCOP).toBeCloseTo(500 * 0.01 * 1000, 6);
  });

  it('sin historial, el pCTR es el prior del 1 % (una campaña nueva no queda fuera)', () => {
    expect(bayesianPCtr(0, 0)).toBeCloseTo(0.01, 9);
  });
});

describe('segundo precio generalizado', () => {
  it('CPM: el ganador paga lo justo para conservar el puesto contra el siguiente', () => {
    // Ambos sin segmentar (rel 0.5). a gana; paraConservar necesita eCPM = 20.000.
    const a = candidate('a', { pricing: { model: 'cpm', bidCOP: 50_000 } });
    const b = candidate('b', { pricing: { model: 'cpm', bidCOP: 20_000 } });
    const r = runAuction([a, b], ctx(), opts());
    expect(r.winners.map((w) => w.campaignId)).toEqual(['a', 'b']);
    // score_b / rel_a = 20.000×0.5/0.5 = 20.000, +1 COP
    expect(r.winners[0].priceCOP).toBe(20_001);
    // El ultimo SIN rival paga el PISO (precio de reserva), no su puja entera.
    expect(r.winners[1].priceCOP).toBe(CPM_FLOOR_COP);
  });

  it('CPM: nunca cobra más que la puja', () => {
    // a puja 5.000 (score 2.500) y b puja 100.000 (score 50.000): gana b, y a es el ultimo,
    // asi que paga su puja exacta, ni un peso mas aunque "pudiera" pagarse el piso.
    const a = candidate('a', { pricing: { model: 'cpm', bidCOP: 5_000 } });
    const b = candidate('b', { pricing: { model: 'cpm', bidCOP: 100_000 } });
    const r = runAuction([a, b], ctx(), opts());
    expect(r.winners.map((w) => w.campaignId)).toEqual(['b', 'a']);
    // Para conservarlo, b necesitaria 2.500/0.5 + 1 = 5.001, muy por debajo de su puja.
    expect(r.winners[0].priceCOP).toBe(5_001);
    // El ultimo (a) paga el piso: sin competencia, manda el precio de reserva, no la puja.
    expect(r.winners[1].priceCOP).toBe(CPM_FLOOR_COP);
  });

  it('CPM: sin competencia paga el piso (precio de reserva), no su puja', () => {
    // Ronda 2 (5): en segunda precio el valor de un slot sin competencia es el piso, no la
    // puja. Antes pagaba 3.000; ahora paga el minimo del slot.
    const solo = candidate('solo', { pricing: { model: 'cpm', bidCOP: 3_000 } });
    expect(runAuction([solo], ctx(), opts()).winners[0].priceCOP).toBe(CPM_FLOOR_COP);
  });

  it('CPM: una puja BAJO el piso no entra a la subasta (precio de reserva)', () => {
    const solo = candidate('solo', { pricing: { model: 'cpm', bidCOP: 500 } });
    const r = runAuction([solo], ctx(), opts());
    expect(r.winners).toHaveLength(0);
    expect(r.excluded).toEqual([expect.objectContaining({ campaignId: 'solo', reason: 'below_floor' })]);
  });

  it('CPM: el piso de 2.000 COP cuando lo justo para ganar queda por debajo', () => {
    // a puja 2.500 contra b, que puja justo el piso (2.000) pero con menos relevancia: lo
    // justo para conservar el puesto queda por debajo del piso, asi que a paga el piso.
    // a segmenta por la version exacta (relevancia 1.0); b no segmenta (0.5).
    const a = candidate('a', { pricing: { model: 'cpm', bidCOP: 2_500 }, targeting: { versionKeys: ['yamaha-fz16-2018-2024'] } });
    const b = candidate('b', { pricing: { model: 'cpm', bidCOP: 2_000 }, targeting: {} });
    const r = runAuction([a, b], ctx(), opts());
    expect(r.winners.map((w) => w.campaignId)).toEqual(['a', 'b']);
    expect(r.winners[0].priceCOP).toBe(CPM_FLOOR_COP);
  });

  it('CPC: el precio se pide en clics, no en eCPM', () => {
    // a: 10.000 COP/clic, pCTR 1 % → eCPM 100.000. b: 200 COP/clic, pCTR 1 % → eCPM 20.000.
    const a = candidate('a', { pricing: { model: 'cpc', bidCOP: 10_000 } });
    const b = candidate('b', { pricing: { model: 'cpc', bidCOP: 200 } });
    const r = runAuction([a, b], ctx(), opts());
    expect(r.winners[0].campaignId).toBe('a');
    // a (bid 10.000 → eCPM 10.000, score 5.000) gana; b (bid 200 → eCPM 2.000, score 1.000).
    // Para conservarlo a necesita eCPM = score_b / relevancia_a = 1.000 / 0.5 = 2.000,
    // y el precio de esa eCPM en clics es 2.000 / (0.01 × 1000) = 200 COP/clic, +1 COP.
    expect(r.winners[0].priceCOP).toBe(201);
  });

  it('CPC: sin competencia paga el piso de 150 COP/clic, no su puja', () => {
    const solo = candidate('solo', { pricing: { model: 'cpc', bidCOP: 300 } });
    expect(runAuction([solo], ctx(), opts()).winners[0].priceCOP).toBe(CPC_FLOOR_COP);
  });

  it('CPC: el piso es 150 COP por clic, no el de CPM', () => {
    // a puja 2.000/clic (eCPM 20.000) contra b a 100/clic (eCPM 100): lo justo para ganarle
    // serian ~100 COP/clic, pero el piso del modelo CPC es 150.
    const a = candidate('a', { pricing: { model: 'cpc', bidCOP: 2_000 } });
    const b = candidate('b', { pricing: { model: 'cpc', bidCOP: 100 } });
    const r = runAuction([a, b], ctx(), opts());
    expect(r.winners[0].priceCOP).toBe(CPC_FLOOR_COP);
    expect(priceFloorCOP('cpc')).toBe(150);
    expect(priceFloorCOP('cpm')).toBe(CPM_FLOOR_COP);
  });

  it('mixto: el segundo precio de un ganador CPM lo fija una campaña CPC', () => {
    // CPM 30.000 sin segmentar → eCPM 30.000, score 15.000.
    // CPC 200 con pCTR 1 % → eCPM 200 × 0,01 × 1000 = 2.000, score 1.000.
    const cpm = candidate('cpm', { pricing: { model: 'cpm', bidCOP: 30_000 } });
    const cpc = candidate('cpc', { pricing: { model: 'cpc', bidCOP: 200 } });
    const r = runAuction([cpm, cpc], ctx(), opts());
    expect(r.winners.map((w) => w.campaignId)).toEqual(['cpm', 'cpc']);
    // Para conservarlo, cpm necesita eCPM = score_cpc / relevancia = 1.000 / 0,5 = 2.000, +1 COP.
    // Nota: el eCPM del rival se "descuenta" por la relevancia propia, asi que una campaña
    // sin segmentar (0,5) tiene que igualar el doble del eCPM del rival.
    expect(r.winners[0].priceCOP).toBe(2_001);
  });

  it('con pCTR alto, el rival CPC es mucho más peligroso de lo que parece', () => {
    // 20 clics / 100 impresiones → (20+1)/(100+100) = 10.5 % → eCPM 21.000.
    const cpm = candidate('cpm', { pricing: { model: 'cpm', bidCOP: 20_000 } });
    const cpc = candidate('cpc', { pricing: { model: 'cpc', bidCOP: 200 } }, { lifetime: { impressions: 100, clicks: 20 } });
    const r = runAuction([cpm, cpc], ctx(), opts());
    expect(r.winners.map((w) => w.campaignId)).toEqual(['cpc', 'cpm']);
    // El CPC necesita eCPM 20.000 → 20.000/(0.105×1000) = 190,5 COP por clic (+1).
    expect(r.winners[0].priceCOP).toBe(191);
  });
});

describe('orden y reparto', () => {
  it('un solo anuncio por anunciante: gana su mejor campaña', () => {
    const adv = advertiser('adv_compartido');
    const buena = candidate('buena', { pricing: { model: 'cpm', bidCOP: 40_000 } }, { advertiser: adv });
    const mala = candidate('mala', { pricing: { model: 'cpm', bidCOP: 3_000 } }, { advertiser: adv });
    const r = runAuction([mala, buena], ctx(), opts());
    expect(r.winners).toHaveLength(1);
    expect(r.winners[0].campaignId).toBe('buena');
    expect(reasonOf(r.excluded, 'mala')).toBe('duplicate_advertiser');
  });

  it('desempate determinista por id: mismos datos, mismo orden', () => {
    const tres = ['ccc', 'aaa', 'bbb'].map((id) => candidate(id));
    const uno = runAuction(tres, ctx(), opts());
    const otro = runAuction([...tres].reverse(), ctx(), opts());
    expect(uno.winners.map((w) => w.campaignId)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(otro.winners.map((w) => w.campaignId)).toEqual(uno.winners.map((w) => w.campaignId));
  });

  it('respeta el número de cupos del slot y explica los que sobran', () => {
    const tres = ['a', 'b', 'c'].map((id) => candidate(id));
    const r = runAuction(tres, ctx(), opts({ slots: 2 }));
    expect(r.winners).toHaveLength(2);
    // a y b ocupan los cupos (empate desempata por id); c se queda fuera.
    expect(r.winners.map((w) => w.campaignId)).toEqual(['a', 'b']);
    expect(reasonOf(r.excluded, 'c')).toBe('out_of_slots');
  });

  it('no inventa ganadores con slots = 0', () => {
    expect(runAuction([candidate('a')], ctx(), opts({ slots: 0 })).winners).toHaveLength(0);
  });

  it('las posiciones empiezan en 1 y siguen el orden', () => {
    const r = runAuction([candidate('a'), candidate('b')], ctx(), opts());
    expect(r.winners.map((w) => w.position)).toEqual([1, 2]);
  });
});
describe('precio de reserva al crear la campaña', () => {
  it('el piso es la puja minima admitida en la subasta, en CPM y en CPC', () => {
    expect(priceFloorCOP('cpm')).toBe(CPM_FLOOR_COP);
    const cpc = candidate('cpc-bajo', { pricing: { model: 'cpc', bidCOP: priceFloorCOP('cpc') - 1 } });
    expect(reasonOf(runAuction([cpc], ctx(), opts()).excluded, 'cpc-bajo')).toBe('below_floor');
  });
});
