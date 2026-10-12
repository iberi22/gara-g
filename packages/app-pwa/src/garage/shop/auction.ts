/**
 * auction.ts — La subasta de anuncios del shop. Funcion PURA: no toca D1, ni el reloj,
 * ni la red. Entra la lista de candidatas ya cargadas y sale el resultado con el precio
 * que se va a cobrar. Esa separacion es deliberada: es la parte que mueve plata, y una
 * funcion pura se puede testear exhaustivamente (incluido el empate y el ritmo) sin
 * montar un Worker ni una base de datos.
 *
 * El algoritmo, en orden:
 *   1. FILTRAR   — quien no puede mostrarse a este usuario (estado, fechas, presupuesto,
 *                  saldo, segmentacion, tope de frecuencia, ritmo de gasto).
 *   2. PUNTUAR   — eCPM x relevancia. El eCPM de una campana CPC se estima con el pCTR
 *                  bayesiano de la campana: sin historial valen 1 %, con historial se
 cerca al clic real. Asi una campana nueva no queda fuera por no
 * tener datos y una campana que nadie pulsa se hunde sola.
 *   3. ORDENAR   — por puntaje; empate desempateado por id para que la subasta sea
 *                  reproducible (mismos datos, mismo resultado, siempre).
 *   4. DEDUP     — un anuncio por anunciante: si una tienda tiene tres campanas, el
 *                  usuario no debe ver tres anuncios seguidos de la misma tienda.
 *   5. PRECIO    — segundo precio generalizado: el ganador paga lo minimo para conservar
 *                  el puesto, nunca su puja (o su puja si es el ultimo, porque ahi el
 *                  minimo para conservar el puesto es toda su puja), con un piso para
 *                  que un slot vacio no se venda a 1 COP.
 *
 * Cada exclusion devuelve su RAZON: es lo que permite auditar por que un anunciante
 * no vio su anuncio, que es la pregunta que siempre llega.
 */
import type { AdCampaign, AdContext, Advertiser } from '../contracts';
import { isCompatible, relevanceScore } from './targeting';

/** Piso de precio: el slot no se vende por debajo de esto (docs/garage/ARCHITECTURE.md). */
export const CPM_FLOOR_COP = 2_000;
export const CPC_FLOOR_COP = 150;

/** Multiplicador de ritmo: se puede gastar hasta 1.2x la parte del dia que ya paso. */
export const PACING_FACTOR = 1.2;

/** Suavizado bayesiano del CTR: prior 1clic / 100 impresiones. */
const CTR_PRIOR_CLICKS = 1;
const CTR_PRIOR_IMPRESSIONS = 100;

export interface AuctionStatDay {
  campaignId: string;
  /** YYYY-MM-DD en hora local del servidor. */
  day: string;
  impressions: number;
  clicks: number;
  spendCOP: number;
  /** userHash -> impresiones de hoy de ese usuario. */
  freq?: Record<string, number>;
}

export interface AuctionCandidate {
  campaign: AdCampaign;
  advertiser: Advertiser;
  /** Estadistica de HOY de la campana. Si no hay fila todavia, una vacia. */
  today?: AuctionStatDay;
  /** Gasto acumulado historico (todos los dias). */
  lifetimeSpendCOP?: number;
  /** Impresiones y clics historicos; alimentan el pCTR. */
  lifetime?: { impressions: number; clicks: number };
}

export interface AuctionOptions {
  /** Cuantos anuncios caben en este slot (3 en el feed del shop). */
  slots: number;
  /** Epoch ms del instante de la peticion: decide fechas y ritmo. */
  now: number;
  /** Fuente de azar en 0..1. Inyectada para que el ritmo sea testeable. */
  rand: () => number;
}

export type ExclusionReason =
  | 'below_floor'
  | 'not_active'
  | 'outside_dates'
  | 'daily_budget_exhausted'
  | 'total_budget_exhausted'
  | 'no_balance'
  | 'not_targeted'
  | 'freq_cap'
  | 'pacing'
  | 'duplicate_advertiser'
  | 'out_of_slots';

export interface AuctionWinner {
  campaignId: string;
  advertiserId: string;
  /** Posicion final, 1 = primero. */
  position: number;
  score: number;
  relevance: number;
  pCtr: number;
  eCpmCOP: number;
  /** Lo que se cobra por esta impresion, en COP. */
  priceCOP: number;
}

export interface AuctionExcluded {
  campaignId: string;
  advertiserId: string;
  reason: ExclusionReason;
  /** Detalle legible para auditoria (umbral que se cruzo, id de usuario, ...). */
  detail: string;
}

export interface AuctionResult {
  winners: AuctionWinner[];
  excluded: AuctionExcluded[];
}

const EMPTY_TODAY: AuctionStatDay = { campaignId: '', day: '', impressions: 0, clicks: 0, spendCOP: 0 };

/** pCTR bayesiano. Con cero historial devuelve 1 % (el prior), no 0. */
export function bayesianPCtr(impressions: number, clicks: number): number {
  return (Math.max(0, clicks) + CTR_PRIOR_CLICKS) / (Math.max(0, impressions) + CTR_PRIOR_IMPRESSIONS);
}

/** Parte del dia ya transcurrida (0..1) a partir de la hora local del servidor. */
export function dayFraction(now: number): number {
  const d = new Date(now);
  return (d.getHours() * 60 + d.getMinutes()) / (60 * 24);
}

function dayKey(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Los budgets y las fechas de la campana llegan como strings ISO; se corta por dia. */
function inDateWindow(campaign: AdCampaign, now: number): boolean {
  const today = dayKey(now);
  if (campaign.startDate && campaign.startDate.slice(0, 10) > today) return false;
  if (campaign.endDate && campaign.endDate.slice(0, 10) < today) return false;
  return true;
}

/** Suelo de un slot: el minimo que el anunciante tiene que pagar por ganarlo. */
export function priceFloorCOP(model: 'cpm' | 'cpc'): number {
  return model === 'cpm' ? CPM_FLOOR_COP : CPC_FLOOR_COP;
}

interface ScoredCandidate {
  candidate: AuctionCandidate;
  score: number;
  relevance: number;
  pCtr: number;
  eCpmCOP: number;
}

function scoreCandidate(candidate: AuctionCandidate, ctx: AdContext): ScoredCandidate {
  const { campaign } = candidate;
  const relevance = relevanceScore(campaign.targeting, ctx).score;
  const life = candidate.lifetime ?? { impressions: 0, clicks: 0 };
  const pCtr = bayesianPCtr(life.impressions, life.clicks);
  const bid = Math.max(0, campaign.pricing.bidCOP);
  const eCpmCOP = campaign.pricing.model === 'cpc' ? bid * pCtr * 1000 : bid;
  // El ritmo no entra aqui: ver el comentario de la penalizacion en `runAuction`.
  const score = eCpmCOP * relevance;
  return { candidate, score, relevance, pCtr, eCpmCOP };
}

/**
 * Corre la subasta. Devuelve ganadores con su precio y la razon de exclusion de cada
 * perdedor, para que el anunciante pueda auditar por que no se mostraba su anuncio.
 */
export function runAuction(candidates: AuctionCandidate[], ctx: AdContext, opts: AuctionOptions): AuctionResult {
  const { now, rand } = opts;
  const slots = Math.max(0, Math.floor(opts.slots));
  const excluded: AuctionExcluded[] = [];
  const eligible: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const { campaign, advertiser } = candidate;
    const reject = (reason: ExclusionReason, detail: string) => {
      excluded.push({ campaignId: campaign.id, advertiserId: advertiser.id, reason, detail });
    };

    if (campaign.status !== 'active') {
      reject('not_active', `status=${campaign.status}`);
      continue;
    }
    // El piso es un precio de RESERVA: una puja por debajo no entra a la subasta. Antes
    // podia ganar (si no habia competencia) y pagar su puja, es decir, menos que el piso.
    const floorCOP = priceFloorCOP(campaign.pricing.model);
    if (campaign.pricing.bidCOP < floorCOP) {
      reject('below_floor', `puja ${campaign.pricing.bidCOP} < piso ${floorCOP} (${campaign.pricing.model})`);
      continue;
    }
    if (!inDateWindow(campaign, now)) {
      reject('outside_dates', `start=${campaign.startDate ?? '-'} end=${campaign.endDate ?? '-'}`);
      continue;
    }
    const today = candidate.today ?? EMPTY_TODAY;
    const lifetimeSpend = candidate.lifetimeSpendCOP ?? 0;
    if (today.spendCOP >= campaign.dailyBudgetCOP && campaign.dailyBudgetCOP > 0) {
      reject('daily_budget_exhausted', `gasto ${today.spendCOP} >= presupuesto diario ${campaign.dailyBudgetCOP}`);
      continue;
    }
    if (lifetimeSpend >= campaign.totalBudgetCOP && campaign.totalBudgetCOP > 0) {
      reject('total_budget_exhausted', `gasto ${lifetimeSpend} >= presupuesto total ${campaign.totalBudgetCOP}`);
      continue;
    }
    if (advertiser.balanceCOP <= 0) {
      reject('no_balance', `saldo ${advertiser.balanceCOP}`);
      continue;
    }
    if (!isCompatible(campaign.targeting, ctx)) {
      reject('not_targeted', 'la segmentacion no coincide con el vehiculo del usuario');
      continue;
    }
    const cap = campaign.freqCapPerUserDay ?? 0;
    const shownToday = today.freq?.[ctx.userHash] ?? 0;
    if (cap > 0 && shownToday >= cap) {
      reject('freq_cap', `${shownToday} impresiones hoy >= tope ${cap}`);
      continue;
    }

    // Ritmo: si ya se gasto mas de lo que tocaba para esta hora del dia, la campana
    // entra con probabilidad reducida. No se excluye siempre: asi la campana sigue
    // pudiendo mostrarse de noche cuando le toca, en vez de quedarse dormida todo el dia.
    //
    // Decision (A1, ronda 2): el ritmo NO multiplica el puntaje, solo decide si entra. La
    // razon: el puntaje es lo que ORDENA y lo que fija el segundo precio. Si el ritmo
    // bajara el puntaje, un ganador de ritmo pagaria como si el siguiente fuera mas debil
    // (el precio divide el puntaje del rival por la relevancia propia), y se estaria
    // cobrando de menos al anunciante por una penalizacion que no es de mercado. Como
    // probabilidad de entrada, el ritmo reparte el gasto en el tiempo sin tocar el precio.
    const paceLimit = dayFraction(now) * campaign.dailyBudgetCOP * PACING_FACTOR;
    if (paceLimit > 0 && today.spendCOP > paceLimit) {
      const over = today.spendCOP / paceLimit; // >= 1
      const pEnter = Math.max(0, Math.min(1, 2 - over));
      if (rand() > pEnter) {
        reject('pacing', `gasto ${today.spendCOP} sobre el ritmo ${Math.round(paceLimit)} (p=${pEnter.toFixed(2)})`);
        continue;
      }
    }

    eligible.push(scoreCandidate(candidate, ctx));
  }

  // Ordenar por puntaje; el id desempata para que el resultado sea reproducible.
  eligible.sort((a, b) => (b.score - a.score) || (a.candidate.campaign.id < b.candidate.campaign.id ? -1 : 1));

  // Un anuncio por anunciante: gana la mejor campana de cada tienda.
  const seenAdvertisers = new Set<string>();
  const finalists: ScoredCandidate[] = [];
  for (const item of eligible) {
    const advertiserId = item.candidate.advertiser.id;
    if (seenAdvertisers.has(advertiserId)) {
      excluded.push({
        campaignId: item.candidate.campaign.id,
        advertiserId,
        reason: 'duplicate_advertiser',
        detail: 'ya hay una campana de este anunciante con mejor puntaje',
      });
      continue;
    }
    seenAdvertisers.add(advertiserId);
    finalists.push(item);
  }

  const winners: AuctionWinner[] = [];
  const count = Math.min(slots, finalists.length);
  for (let i = 0; i < count; i++) {
    const item = finalists[i];
    const campaign = item.candidate.campaign;
    const next = finalists[i + 1];
    // Segundo precio generalizado: lo minimo que habria pagado por conservar el puesto.
    //
    // Decision (ronda 2): si no hay siguiente, `neededEcm` es 0 y el precio sale del PISO,
    // no de la puja. Antes el ultimo pagaba su puja entera, y eso es incorrecto en
    // segunda precio: sin competencia, lo unico que define el valor del slot es el precio de
    // reserva. Con el piso, "nadie me disputa" se traduce en "pago el minimo del slot", que
    // es lo que un anunciante espera y lo que hace que la subasta tenga un suelo de ingreso.
    const neededEcm = next ? next.score / item.relevance : 0;
    // De eCPM a precio segun el modelo: en CPM es directo; en CPC el eCPM viene del
    // pCTR, asi que el precio por clic pedido es ese eCPM entre (pCTR x 1000).
    const needed = campaign.pricing.model === 'cpc' ? neededEcm / (item.pCtr * 1000) : neededEcm;
    const floor = priceFloorCOP(campaign.pricing.model);
    // El +1 COP es la diferencia minima para GANARLE al siguiente: sin el, un empate de
    // puntaje haria que ambos se creyeran ganadores. El tope manda sobre el piso: un
    // anunciante con puja bajo el piso paga su puja, no se le factura mas de lo que ofrecio.
    const priceCOP = Math.min(campaign.pricing.bidCOP, Math.max(needed + 1, floor));
    winners.push({
      campaignId: campaign.id,
      advertiserId: campaign.advertiserId,
      position: i + 1,
      score: item.score,
      relevance: item.relevance,
      pCtr: item.pCtr,
      eCpmCOP: item.eCpmCOP,
      priceCOP: Math.round(priceCOP),
    });
  }

  for (const item of finalists.slice(count)) {
    excluded.push({
      campaignId: item.candidate.campaign.id,
      advertiserId: item.candidate.advertiser.id,
      reason: 'out_of_slots',
      detail: `fuera de los ${slots} cupos del slot`,
    });
  }

  return { winners, excluded };
}