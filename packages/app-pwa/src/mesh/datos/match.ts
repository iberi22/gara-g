/**
 * match.ts — Emparejar, EN EL DISPOSITIVO, las ofertas recibidas con los vehiculos del dueno
 * y ordenarlas por lo que mas le sirve. Pura y determinista (mismo `now`, mismo resultado).
 *
 * Por que local: el emparejamiento necesita el odometro, la marca y lo que el vehiculo
 * necesita pronto. Si lo hiciera un servidor, tendria que recibir todo eso. Aqui la oferta
 * viaja a todos y cada dueno decide en su telefono; el vendedor no se entera de quien la vio.
 *
 * Dos fases:
 *  1. Elegibilidad (dura): vigente, dentro del radio, la segmentacion calza con el vehiculo,
 *     y el consentimiento del dueno (categoria, pago minimo, distancia) la permite.
 *  2. Puntaje (blando) + explicacion: cada razon que suma puntos se cuenta en palabras, y la
 *     principal es el "por que te sale".
 *
 * Una oferta con segmentacion que no calza con NINGUN vehiculo del dueno no se muestra. Una
 * oferta general (sin segmentacion) si se muestra, con puntaje bajo.
 */
import { type OptInPreferences, isOfferMatchingOptIn } from '../../lib/marketplaceOptIn';
import { decodeGeohash } from '../geocell';
import {
  CATEGORY_LABELS,
  CLASS_LABELS,
  NEED_CATEGORIES,
  type NeedKey,
  type OfferTarget,
  type VendorOffer,
  foldText,
  isTargeted,
} from './offer';
import { offerCategoryKey } from './demand';
import { type Need, type OwnerVehicle, scaleKm } from './vehicles';

/** Una celda p4 mide ~39 km: dos puntos de la misma celda pueden estar a ese margen. */
export const CELL_SLACK_KM = 20;

/** Una necesidad es "pronto" cuando le faltan, en la escala comun de km, hasta esto (o ya se paso). */
export const SOON_KM = 5000;

export interface MatchContext {
  now: number;
  /** Region p4 del dueno. */
  ownerCell: string;
  prefs: OptInPreferences;
}

export interface Match {
  offer: VendorOffer;
  /** Vehiculo al que mejor le sirve; ausente en una oferta general. */
  vehicleId?: string;
  need?: NeedKey;
  score: number;
  /** La razon principal, lista para mostrar: "Tu Hilux necesita cambio de aceite en ~800 km." */
  why: string;
  /** Todas las razones, de mayor a menor peso. */
  reasons: string[];
  distanceKm: number;
}

// --- Geografia ------------------------------------------------------------

function center(cell: string): { lat: number; lon: number } {
  const b = decodeGeohash(cell);
  return { lat: (b.latLo + b.latHi) / 2, lon: (b.lonLo + b.lonHi) / 2 };
}

/** Distancia entre los centros de dos celdas, en km (haversine). */
export function cellDistanceKm(a: string, b: string): number {
  if (a === b) return 0;
  const p = center(a);
  const q = center(b);
  const rad = Math.PI / 180;
  const dLat = (q.lat - p.lat) * rad;
  const dLon = (q.lon - p.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// --- Texto -------------------------------------------------------------------

const NEED_PHRASE: Record<NeedKey, string> = {
  aceite: 'cambio de aceite',
  llantas: 'cambio de llantas',
  frenos: 'revisión de frenos',
  bateria: 'cambio de batería',
  filtros: 'cambio de filtros',
  seguro: 'renovar el seguro o el SOAT',
  revision: 'una revisión',
};

/** "~800 km", "~40 h", "~20 días": redondeado, porque la cifra exacta no importa ni se muestra. */
export function approx(value: number, unit: Need['unit']): string {
  const v = Math.abs(value);
  const step = unit === 'km' ? 100 : unit === 'h' ? 5 : 1;
  const r = Math.max(step, Math.round(v / step) * step);
  return `~${r.toLocaleString('es-CO')} ${unit === 'dias' ? 'días' : unit}`;
}

function needSentence(v: OwnerVehicle, n: Need): string {
  const what = NEED_PHRASE[n.key];
  if (n.remaining < 0) return `Tu ${v.name} necesita ${what}: ya se pasó hace ${approx(n.remaining, n.unit)}.`;
  return `Tu ${v.name} necesita ${what} en ${approx(n.remaining, n.unit)}.`;
}

// --- Elegibilidad ----------------------------------------------------------

/** ¿La segmentacion de la oferta calza con este vehiculo? Devuelve cuantas dimensiones calzaron, o null. */
function fitsTarget(t: OfferTarget, v: OwnerVehicle): { dims: number; need?: Need } | null {
  let dims = 0;
  if (t.classes.length) {
    if (!t.classes.includes(v.cls)) return null;
    dims++;
  }
  if (t.brands.length) {
    if (!v.make || !t.brands.includes(foldText(v.make))) return null;
    dims++;
  }
  if (t.models.length) {
    if (!v.model || !t.models.includes(foldText(v.model))) return null;
    dims++;
  }
  if (t.years) {
    if (v.year === undefined || v.year < t.years.from || v.year > t.years.to) return null;
    dims++;
  }
  if (t.odometer) {
    if (v.usage !== 'km' || v.odometer === undefined) return null;
    if (v.odometer < t.odometer.min || v.odometer > t.odometer.max) return null;
    dims++;
  }
  let need: Need | undefined;
  if (t.need) {
    need = v.needs.find((n) => n.key === t.need);
    // La ventana va en km; horas y dias se llevan a la escala comun.
    if (!need || scaleKm(need) > (t.withinKm ?? 0)) return null;
    dims++;
  }
  return { dims, need };
}

/** Consentimiento del dueno aplicado a una oferta recibida. */
function consentAllows(offer: VendorOffer, distanceKm: number, prefs: OptInPreferences, now: number): boolean {
  return isOfferMatchingOptIn(
    {
      id: offer.id,
      title: offer.title,
      category: offerCategoryKey(offer.category),
      // GARA-G no intermedia pagos: ninguna oferta "paga", asi que el minimo de pago de las
      // preferencias genericas no aplica (infinito = siempre lo cumple). `offer.payoutGara`,
      // heredado de ofertas viejas, se ignora.
      payoutGara: Number.POSITIVE_INFINITY,
      distanceKm,
      timestamp: now,
    },
    // El horario es para cuando el dueno acepta que le PUBLIQUEN/molesten; la bandeja es
    // suya y se guarda en el dispositivo, asi que ver la lista a la 1 am no filtra nada.
    { ...prefs, schedule: undefined },
    new Date(now),
  );
}

// --- Puntaje ---------------------------------------------------------------

const W = {
  base: 10,
  perDim: 5,
  explicitNeed: 30,
  affinityNeed: 18,
  overdue: 25,
  discountMax: 20,
  distanceMax: 10,
};

function urgencyPoints(n: Need): number {
  if (n.remaining < 0) return W.overdue;
  const km = scaleKm(n);
  if (km <= 1000) return 20;
  if (km <= 2500) return 12;
  if (km <= 5000) return 6;
  return 2;
}

interface Candidate {
  score: number;
  reasons: { weight: number; text: string }[];
  vehicle?: OwnerVehicle;
  need?: NeedKey;
}

function scoreFor(offer: VendorOffer, v: OwnerVehicle | undefined, distanceKm: number): Candidate | null {
  const cand: Candidate = { score: W.base, reasons: [], vehicle: v };
  const add = (weight: number, text: string) => {
    cand.score += weight;
    cand.reasons.push({ weight, text });
  };

  if (v) {
    const fit = fitsTarget(offer.target, v);
    if (!fit) return null;
    if (fit.dims > 0) {
      const bits: string[] = [];
      if (offer.target.models.length && v.model) bits.push(`${v.make ?? ''} ${v.model}`.trim());
      else if (offer.target.brands.length && v.make) bits.push(v.make);
      else if (offer.target.classes.length) bits.push(CLASS_LABELS[v.cls]);
      if (offer.target.years && v.year) bits.push(`modelo ${v.year}`);
      add(fit.dims * W.perDim + 2, `Es para ${bits.join(', ') || 'tu tipo de vehículo'}, como tu ${v.name}.`);
    }
    // Necesidad: la que pide la oferta, o la que su categoria atiende y el vehiculo tiene.
    if (fit.need) {
      add(W.explicitNeed + urgencyPoints(fit.need), needSentence(v, fit.need));
      cand.need = fit.need.key;
    } else {
      const affine = v.needs
        .filter((n) => NEED_CATEGORIES[n.key].includes(offer.category))
        .sort((a, b) => scaleKm(a) - scaleKm(b))[0];
      if (affine && scaleKm(affine) <= SOON_KM) {
        add(W.affinityNeed + Math.round(urgencyPoints(affine) * 0.7), needSentence(v, affine));
        cand.need = affine.key;
      }
    }
  }

  if (offer.discountPct) add(Math.min(W.discountMax, offer.discountPct / 2), `Trae ${offer.discountPct}% de descuento.`);

  const dist = Math.min(W.distanceMax, distanceKm / 10);
  cand.score -= dist;
  cand.reasons.push({
    weight: 1,
    text: distanceKm < 1 ? 'Atiende en tu ciudad.' : `${CATEGORY_LABELS[offer.category]} a ${approx(distanceKm, 'km')} de tu zona.`,
  });
  return cand;
}

/**
 * Las ofertas que le sirven al dueno, de la mejor a la peor. Empates: la mas reciente y,
 * por ultimo, el id (orden estable para que la lista no baile entre dos calculos).
 */
export function matchOffers(offers: VendorOffer[], vehicles: OwnerVehicle[], ctx: MatchContext): Match[] {
  const out: Match[] = [];
  for (const offer of offers) {
    if (!offer.active || offer.validFrom > ctx.now || offer.validUntil <= ctx.now) continue;
    const distanceKm = cellDistanceKm(ctx.ownerCell, offer.region);
    if (distanceKm > offer.radiusKm + CELL_SLACK_KM) continue;
    if (!consentAllows(offer, distanceKm, ctx.prefs, ctx.now)) continue;

    let best: Candidate | null = null;
    if (isTargeted(offer.target)) {
      for (const v of vehicles) {
        const c = scoreFor(offer, v, distanceKm);
        if (c && (!best || c.score > best.score)) best = c;
      }
    } else {
      // General: se mira igual contra cada vehiculo para ver si ademas atiende una necesidad.
      best = scoreFor(offer, undefined, distanceKm);
      for (const v of vehicles) {
        const c = scoreFor(offer, v, distanceKm);
        if (c && c.need && (!best || c.score > best.score)) best = c;
      }
      if (best && !best.vehicle) best.reasons.unshift({ weight: 2, text: 'Oferta abierta para todos en tu ciudad.' });
    }
    if (!best) continue;
    const reasons = best.reasons.sort((a, b) => b.weight - a.weight).map((r) => r.text);
    out.push({
      offer,
      vehicleId: best.vehicle?.id,
      need: best.need,
      score: Math.round(best.score * 10) / 10,
      why: reasons[0],
      reasons,
      distanceKm: Math.round(distanceKm),
    });
  }
  return out.sort(
    (a, b) => b.score - a.score || b.offer.createdAt - a.offer.createdAt || a.offer.id.localeCompare(b.offer.id),
  );
}
