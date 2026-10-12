/**
 * market.ts — El orquestador de la red de datos: une una sala por region, recibe ofertas y
 * senales, guarda la bandeja y expone un estado observable. La UI solo habla con esto.
 *
 * Reglas de recepcion de una oferta (en este orden, cada descarte se cuenta en `dropped`):
 *   1. sin firma verificada -> se descarta (`msg.verified`; cualquiera puede escribir en una
 *      sala, solo la firma ata la oferta a un nodo);
 *   2. nodo bloqueado; 3. limite de ritmo por nodo; 4. forma invalida/tamano/vencida
 *      (`parseOffer`); 5. oferta bloqueada; 6. duplicado: misma id ya guardada. Una id solo la
 *      puede actualizar o retirar el MISMO nodo que la publico (si no, cualquiera retiraria la
 *      oferta de otro con solo reusar su id).
 *
 * Reloj y puerto inyectados: se prueba sobre LocalMeshHub sin esperar nada. No hay timers
 * aqui; la UI llama `tick()` (vence ofertas y publica los agregados de navegacion).
 *
 * Demanda (anonimato, falla CERRADO):
 *  - Nunca sale por el puerto estable: su `from` es el id persistente del dispositivo y un
 *    vendedor podria ligar todas las senales (y todos los dias) a una misma persona. Sin
 *    `demandPortFactory` la demanda NO se publica y la UI lo explica (`demandAvailable: false`).
 *  - Cada ronda abre un puerto efimero NUEVO, se une a la sala, publica, espera un momento a
 *    que el mensaje salga y lo CIERRA. Varias necesidades de la misma ronda comparten puerto;
 *    rondas distintas nunca, asi que `from` no enlaza una ronda con otra.
 */
import type { MeshMessage, MeshPort } from '../contracts';
import { DATOS_PRECISION, cellWithNeighbors, decodeGeohash } from '../geocell';
import { DEFAULT_OPT_IN_PREFERENCES, type OptInPreferences } from '../../lib/marketplaceOptIn';
import {
  type DemandDetail,
  type DemandPulseCell,
  type DemandSignal,
  EphemeralId,
  aggregateDemand,
  buildDemandSignals,
  DAY_MS,
  demandCategoryKey,
  offerCategoryKey,
  parseDemand,
} from './demand';
import { type Match, matchOffers } from './match';
import {
  NavProducts,
  type NavCellMessage,
  type NavProductsConfig,
  type NavReading,
  parseNavCell,
} from './navProducts';
import {
  LIMITS,
  OFFER_CATEGORIES,
  type OfferEnvelope,
  RateLimiter,
  type VendorOffer,
  parseOffer,
} from './offer';
import { EMPTY_PERSISTED, type MarketStore, type PersistedMarket, type ReceivedOffer, createMemoryStore } from './store';
import { TOPIC_DEMAND, TOPIC_NAV, TOPIC_OFFER, isRegionCell, regionRoom } from './topics';
import { type OwnerVehicle } from './vehicles';

/**
 * Consentimiento por defecto. Recibir ofertas queda encendido (todo pasa en el dispositivo y
 * solo revela que se esta en una sala de ciudad); publicar demanda, apagado: es opt-in.
 */
export const DEFAULT_MARKET_PREFS: OptInPreferences = {
  ...DEFAULT_OPT_IN_PREFERENCES,
  categories: [...DEFAULT_OPT_IN_PREFERENCES.categories, ...OFFER_CATEGORIES.map(offerCategoryKey)],
  updatedAt: 0,
};

const MAX_INBOX = 200;
const MAX_SIGNALS_KEPT = 500;
/** Receptor: un nodo no mete mas de 10 ofertas por minuto. */
const RECV_RATE = { max: 10, windowMs: 60_000 };
/** Vendedor: no mas de 5 publicaciones por hora desde esta app. */
const PUBLISH_RATE = { max: 5, windowMs: 60 * 60_000 };
/** Un radio mayor a esto tambien se publica en las celdas vecinas. */
const NEIGHBOR_RADIUS_KM = 15;
const OFFER_TTL_MAX_MS = 7 * DAY_MS;
/** Espera maxima a que aparezca algun par antes de publicar la demanda, y pausa final antes de cerrar. */
const DEMAND_WAIT_MS = 6000;
const DEMAND_SETTLE_MS = 400;
/** Cada cuanto se re-anuncian las ofertas propias. */
const ANNOUNCE_MS = 2 * 60_000;

export interface Dropped {
  unsigned: number;
  blocked: number;
  rateLimited: number;
  invalid: number;
  expired: number;
  duplicate: number;
  foreign: number;
}

export interface MarketState {
  ready: boolean;
  region: string | null;
  peers: number;
  inbox: (Match & { from: string })[];
  received: number;
  dropped: Dropped;
  own: VendorOffer[];
  blockedSellers: string[];
  prefs: OptInPreferences;
  demandEnabled: boolean;
  demandDetail: DemandDetail;
  /** Exactamente lo que se publicaria ahora (o [] si el consentimiento no lo permite). */
  demandPreview: DemandSignal[];
  /** false = no hay identidad desechable: la demanda no se publica (falla cerrado). */
  demandAvailable: boolean;
  demandPulse: DemandPulseCell[];
  navCells: NavCellMessage[];
}

export type PublishResult =
  | { ok: true; offer: VendorOffer }
  | { ok: false; error: string; detail?: string };

export interface MarketDeps {
  port: MeshPort;
  /** Abre un puerto con identidad desechable NUEVA en cada llamada (ver cabecera). */
  demandPortFactory?: () => Promise<MeshPort>;
  /** Espera inyectable (ms); los tests la reemplazan para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  store?: MarketStore;
  rng?: () => number;
  nav?: Partial<NavProductsConfig>;
}

export interface Market {
  getState(): MarketState;
  subscribe(cb: (s: MarketState) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  setRegion(cell: string | null): Promise<void>;
  setVehicles(v: OwnerVehicle[]): void;
  setPrefs(p: Partial<OptInPreferences>): Promise<void>;
  setDemand(enabled: boolean, detail?: DemandDetail): Promise<void>;
  /** Publica la demanda que el consentimiento permita; devuelve lo publicado. */
  publishDemand(): Promise<DemandSignal[]>;
  publishOffer(input: Record<string, unknown>): Promise<PublishResult>;
  withdrawOffer(id: string): Promise<void>;
  blockSeller(from: string): Promise<void>;
  unblockSeller(from: string): Promise<void>;
  reportOffer(id: string, reason: string): Promise<void>;
  dismissOffer(id: string): Promise<void>;
  ingestNav(r: NavReading): boolean;
  tick(): Promise<void>;
}

export function createMarket(deps: MarketDeps): Market {
  const { port } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const openDemandPort = deps.demandPortFactory;
  const clock = deps.clock ?? (() => Date.now());
  const rng = deps.rng ?? Math.random;
  const store = deps.store ?? createMemoryStore();
  const nav = new NavProducts({ clock, ...deps.nav });
  const sid = new EphemeralId(deps.rng);
  const recvLimiter = new RateLimiter(RECV_RATE.max, RECV_RATE.windowMs, clock);
  const pubLimiter = new RateLimiter(PUBLISH_RATE.max, PUBLISH_RATE.windowMs, clock);

  let data: PersistedMarket = structuredClone(EMPTY_PERSISTED);
  let prefs: OptInPreferences = { ...DEFAULT_MARKET_PREFS };
  let vehicles: OwnerVehicle[] = [];
  let signals: { from: string; signal: DemandSignal; at: number }[] = [];
  let navCells = new Map<string, NavCellMessage>();
  let dropped: Dropped = { unsigned: 0, blocked: 0, rateLimited: 0, invalid: 0, expired: 0, duplicate: 0, foreign: 0 };
  const joined = new Set<string>();
  let ready = false;
  let lastAnnounce = 0;
  let unsubs: (() => void)[] = [];
  const listeners = new Set<(s: MarketState) => void>();
  let saving: Promise<void> = Promise.resolve();

  const persist = () => {
    data.prefs = prefs;
    const snapshot = structuredClone(data);
    saving = saving.then(() => store.save(snapshot)).catch(() => {});
    return saving;
  };

  const demandContext = () => ({
    prefs,
    enabled: data.demandEnabled,
    detail: data.demandDetail,
    region: data.region,
    now: clock(),
    sid: sid.current(clock()),
  });

  const compute = (): MarketState => {
    const now = clock();
    const hidden = new Set([...data.blockedOffers, ...data.dismissed]);
    const blocked = new Set(data.blockedSellers);
    const live = data.received.filter((r) => !hidden.has(r.offer.id) && !blocked.has(r.from) && r.offer.validUntil > now);
    const fromOf = new Map(live.map((r) => [r.offer.id, r.from]));
    const matches = data.region
      ? matchOffers(
          live.map((r) => r.offer),
          vehicles,
          { now, ownerCell: data.region, prefs },
        )
      : [];
    const region = data.region;
    return {
      ready,
      region,
      peers: region && joined.has(region) ? port.peerCount('datos', region) : 0,
      inbox: matches.map((m) => ({ ...m, from: fromOf.get(m.offer.id) ?? '' })),
      received: live.length,
      dropped: { ...dropped },
      own: data.own.filter((o) => o.validUntil > now),
      blockedSellers: [...data.blockedSellers],
      prefs,
      demandEnabled: data.demandEnabled,
      demandDetail: data.demandDetail,
      // Sin identidad desechable no se publica nada, asi que tampoco se promete nada en la vista previa.
      demandPreview: openDemandPort ? buildDemandSignals(vehicles, demandContext()) : [],
      demandAvailable: !!openDemandPort,
      demandPulse: aggregateDemand(
        signals.filter((s) => s.at > now - DAY_MS && s.signal.cell === region).map((s) => ({ sid: s.from, signal: s.signal })),
      ),
      navCells: [...navCells.values()].filter((c) => !region || c.cell.startsWith(region)),
    };
  };

  const emit = () => {
    const s = compute();
    for (const cb of listeners) cb(s);
  };

  /** Hasta DEMAND_WAIT_MS por algun par: publicar a una sala sin conectar todavia se pierde. */
  async function waitForPeers(room: string) {
    for (let waited = 0; waited < DEMAND_WAIT_MS && port.peerCount('datos', room) === 0; waited += 250) await sleep(250);
  }

  async function joinRoom(room: string) {
    if (joined.has(room)) return;
    await port.join('datos', room);
    joined.add(room);
  }

  // --- Recepcion -----------------------------------------------------------

  function onOffer(msg: MeshMessage<OfferEnvelope>) {
    const now = clock();
    if (!msg.verified) return void (dropped.unsigned++, emit());
    if (data.blockedSellers.includes(msg.from)) return void (dropped.blocked++, emit());
    if (!recvLimiter.allow(msg.from)) return void (dropped.rateLimited++, emit());
    const env = msg.payload as unknown;
    if (typeof env !== 'object' || env === null || (env as OfferEnvelope).v !== 1) return void (dropped.invalid++, emit());
    const res = parseOffer((env as OfferEnvelope).offer, now);
    if (!res.ok) {
      if (res.error === 'expirada') dropped.expired++;
      else dropped.invalid++;
      return emit();
    }
    const offer = res.offer;
    if (data.blockedOffers.includes(offer.id)) return void (dropped.blocked++, emit());
    const i = data.received.findIndex((r) => r.offer.id === offer.id);
    if (i >= 0) {
      const prev = data.received[i];
      if (prev.from !== msg.from) return void (dropped.foreign++, emit());
      if (offer.createdAt <= prev.offer.createdAt) return void (dropped.duplicate++, emit());
      if (!offer.active) data.received.splice(i, 1);
      else data.received[i] = { offer, from: msg.from, receivedAt: now };
    } else if (offer.active) {
      data.received.push({ offer, from: msg.from, receivedAt: now });
      if (data.received.length > MAX_INBOX) data.received.sort((a, b) => b.receivedAt - a.receivedAt).length = MAX_INBOX;
    }
    void persist();
    emit();
  }

  function onDemand(msg: MeshMessage) {
    const s = parseDemand(msg.payload);
    if (!s) return void (dropped.invalid++, emit());
    // Un nodo = un emisor: el mismo `from` reemplaza lo suyo, no suma.
    signals = signals.filter((x) => !(x.from === msg.from && x.signal.need === s.need && x.signal.cat === s.cat));
    signals.push({ from: msg.from, signal: s, at: clock() });
    if (signals.length > MAX_SIGNALS_KEPT) signals = signals.slice(-MAX_SIGNALS_KEPT);
    emit();
  }

  function onNav(msg: MeshMessage) {
    if (!msg.verified) return void (dropped.unsigned++, emit());
    const c = parseNavCell(msg.payload);
    if (!c) return void (dropped.invalid++, emit());
    const key = `${c.kind}|${c.cell}`;
    const prev = navCells.get(key);
    if (!prev || c.ts >= prev.ts) navCells.set(key, c);
    emit();
  }

  // --- API -----------------------------------------------------------------

  const api: Market = {
    getState: compute,
    subscribe(cb) {
      listeners.add(cb);
      cb(compute());
      return () => void listeners.delete(cb);
    },

    async start() {
      if (ready) return;
      const loaded = await store.load();
      if (loaded) {
        data = { ...structuredClone(EMPTY_PERSISTED), ...loaded };
        if (loaded.prefs) prefs = { ...DEFAULT_MARKET_PREFS, ...loaded.prefs };
      }
      unsubs = [
        port.subscribe<OfferEnvelope>('datos', TOPIC_OFFER, onOffer),
        port.subscribe('datos', TOPIC_NAV, onNav),
        // La demanda llega por el puerto principal: es el que esta en la sala (solo recibe).
        port.subscribe('datos', TOPIC_DEMAND, onDemand),
      ];
      ready = true;
      if (data.region) await joinRoom(data.region);
      emit();
    },

    async stop() {
      for (const u of unsubs) u();
      unsubs = [];
      for (const room of joined) {
        await port.leave('datos', room).catch(() => {});
      }
      joined.clear();
      ready = false;
      await saving;
    },

    async setRegion(cell) {
      if (cell !== null && !isRegionCell(cell)) throw new RangeError(`region invalida: ${cell}`);
      const prev = data.region;
      data.region = cell;
      if (prev && prev !== cell && joined.has(prev)) {
        await port.leave('datos', prev);
        joined.delete(prev);
        // Lo de otra ciudad ya no aplica: la demanda recibida se descarta.
        signals = [];
      }
      // Se muestra ya la ciudad elegida: unirse a la sala en la red real puede tardar segundos.
      await persist();
      emit();
      if (cell && ready) {
        await joinRoom(cell);
        emit();
      }
    },

    setVehicles(v) {
      vehicles = v;
      emit();
    },

    async setPrefs(p) {
      prefs = { ...prefs, ...p, updatedAt: clock() };
      await persist();
      emit();
    },

    async setDemand(enabled, detail) {
      data.demandEnabled = enabled;
      if (detail) data.demandDetail = detail;
      await persist();
      emit();
    },

    async publishDemand() {
      // Falla cerrado: sin puerto desechable no se publica, ni por el estable.
      if (!openDemandPort || !data.region) return [];
      const region = data.region;
      const ctx = demandContext();
      const all = buildDemandSignals(vehicles, ctx);
      // Una vez al dia por necesidad: repetirla no aporta y delataria cuando se esta conectado.
      const fresh = all.filter((s) => ctx.now - (data.lastDemand[`${s.cat}|${s.need}|${s.cls}`] ?? 0) >= DAY_MS);
      if (fresh.length === 0) return [];
      const sent: DemandSignal[] = [];
      let dp: MeshPort | null = null;
      try {
        dp = await openDemandPort();
        await dp.join('datos', region);
        // Hasta que haya a quien entregarle (o se agote la espera): publicar a una sala vacia se pierde.
        for (let waited = 0; waited < DEMAND_WAIT_MS && dp.peerCount('datos', region) === 0; waited += 250) await sleep(250);
        for (const s of fresh) {
          await dp.publish('datos', region, TOPIC_DEMAND, s, { ttlMs: DAY_MS });
          sent.push(s);
        }
        // Un respiro para que el transporte real termine de enviar antes de cerrar el puerto.
        await sleep(DEMAND_SETTLE_MS);
      } catch {
        // Sin red o sin identidad: se queda sin publicar, nunca se cae al puerto estable.
      } finally {
        await dp?.leave('datos', region).catch(() => {});
        await dp?.close().catch(() => {});
      }
      for (const s of sent) data.lastDemand[`${s.cat}|${s.need}|${s.cls}`] = ctx.now;
      if (sent.length) await persist();
      return sent;
    },

    async publishOffer(input) {
      const now = clock();
      const id = typeof input.id === 'string' && input.id ? input.id : `of_${randomId(rng)}`;
      const candidate = { ...input, id, createdAt: now, active: input.active ?? true };
      const res = parseOffer(candidate, now);
      if (!res.ok) return { ok: false, error: res.error, detail: res.detail };
      if (!pubLimiter.allow('self')) return { ok: false, error: 'ritmo', detail: 'Demasiadas publicaciones seguidas; espera un rato.' };
      const offer = res.offer;
      const rooms = roomsFor(offer);
      const ttlMs = Math.min(OFFER_TTL_MAX_MS, offer.validUntil - now);
      for (const room of rooms) {
        await joinRoom(room);
        await waitForPeers(room);
        await port.publish<OfferEnvelope>('datos', room, TOPIC_OFFER, { v: 1, offer }, { sign: true, ttlMs });
      }
      lastAnnounce = now;
      data.own = [offer, ...data.own.filter((o) => o.id !== offer.id)].slice(0, 100);
      await persist();
      emit();
      return { ok: true, offer };
    },

    async withdrawOffer(id) {
      const o = data.own.find((x) => x.id === id);
      if (!o) return;
      const now = clock();
      // Retirar = publicar la misma id, inactiva y mas nueva; los receptores la quitan.
      const off: VendorOffer = { ...o, active: false, createdAt: Math.max(now, o.createdAt + 1) };
      for (const room of roomsFor(off)) {
        await joinRoom(room);
        await port.publish<OfferEnvelope>('datos', room, TOPIC_OFFER, { v: 1, offer: off }, { sign: true, ttlMs: OFFER_TTL_MAX_MS });
      }
      data.own = data.own.filter((x) => x.id !== id);
      await persist();
      emit();
    },

    async blockSeller(from) {
      if (!data.blockedSellers.includes(from)) data.blockedSellers.push(from);
      data.received = data.received.filter((r) => r.from !== from);
      await persist();
      emit();
    },

    async unblockSeller(from) {
      data.blockedSellers = data.blockedSellers.filter((f) => f !== from);
      await persist();
      emit();
    },

    async reportOffer(id, reason) {
      const r = data.received.find((x) => x.offer.id === id);
      // El reporte se queda en este dispositivo (no hay servidor al que enviarlo) y oculta la oferta.
      data.reports.push({ offerId: id, from: r?.from ?? '', reason: reason.slice(0, 200), at: clock() });
      if (!data.blockedOffers.includes(id)) data.blockedOffers.push(id);
      await persist();
      emit();
    },

    async dismissOffer(id) {
      if (!data.dismissed.includes(id)) data.dismissed.push(id);
      await persist();
      emit();
    },

    ingestNav: (r) => nav.ingest(r),

    async tick() {
      const now = clock();
      data.received = data.received.filter((r) => r.offer.validUntil > now);
      data.own = data.own.filter((o) => o.validUntil > now);
      if (ready) await nav.publishRound(port).catch(() => []);
      // Gossip: quien se une despues no vio la oferta; se re-anuncia cada ANNOUNCE_MS (los
      // receptores que ya la tienen la descartan como duplicado).
      if (ready && data.own.length && now - lastAnnounce >= ANNOUNCE_MS) {
        lastAnnounce = now;
        for (const o of data.own) {
          for (const room of roomsFor(o)) {
            await joinRoom(room);
            await port.publish<OfferEnvelope>('datos', room, TOPIC_OFFER, { v: 1, offer: o }, { sign: true, ttlMs: Math.min(OFFER_TTL_MAX_MS, o.validUntil - now) }).catch(() => {});
          }
        }
      }
      emit();
    },
  };
  return api;
}

/** Salas donde publicar: la region de la oferta y, si el radio es grande, las 8 vecinas. */
function roomsFor(offer: VendorOffer): string[] {
  if (offer.radiusKm <= NEIGHBOR_RADIUS_KM) return [offer.region];
  const b = decodeGeohash(offer.region);
  return cellWithNeighbors((b.latLo + b.latHi) / 2, (b.lonLo + b.lonHi) / 2, DATOS_PRECISION);
}

function randomId(rng: () => number): string {
  let s = '';
  if (rng === Math.random && typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint8Array(10);
    crypto.getRandomValues(b);
    s = [...b].map((x) => x.toString(36).padStart(2, '0')).join('');
  } else {
    while (s.length < 16) s += Math.floor(rng() * 36).toString(36);
  }
  return s.slice(0, 16);
}

// Reexporta lo que la UI y los tests piden a este modulo.
export { LIMITS, demandCategoryKey, regionRoom, TOPIC_OFFER, TOPIC_DEMAND, TOPIC_NAV };
export type { ReceivedOffer };
