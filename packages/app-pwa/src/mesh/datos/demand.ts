/**
 * demand.ts — La senal anonima de demanda de un dueno: "alguien con una camioneta Toyota
 * necesita cambio de aceite pronto en esta ciudad". Sirve para que un lubricentro sepa que
 * hay demanda; no dice quien es.
 *
 * QUE SALE (DemandSignal) y QUE NO:
 *  - NO sale: placa, VIN, nombre del vehiculo, odometro exacto, ni posicion alguna (ni lat/lon
 *    ni celda fina). La region es solo la celda p4 (~una ciudad) que ya es la sala.
 *  - Los km que faltan van en un RANGO (`due`: vencido / <=500 / <=1000 / <=2500 / <=5000 / mas),
 *    no el numero. La hora de emision va redondeada al dia.
 *  - Marca, modelo y rango de anios solo salen con `detail: 'full'`. Por defecto (`basic`)
 *    sale clase + marca. Es el "k-anonimato a ojo": un modelo raro + un rango de 5 anios +
 *    una ciudad pequena puede apuntar a una sola persona; clase + marca casi nunca. Desde la
 *    malla no se puede medir k real, asi que se generaliza por defecto y el dueno decide si
 *    afina. Del lado receptor, `aggregateDemand` solo muestra cubos con >= k emisores.
 *  - `sid` es un id efimero que rota cada dia y NO sale del id del nodo ni de la cuenta; sirve
 *    para contar emisores distintos sin enlazar dias distintos. Ojo: el emisor del mensaje
 *    (`from`) sigue siendo el del puerto que publica. Para que la demanda sea anonima de
 *    verdad hay que publicarla por un puerto desechable nuevo en cada ronda (`demandPortFactory` en market.ts); sin el, market.ts no publica demanda.
 *
 * CONSENTIMIENTO: solo se construye si el dueno encendio "mostrar mi demanda", el consentimiento
 * del mercado esta activo, la categoria `demand:<cat>` esta permitida y el horario lo permite
 * (se reusa `isOfferMatchingOptIn`: una sola logica de horario en toda la app).
 */
import { type OptInPreferences, isOfferMatchingOptIn } from '../../lib/marketplaceOptIn';
import {
  NEED_CATEGORIES,
  type NeedKey,
  NEED_KEYS,
  OFFER_CATEGORIES,
  type OfferCategory,
  VEHICLE_CLASSES,
  type VehicleClass,
  foldText,
} from './offer';
import { isRegionCell } from './topics';
import { type NeedUnit, type OwnerVehicle, scaleKm } from './vehicles';

export type DemandDetail = 'basic' | 'full';

/** 0 = vencido; 1..4 = hasta el umbral i; 5 = mas lejos. */
export type DueBucket = 0 | 1 | 2 | 3 | 4 | 5;

const THRESHOLDS: Record<NeedUnit, [number, number, number, number]> = {
  km: [500, 1000, 2500, 5000],
  h: [25, 50, 125, 250],
  dias: [15, 30, 60, 120],
};

/** Horizonte: mas alla del ultimo umbral no se publica (aun no es una necesidad). */
export function dueBucket(remaining: number, unit: NeedUnit): DueBucket {
  if (remaining < 0) return 0;
  const t = THRESHOLDS[unit];
  for (let i = 0; i < t.length; i++) if (remaining <= t[i]) return (i + 1) as DueBucket;
  return 5;
}

export function dueLabel(due: DueBucket, unit: NeedUnit): string {
  const u = unit === 'dias' ? 'días' : unit;
  if (due === 0) return 'ya vencido';
  const t = THRESHOLDS[unit];
  if (due === 5) return `más de ${t[3]} ${u}`;
  return `en menos de ${t[due - 1]} ${u}`;
}

export function yearBucket(year: number): string {
  const from = Math.floor(year / 5) * 5;
  return `${from}-${from + 4}`;
}

export interface DemandSignal {
  v: 1;
  sid: string;
  cat: OfferCategory;
  need: NeedKey;
  cls: VehicleClass;
  brand?: string;
  model?: string;
  yearBucket?: string;
  unit: NeedUnit;
  due: DueBucket;
  /** Region p4. */
  cell: string;
  /** Dia (epoch ms redondeado a 00:00 UTC). */
  day: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Un dueno con diez necesidades no publica diez senales: las mas urgentes bastan. */
export const MAX_SIGNALS_PER_ROUND = 5;

export const demandCategoryKey = (cat: OfferCategory): string => `demand:${cat}`;
export const offerCategoryKey = (cat: OfferCategory): string => `offer:${cat}`;

/**
 * ¿Puede publicarse demanda de esta categoria ahora? Reusa el filtro del mercado: se le
 * presenta como una "oferta" de categoria `demand:<cat>` con pago infinito y distancia 0 para
 * que solo decidan el interruptor, la categoria y el horario.
 */
export function demandAllowed(
  prefs: OptInPreferences,
  enabled: boolean,
  cat: OfferCategory,
  date: Date,
): boolean {
  if (!enabled) return false;
  return isOfferMatchingOptIn(
    {
      id: 'demanda',
      title: 'demanda',
      category: demandCategoryKey(cat),
      payoutGara: Number.POSITIVE_INFINITY,
      distanceKm: 0,
      timestamp: date.getTime(),
    },
    prefs,
    date,
  );
}

export interface DemandContext {
  prefs: OptInPreferences;
  enabled: boolean;
  detail: DemandDetail;
  /** Region p4 del dueno. Sin ella no se publica. */
  region: string | null;
  now: number;
  sid: string;
}

/**
 * Construye las senales a publicar: [] si el consentimiento no lo permite. Pura.
 * Orden: la necesidad mas urgente primero.
 */
export function buildDemandSignals(vehicles: OwnerVehicle[], ctx: DemandContext): DemandSignal[] {
  if (!ctx.region || !isRegionCell(ctx.region)) return [];
  const date = new Date(ctx.now);
  const day = Math.floor(ctx.now / DAY_MS) * DAY_MS;
  const candidates: { signal: DemandSignal; urgency: number }[] = [];

  for (const v of vehicles) {
    for (const need of v.needs) {
      const due = dueBucket(need.remaining, need.unit);
      if (due === 5) continue;
      const cat = pickCategory(need.key, ctx, date);
      if (!cat) continue;
      const s: DemandSignal = {
        v: 1,
        sid: ctx.sid,
        cat,
        need: need.key,
        cls: v.cls,
        unit: need.unit,
        due,
        cell: ctx.region,
        day,
      };
      if (v.make) s.brand = foldText(v.make).slice(0, 40);
      if (ctx.detail === 'full') {
        if (v.model) s.model = foldText(v.model).slice(0, 40);
        if (v.year && Number.isFinite(v.year)) s.yearBucket = yearBucket(v.year);
      }
      candidates.push({ signal: s, urgency: scaleKm(need) });
    }
  }
  candidates.sort((a, b) => a.urgency - b.urgency);
  // Dos vehiculos iguales con la misma necesidad serian dos senales identicas: una basta
  // (ademas, repetirlas delataria cuantos vehiculos tiene el dueno).
  const seen = new Set<string>();
  const out: DemandSignal[] = [];
  for (const { signal } of candidates) {
    const key = JSON.stringify([signal.cat, signal.need, signal.cls, signal.brand, signal.model, signal.yearBucket, signal.due]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
    if (out.length >= MAX_SIGNALS_PER_ROUND) break;
  }
  return out;
}

/** Primera categoria que atiende la necesidad Y que el dueno permite. */
function pickCategory(need: NeedKey, ctx: DemandContext, date: Date): OfferCategory | null {
  for (const cat of NEED_CATEGORIES[need]) {
    if (demandAllowed(ctx.prefs, ctx.enabled, cat, date)) return cat;
  }
  return null;
}

// --- Id efimero --------------------------------------------------------------

/** Id al azar que cambia cada dia. No se deriva de nada estable (nodo, cuenta, vehiculo). */
export class EphemeralId {
  private id = '';
  private day = -1;
  constructor(private rng: () => number = Math.random) {}

  current(now: number): string {
    const d = Math.floor(now / DAY_MS);
    if (d !== this.day) {
      this.day = d;
      this.id = randomHex(this.rng, 12);
    }
    return this.id;
  }
}

export function randomHex(rng: () => number, len: number): string {
  let s = '';
  // crypto cuando existe: Math.random no es impredecible, y el id debe serlo.
  if (rng === Math.random && typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint8Array(Math.ceil(len / 2));
    crypto.getRandomValues(b);
    s = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  } else {
    while (s.length < len) s += Math.floor(rng() * 16).toString(16);
  }
  return s.slice(0, len);
}

// --- Receptor ----------------------------------------------------------------

/** Valida una senal recibida; null si no cumple (no se confia en lo que llega). */
export function parseDemand(raw: unknown): DemandSignal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (typeof r.sid !== 'string' || !/^[0-9a-f]{12}$/.test(r.sid)) return null;
  if (!(OFFER_CATEGORIES as readonly unknown[]).includes(r.cat)) return null;
  if (!(NEED_KEYS as readonly unknown[]).includes(r.need)) return null;
  if (!(VEHICLE_CLASSES as readonly unknown[]).includes(r.cls)) return null;
  if (r.unit !== 'km' && r.unit !== 'h' && r.unit !== 'dias') return null;
  if (typeof r.due !== 'number' || !Number.isInteger(r.due) || r.due < 0 || r.due > 5) return null;
  if (!isRegionCell(r.cell)) return null;
  if (typeof r.day !== 'number' || !Number.isFinite(r.day)) return null;
  const out: DemandSignal = {
    v: 1,
    sid: r.sid,
    cat: r.cat as OfferCategory,
    need: r.need as NeedKey,
    cls: r.cls as VehicleClass,
    unit: r.unit,
    due: r.due as DueBucket,
    cell: r.cell,
    day: r.day,
  };
  const short = (x: unknown) => (typeof x === 'string' && x.length > 0 && x.length <= 40 ? x : undefined);
  const b = short(r.brand);
  const m = short(r.model);
  const y = typeof r.yearBucket === 'string' && /^\d{4}-\d{4}$/.test(r.yearBucket) ? r.yearBucket : undefined;
  if (b) out.brand = b;
  if (m) out.model = m;
  if (y) out.yearBucket = y;
  return out;
}

export interface DemandPulseCell {
  cat: OfferCategory;
  need: NeedKey;
  cls: VehicleClass;
  /** Emisores distintos (sid) en este cubo. */
  count: number;
}

export const DEMAND_MIN_K = 3;

/**
 * Para el vendedor: cuanta demanda hay por categoria, necesidad y clase. Un cubo con menos
 * de `k` emisores distintos se suprime, igual que en los mapas de calor: con 1 o 2 personas
 * el cubo las senala.
 */
export function aggregateDemand(
  signals: { sid: string; signal: DemandSignal }[],
  k = DEMAND_MIN_K,
): DemandPulseCell[] {
  const buckets = new Map<string, { cell: Omit<DemandPulseCell, 'count'>; sids: Set<string> }>();
  for (const { sid, signal } of signals) {
    const key = `${signal.cat}|${signal.need}|${signal.cls}`;
    let b = buckets.get(key);
    if (!b) {
      b = { cell: { cat: signal.cat, need: signal.need, cls: signal.cls }, sids: new Set() };
      buckets.set(key, b);
    }
    b.sids.add(sid);
  }
  return [...buckets.values()]
    .filter((b) => b.sids.size >= k)
    .map((b) => ({ ...b.cell, count: b.sids.size }))
    .sort((a, b) => b.count - a.count);
}
