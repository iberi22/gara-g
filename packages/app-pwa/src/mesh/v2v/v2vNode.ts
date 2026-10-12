/**
 * v2vNode.ts — Orquesta la red V2V en un dispositivo: GPS, sensores, balizas, peligros, tabla
 * de vecinos y estado observable para la UI.
 *
 * Funciona SIN cuenta (modo invitado): las balizas llevan un id efimero y datos de movimiento,
 * nada de usuario, tenant, flota ni VIN, y nada se guarda. Al parar solo se sale de las salas.
 *
 * Todo lo del navegador (geolocalizacion, DeviceMotion, temporizador) entra por dependencias
 * inyectables, asi que el nodo se prueba entero sobre LocalMeshHub con reloj falso.
 *
 * Privacidad de la capa de red: cada mensaje del MeshPort lleva `from` = id del puerto. Con la
 * identidad persistente del dispositivo (getMeshPort) cualquiera podria seguir a un coche por
 * `from` aunque el id de la baliza rote. Por eso el nodo recibe una FABRICA de puertos
 * desechables (`portFactory`, en produccion createEphemeralPort) y rota el puerto a la vez que
 * el id efimero: al cambiar la ranura (10 min / dia UTC) abre un puerto nuevo, se une a las
 * mismas salas, cambia publicacion y suscripcion, y recien entonces cierra el viejo. Hasta el
 * cambio se sigue emitiendo con el id viejo por el puerto viejo, asi que id de paquete y
 * `from` cambian en el mismo instante. La tabla de vecinos no se toca.
 *
 * Defensas de entrada (el aire es hostil):
 *  - limite por emisor: mas de 5 mensajes en 1 s => se descartan y el emisor queda castigado
 *    5 s (un vecino honesto manda ~1/s);
 *  - deduplicacion por (tipo,id,ts) y las balizas de un id solo avanzan en el tiempo;
 *  - los peligros se aceptan solo si el puerto confirma la firma (`verified`);
 *  - tablas acotadas: 200 vecinos y 100 peligros, para que un enjambre de ids falsos no
 *    agote la memoria del telefono.
 */
import type { MeshMessage, MeshPort } from '../contracts';
import { createEphemeralIdSource, type EphemeralIdSource } from './ephemeralId';
import { createMotionDetector, type MotionDetector } from './motion';
import {
  BEACON_TOPIC, BEACON_TTL_MS, Events, HAZARD_TOPIC, HAZARD_TTL_MS, decodePacket, encodePacketB64,
  type V2VPacket, type VehicleClassName,
} from './packet';
import { createRoomManager, type RoomManager } from './rooms';
import {
  assessAll, hazardMaxAgeMs, toEnu, type Assessment, type RiskLevel, type VehicleState,
} from './risk';

export interface GeoFix {
  lat: number;
  lon: number;
  accuracyM: number;
  speedMps: number | null;
  headingDeg: number | null;
}
export interface GeoSource {
  watch(onFix: (f: GeoFix) => void, onError: (message: string) => void): () => void;
}
export interface MotionSource {
  /** Se llama desde el gesto del usuario (iOS pide permiso). */
  start(onSample: (ax: number, ay: number, az: number) => void): Promise<{ ok: boolean; reason?: string }>;
  stop(): void;
}

export const LIMITS = {
  maxNeighbors: 200,
  maxHazards: 100,
  floodMaxPerSecond: 5,
  floodPenaltyMs: 5_000,
  neighborTtlMs: 3_500,
  beaconEveryMs: 1_000,
  /** Rodando, sin fix reciente no se emite: una baliza con posicion vieja es peor que ninguna. */
  fixMaxAgeMs: 3_000,
  /** Parado, el navegador no repite el fix (watchPosition solo avisa si cambia): su posicion sigue valiendo. */
  stoppedFixMaxAgeMs: 60_000,
  maxBeaconAccuracyM: 50,
  viewRadiusM: 600,
  hardBrakeFlagMs: 8_000,
  crashFlagMs: 120_000,
  dedupMs: 70_000,
  /** Si la rotacion de puerto falla y pasa este tiempo, se deja de emitir en vez de seguir con el `from` viejo. */
  rotationGraceMs: 30_000,
} as const;

export interface NeighborView {
  id: number;
  e: number;
  n: number;
  headingDeg: number;
  speedMps: number;
  vehicleClass: VehicleClassName;
  level: RiskLevel;
  distanceM: number;
  events: number;
}
export interface HazardView {
  key: string;
  e: number;
  n: number;
  events: number;
  level: RiskLevel;
  distanceM: number;
  ahead: boolean;
}
export interface V2VState {
  status: 'idle' | 'starting' | 'active' | 'error';
  error: string | null;
  /** Aviso de que el sensor de movimiento no esta (el radar sigue sin deteccion de eventos). */
  motionNote: string | null;
  selfId: number | null;
  own: { speedMps: number; headingDeg: number; accuracyM: number; vehicleClass: VehicleClassName } | null;
  neighbors: NeighborView[];
  hazards: HazardView[];
  /** Vecinos vigentes en la tabla ("N vehiculos cerca"). */
  nearby: number;
  level: RiskLevel;
  headline: { level: RiskLevel; message: string; key: string } | null;
  cell: string | null;
  dropped: { flood: number; invalid: number; duplicate: number; unverified: number };
}

export interface V2VNodeDeps {
  /** Fabrica de puertos desechables: una llamada por ranura de id. El nodo cierra los que abre. */
  portFactory?: () => Promise<MeshPort>;
  /** Puerto fijo (pruebas): sin rotacion y el nodo no lo cierra. Si falta `portFactory`, es obligatorio. */
  port?: MeshPort;
  now?: () => number;
  geo?: GeoSource;
  motion?: MotionSource;
  idSource?: EphemeralIdSource;
  /** Programa `fn` cada `ms`; devuelve como cancelar. Por defecto setInterval. */
  schedule?: (fn: () => void, ms: number) => () => void;
  requireVerifiedHazards?: boolean;
  hysteresisM?: number;
}

export interface V2VNode {
  getState(): V2VState;
  subscribe(cb: (s: V2VState) => void): () => void;
  start(opts?: { vehicleClass?: VehicleClassName }): Promise<void>;
  stop(): Promise<void>;
  /** Un ciclo: caduca, evalua, emite baliza. El temporizador lo llama cada 1 s; los tests, a mano. */
  tick(): Promise<void>;
}

const FIXED = (n: number) => Math.round(n);

export function createV2VNode(deps: V2VNodeDeps): V2VNode {
  if (!deps.portFactory && !deps.port) throw new Error('createV2VNode necesita portFactory o port');
  const factory: () => Promise<MeshPort> = deps.portFactory ?? (async () => deps.port!);
  const ownsPorts = !!deps.portFactory;
  const now = deps.now ?? (() => Date.now());
  const geo = deps.geo ?? browserGeoSource();
  const motionSource = deps.motion ?? browserMotionSource(now);
  const idSource = deps.idSource ?? createEphemeralIdSource({ now });
  const schedule = deps.schedule ?? ((fn, ms) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  });
  const requireVerified = deps.requireVerifiedHazards ?? true;
  // Puerto activo y lo que cuelga de el; cambian en cada rotacion.
  let port: MeshPort | null = null;
  let rooms: RoomManager = emptyRooms();
  let portSubs: (() => void)[] = [];
  let portSlot = '';
  let activeId = 0;
  let prevId: number | null = null;
  let rotating = false;
  let rotationDueAt: number | null = null;
  let startToken = 0;

  function emptyRooms(): RoomManager {
    return { center: null, cells: [], update: async () => ({ center: '', cells: [], joined: [], left: [], changed: false }), leaveAll: async () => {} };
  }

  const listeners = new Set<(s: V2VState) => void>();
  const neighbors = new Map<number, VehicleState>();
  const hazards = new Map<string, VehicleState>();
  const lastBeaconTs = new Map<number, number>();
  const seen = new Map<string, number>();
  const rate = new Map<string, { stamps: number[]; blockedUntil: number }>();
  const ownEventUntil = new Map<number, number>();
  const dropped = { flood: 0, invalid: 0, duplicate: 0, unverified: 0 };

  let status: V2VState['status'] = 'idle';
  let error: string | null = null;
  let motionNote: string | null = null;
  let vehicleClass: VehicleClassName = 'carro';
  let own: VehicleState | null = null;
  let ownFixAt = 0;
  let prev: { lat: number; lon: number; ts: number } | null = null;
  let assessment: Assessment = { level: 'none', neighbors: [], hazards: [], headline: null };
  let stops: (() => void)[] = [];
  let roomsQueue: Promise<unknown> = Promise.resolve();
  let detector: MotionDetector | null = null;
  let state: V2VState = snapshot();

  function snapshot(): V2VState {
    const views: NeighborView[] = [];
    for (const r of assessment.neighbors) {
      const nb = neighbors.get(r.id);
      if (!nb || r.ignored || r.distanceM > LIMITS.viewRadiusM) continue;
      views.push({
        id: r.id, e: r.e, n: r.n, headingDeg: nb.headingDeg, speedMps: nb.speedMps, vehicleClass: nb.vehicleClass,
        level: r.level, distanceM: r.distanceM, events: nb.events,
      });
    }
    const hz: HazardView[] = assessment.hazards
      .filter((h) => h.distanceM <= LIMITS.viewRadiusM)
      .map((h) => ({ key: h.key, e: h.e, n: h.n, events: h.events, level: h.level, distanceM: h.distanceM, ahead: h.ahead }));
    return {
      status, error, motionNote,
      selfId: status === 'active' || status === 'starting' ? activeId : null,
      own: own ? { speedMps: own.speedMps, headingDeg: own.headingDeg, accuracyM: own.accuracyM, vehicleClass } : null,
      neighbors: views,
      hazards: hz,
      nearby: views.length,
      level: assessment.level,
      headline: assessment.headline,
      cell: rooms.center,
      dropped: { ...dropped },
    };
  }

  function notify() {
    state = snapshot();
    for (const cb of listeners) cb(state);
  }

  function evaluate() {
    const t = now();
    for (const [id, nb] of neighbors) if (t - nb.ts > LIMITS.neighborTtlMs) neighbors.delete(id);
    for (const [k, hz] of hazards) if (t - hz.ts > hazardMaxAgeMs(hz.events)) hazards.delete(k);
    for (const [k, until] of seen) if (until < t) seen.delete(k);
    for (const [id, ts] of lastBeaconTs) if (!neighbors.has(id) && t - ts > LIMITS.dedupMs) lastBeaconTs.delete(id);
    for (const [from, r] of rate) if (r.blockedUntil < t && r.stamps.every((s) => t - s > 1_000)) rate.delete(from);
    for (const [ev, until] of ownEventUntil) if (until < t) ownEventUntil.delete(ev);
    assessment = own
      ? assessAll(own, [...neighbors.values()], [...hazards.values()], t)
      : { level: 'none', neighbors: [], hazards: [], headline: null };
  }

  function ownEvents(): number {
    let m = 0;
    for (const ev of ownEventUntil.keys()) m |= ev;
    return m;
  }

  function packetOf(kind: 'beacon' | 'hazard', events: number): V2VPacket | null {
    if (!own) return null;
    return {
      kind,
      id: activeId,
      ts: now(),
      latE6: FIXED(own.lat * 1e6),
      lonE6: FIXED(own.lon * 1e6),
      speedCms: Math.min(12_000, Math.max(0, FIXED(own.speedMps * 100))),
      heading: ((FIXED(own.headingDeg) % 360) + 360) % 360,
      accuracyM: Math.min(255, Math.max(0, FIXED(own.accuracyM))),
      vehicleClass,
      events,
    };
  }

  function fail(e: unknown) {
    // Un fallo de publicacion no debe matar el radar: se anota y el siguiente ciclo reintenta.
    error = e instanceof Error ? e.message : String(e);
  }

  async function sendBeacon() {
    const room = rooms.center;
    if (!port || !room || !own || now() - ownFixAt > (own.speedMps < 1 ? LIMITS.stoppedFixMaxAgeMs : LIMITS.fixMaxAgeMs) || own.accuracyM > LIMITS.maxBeaconAccuracyM) return;
    const p = packetOf('beacon', ownEvents());
    if (!p) return;
    if (rotationDueAt !== null && now() - rotationDueAt > LIMITS.rotationGraceMs) return;
    try {
      await port.publish('v2v', room, BEACON_TOPIC, encodePacketB64(p, now()), { ttlMs: BEACON_TTL_MS });
    } catch (e) {
      fail(e);
    }
  }

  async function sendHazard(event: number) {
    const room = rooms.center;
    if (!port || !room || !own) return;
    const p = packetOf('hazard', event);
    if (!p) return;
    try {
      await port.publish('v2v', room, HAZARD_TOPIC, encodePacketB64(p, now()), { sign: true, ttlMs: HAZARD_TTL_MS });
    } catch (e) {
      fail(e);
    }
  }

  function onDetected(event: number) {
    const t = now();
    // La baliza lleva la marca unos segundos: el coche de atras la ve en 1 s sin esperar a la firma.
    if (event === Events.HARD_BRAKE) ownEventUntil.set(event, t + LIMITS.hardBrakeFlagMs);
    if (event === Events.CRASH) ownEventUntil.set(event, t + LIMITS.crashFlagMs);
    if (event === Events.STOPPED_VEHICLE) ownEventUntil.set(event, Number.MAX_SAFE_INTEGER);
    void sendHazard(event).then(notify);
  }

  /** Limite por emisor: true si el mensaje se acepta. */
  function admit(from: string): boolean {
    const t = now();
    let r = rate.get(from);
    if (!r) rate.set(from, (r = { stamps: [], blockedUntil: 0 }));
    if (t < r.blockedUntil) return false;
    r.stamps = r.stamps.filter((s) => t - s < 1_000);
    if (r.stamps.length >= LIMITS.floodMaxPerSecond) {
      r.blockedUntil = t + LIMITS.floodPenaltyMs;
      return false;
    }
    r.stamps.push(t);
    return true;
  }

  function fromPacket(p: V2VPacket): VehicleState {
    return {
      id: p.id,
      lat: p.latE6 / 1e6,
      lon: p.lonE6 / 1e6,
      speedMps: p.speedCms / 100,
      headingDeg: p.heading,
      accuracyM: p.accuracyM,
      ts: p.ts,
      vehicleClass: p.vehicleClass,
      events: p.events,
    };
  }

  function onMessage(msg: MeshMessage, kind: 'beacon' | 'hazard') {
    if (status !== 'active') return;
    if (!admit(msg.from)) {
      dropped.flood++;
      return;
    }
    const t = now();
    const res = decodePacket(msg.payload, t);
    if (!res.ok || res.packet.kind !== kind) {
      dropped.invalid++;
      return;
    }
    const p = res.packet;
    if (p.id === activeId || p.id === prevId) return; // eco de uno mismo
    if (kind === 'hazard' && requireVerified && !msg.verified) {
      dropped.unverified++;
      return;
    }
    const dedupKey = `${kind}:${p.id}:${p.ts}`;
    if (seen.has(dedupKey) || (kind === 'beacon' && p.ts <= (lastBeaconTs.get(p.id) ?? 0))) {
      dropped.duplicate++;
      return;
    }
    seen.set(dedupKey, t + LIMITS.dedupMs);
    const st = fromPacket(p);
    if (kind === 'beacon') {
      lastBeaconTs.set(p.id, p.ts);
      if (!neighbors.has(p.id) && neighbors.size >= LIMITS.maxNeighbors) evictFarthest(neighbors);
      neighbors.set(p.id, st);
    } else {
      const k = `${p.id}:${p.ts}`;
      if (!hazards.has(k) && hazards.size >= LIMITS.maxHazards) evictFarthest(hazards);
      hazards.set(k, st);
    }
    evaluate();
    notify();
  }

  /** Tabla llena: se descarta el mas lejano (el mas irrelevante para el riesgo). */
  function evictFarthest<K>(table: Map<K, VehicleState>) {
    if (!own) {
      const first = table.keys().next();
      if (!first.done) table.delete(first.value);
      return;
    }
    let worst: K | undefined;
    let worstD = -1;
    for (const [k, v] of table) {
      const e = toEnu(own, v.lat, v.lon);
      const d = Math.hypot(e.e, e.n);
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst !== undefined) table.delete(worst);
  }

  function onFix(f: GeoFix) {
    const t = now();
    let speed = f.speedMps !== null && Number.isFinite(f.speedMps) && f.speedMps >= 0 ? f.speedMps : null;
    let heading = f.headingDeg !== null && Number.isFinite(f.headingDeg) ? f.headingDeg : null;
    let moved = 0;
    if (prev) {
      const e = toEnu(prev, f.lat, f.lon);
      moved = Math.hypot(e.e, e.n);
      const dt = (t - prev.ts) / 1000;
      if (speed === null && dt >= 0.5 && dt <= 5) speed = moved / dt;
      if ((heading === null || (speed ?? 0) < 1) && moved >= 3 && (speed ?? 0) >= 1) {
        heading = ((Math.atan2(e.e, e.n) * 180) / Math.PI + 360) % 360;
      }
    }
    const speedMps = speed ?? 0;
    // Con el rumbo del GPS poco fiable (parado) se conserva el ultimo conocido.
    const headingDeg = heading !== null && speedMps >= 1 ? heading : (own?.headingDeg ?? heading ?? 0);
    prev = { lat: f.lat, lon: f.lon, ts: t };
    own = {
      id: activeId, lat: f.lat, lon: f.lon, speedMps, headingDeg: ((headingDeg % 360) + 360) % 360,
      accuracyM: f.accuracyM, ts: t, vehicleClass, events: ownEvents(),
    };
    ownFixAt = t;
    if (speedMps >= 2) ownEventUntil.delete(Events.STOPPED_VEHICLE);
    detector?.pushSpeed(t, speedMps);
    // Salas en serie: dos fixes seguidos no deben cruzar sus join/leave.
    roomsQueue = roomsQueue
      .then(() => rooms.update(f.lat, f.lon))
      .then(() => {
        if (status === 'starting') status = 'active';
        notify();
      })
      .catch(fail);
    evaluate();
    notify();
  }

  function attach(p: MeshPort): (() => void)[] {
    return [
      p.subscribe('v2v', BEACON_TOPIC, (m) => onMessage(m, 'beacon')),
      p.subscribe('v2v', HAZARD_TOPIC, (m) => onMessage(m, 'hazard')),
    ];
  }

  /** Cambia de puerto (y de id) sin huecos: el nuevo se prepara entero antes de soltar el viejo. */
  async function rotatePort() {
    if (rotating || status !== 'active' || !ownsPorts) {
      // Con puerto fijo (pruebas) solo cambia el id, que sigue a la ranura.
      if (!ownsPorts && status === 'active' && idSource.slot() !== portSlot) {
        prevId = activeId;
        activeId = idSource.current();
        portSlot = idSource.slot();
        rotationDueAt = null;
      }
      return;
    }
    rotating = true;
    const token = startToken;
    try {
      const slot = idSource.slot();
      const id = idSource.current();
      const np = await factory();
      if (token !== startToken || status !== 'active') {
        await np.close();
        return;
      }
      const nsubs = attach(np);
      const nrooms = createRoomManager(np, { hysteresisM: deps.hysteresisM });
      await roomsQueue.catch(() => undefined);
      if (own) await nrooms.update(own.lat, own.lon);
      const old = { port, rooms, subs: portSubs };
      port = np;
      rooms = nrooms;
      portSubs = nsubs;
      prevId = activeId;
      activeId = id;
      portSlot = slot;
      rotationDueAt = null;
      for (const u of old.subs) u();
      await old.rooms.leaveAll().catch(() => undefined);
      await old.port?.close().catch(() => undefined);
    } catch (e) {
      fail(e); // se reintenta en el siguiente ciclo; mientras tanto sigue el puerto viejo (con limite de gracia)
    } finally {
      rotating = false;
    }
  }

  async function tick() {
    if (status !== 'active') return;
    evaluate();
    const t = now();
    let moving = 0;
    if (own) {
      for (const nb of neighbors.values()) {
        const e = toEnu(own, nb.lat, nb.lon);
        if (nb.speedMps >= 3 && Math.hypot(e.e, e.n) <= 200 && t - nb.ts <= LIMITS.neighborTtlMs) moving++;
      }
    }
    detector?.tick(t, moving);
    if (idSource.slot() !== portSlot) {
      rotationDueAt ??= t;
      await rotatePort();
    }
    await sendBeacon();
    notify();
  }

  return {
    // Fresco, no el ultimo notificado: los descartes (flood, invalidos) no despiertan a la UI.
    getState: () => (state = snapshot()),
    subscribe(cb) {
      listeners.add(cb);
      cb(state);
      return () => listeners.delete(cb);
    },

    async start(opts = {}) {
      if (status === 'active' || status === 'starting') return;
      vehicleClass = opts.vehicleClass ?? 'carro';
      status = 'starting';
      error = null;
      motionNote = null;
      dropped.flood = dropped.invalid = dropped.duplicate = dropped.unverified = 0;
      detector = createMotionDetector((e) => onDetected(e.event));
      notify();
      // El permiso de movimiento (iOS) debe pedirse dentro del gesto del usuario: antes de cualquier await.
      const motionStart = motionSource.start((ax, ay, az) => detector?.pushMotion({ ts: now(), ax, ay, az }));
      // Primer puerto (y primer id) de esta sesion; los fixes de GPS esperan a que este listo.
      const token = ++startToken;
      activeId = idSource.current();
      portSlot = idSource.slot();
      prevId = null;
      rotationDueAt = null;
      roomsQueue = factory()
        .then(async (p) => {
          if (token !== startToken || status === 'idle') {
            if (ownsPorts) await p.close();
            return;
          }
          port = p;
          portSubs = attach(p);
          rooms = createRoomManager(p, { hysteresisM: deps.hysteresisM });
        })
        .catch((e) => {
          error = e instanceof Error ? e.message : String(e);
          status = 'error';
          notify();
        });
      stops.push(
        geo.watch(onFix, (message) => {
          error = message;
          status = 'error';
          notify();
        }),
      );
      stops.push(() => motionSource.stop());
      stops.push(schedule(() => void tick(), LIMITS.beaconEveryMs));
      const m = await motionStart;
      if (!m.ok) motionNote = m.reason ?? 'Sin sensor de movimiento: no se detectarán frenadas ni choques.';
      notify();
    },

    async stop() {
      for (const s of stops) s();
      stops = [];
      startToken++;
      await roomsQueue.catch(() => undefined);
      for (const u of portSubs) u();
      portSubs = [];
      await rooms.leaveAll().catch(() => undefined);
      // Los puertos desechables son nuestros: se cierran. Uno inyectado fijo no.
      if (ownsPorts) await port?.close().catch(() => undefined);
      port = null;
      rooms = emptyRooms();
      neighbors.clear();
      hazards.clear();
      lastBeaconTs.clear();
      seen.clear();
      rate.clear();
      ownEventUntil.clear();
      own = null;
      prev = null;
      detector = null;
      assessment = { level: 'none', neighbors: [], hazards: [], headline: null };
      status = 'idle';
      notify();
    },

    tick,
  };
}

/** Geolocalizacion real: alta precision, sin cache. */
export function browserGeoSource(): GeoSource {
  return {
    watch(onFix, onError) {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        onError('Este dispositivo no tiene geolocalización.');
        return () => {};
      }
      const id = navigator.geolocation.watchPosition(
        (pos) =>
          onFix({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
            speedMps: pos.coords.speed,
            headingDeg: pos.coords.heading,
          }),
        (err) =>
          onError(
            err.code === err.PERMISSION_DENIED
              ? 'Permiso de ubicación denegado: el radar necesita tu posición.'
              : 'No se pudo obtener la ubicación.',
          ),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },
  };
}

/** DeviceMotion real. En iOS pide permiso (requiere gesto). Sin sensor, el radar sigue sin detectar eventos. */
export function browserMotionSource(_now: () => number): MotionSource {
  let handler: ((e: DeviceMotionEvent) => void) | null = null;
  return {
    async start(onSample) {
      if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') {
        return { ok: false, reason: 'Sin sensor de movimiento: no se detectarán frenadas ni choques.' };
      }
      const req = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
      if (typeof req === 'function') {
        try {
          if ((await req.call(DeviceMotionEvent)) !== 'granted') {
            return { ok: false, reason: 'Permiso de movimiento denegado: no se detectarán frenadas ni choques.' };
          }
        } catch {
          return { ok: false, reason: 'No se pudo pedir el permiso de movimiento.' };
        }
      }
      handler = (e) => {
        const a = e.accelerationIncludingGravity;
        if (a && a.x != null && a.y != null && a.z != null) onSample(a.x, a.y, a.z);
      };
      window.addEventListener('devicemotion', handler);
      return { ok: true };
    },
    stop() {
      if (handler) window.removeEventListener('devicemotion', handler);
      handler = null;
    },
  };
}
