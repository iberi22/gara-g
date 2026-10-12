/**
 * risk.ts — Riesgo de colision entre el vehiculo propio y cada vecino, y peligros por delante.
 *
 * Todo en metros sobre un plano local ENU centrado en el propio vehiculo (este, norte): a
 * escala de cientos de metros la curvatura no importa. Cada vecino se extrapola a "ahora"
 * con su ultima velocidad (dead reckoning), porque una baliza llega con hasta ~1 s de edad.
 *
 * Colision (vecino vs. yo), con r = posicion relativa y w = velocidad relativa:
 *   - velocidad de acercamiento  = -(r·w)/|r|
 *   - tiempo al punto de mayor cercania  t* = -(r·w)/|w|²  (si ya se alejan, no hay futuro)
 *   - distancia en ese punto     dmin = |r + w·t*|
 *
 * Umbrales (constantes exportadas abajo; el 8 s y el 4 s siguen la practica de los avisos de
 * colision frontal: 4 s es el tiempo que un conductor necesita para percibir y frenar, 8 s da
 * margen para avisar con antelacion):
 *   peligro: t* <= 4 s  y dmin <= 7 m  (+holgura por precision GPS)
 *   aviso:   t* <= 8 s  y dmin <= 15 m (+holgura)
 *   holgura = min(8, 0.25 * (precisionPropia + precisionVecino)) metros
 * Se ignora: vecino caducado (> 3,5 s), precision peor de 30 m, acercamiento < 1 m/s.
 *
 * Trafico en sentido contrario: en una via de dos sentidos los coches se cruzan a ~3,5 m
 * laterales cada minuto y eso NO es un choque, pero con la precision de un GPS de movil no
 * se distingue "carril contrario" de "mi carril". Compromiso: para pares de frente (rumbos
 * opuestos a mas de 135 grados) el radio es de 2,5 m (peligro) / 3,5 m (aviso) SIN holgura, y
 * se exige precision <= 12 m en los dos. Un "cara a cara" real en el mismo carril sigue
 * dando peligro; un cruce normal en carriles distintos no. Una vez cruzados (se alejan) el
 * par se ignora. Es el punto que mas necesita una prueba en carretera real.
 *
 * Peligros (eventos): vale uno "por delante" si cae en un cono de +-30 grados del rumbo propio,
 * a menos de 50 m de la trayectoria lateralmente y dentro de una ventana de distancia
 * max(80 m, velocidad x 15 s) acotada a 500 m. Uno detras o al lado no se avisa. Los criticos
 * (CHOQUE, FRENADA, DETENIDO, CONTRAMANO) dan peligro si se llega en <= 6 s y aviso hasta 15 s;
 * bache y luces de emergencia solo dan aviso. Un peligro emitido desde la otra calzada
 * (rumbo opuesto y mas de 8 m al lado) se ignora.
 */
import { Events, type VehicleClassName } from './packet';

export type RiskLevel = 'none' | 'aviso' | 'peligro';
const ORDER: Record<RiskLevel, number> = { none: 0, aviso: 1, peligro: 2 };
export const maxLevel = (a: RiskLevel, b: RiskLevel): RiskLevel => (ORDER[a] >= ORDER[b] ? a : b);

export const THRESHOLDS = {
  staleMs: 3_500,
  maxAccuracyM: 30,
  maxOncomingAccuracyM: 12,
  minClosingMps: 1,
  /** Por debajo de esta velocidad el rumbo del GPS es ruido: se trata como parado. */
  minMovingMps: 1,
  peligroTtcS: 4,
  avisoTtcS: 8,
  peligroRadiusM: 7,
  avisoRadiusM: 15,
  oncomingPeligroRadiusM: 2.5,
  oncomingAvisoRadiusM: 3.5,
  oncomingMinAngleDeg: 135,
  slackMaxM: 8,
  coneDeg: 30,
  hazardLateralM: 50,
  hazardMinWindowM: 80,
  hazardMaxWindowM: 500,
  hazardWindowS: 15,
  hazardPeligroEtaS: 6,
  hazardSoftEtaS: 10,
  otherCarriagewayM: 8,
  /** Ante el propio vehiculo parado no hay "adelante": sin aviso de peligros. */
  minOwnSpeedMps: 2,
  /** Cerca y rodando (relleno de carril, adelantamiento): aviso aunque no se acerquen. */
  proximityM: 4,
} as const;

/** Vigencia de un peligro por tipo: una frenada brusca deja de importar pronto; un bache o un coche parado no. */
export const HAZARD_MAX_AGE_MS = { fast: 15_000, slow: 60_000 } as const;

export interface VehicleState {
  /** Id efimero. */
  id: number;
  lat: number;
  lon: number;
  speedMps: number;
  /** Grados 0-359, 0 = norte. */
  headingDeg: number;
  accuracyM: number;
  ts: number;
  vehicleClass: VehicleClassName;
  events: number;
}

export interface Enu {
  e: number;
  n: number;
}

const M_PER_DEG = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;

/** Posicion de `lat,lon` respecto a `origin`, en metros (este, norte). */
export function toEnu(origin: { lat: number; lon: number }, lat: number, lon: number): Enu {
  return {
    e: (lon - origin.lon) * Math.cos(rad(origin.lat)) * M_PER_DEG,
    n: (lat - origin.lat) * M_PER_DEG,
  };
}

/** Diferencia angular con signo en (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (((a - b) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

function velocity(s: { speedMps: number; headingDeg: number }): Enu {
  if (s.speedMps < THRESHOLDS.minMovingMps) return { e: 0, n: 0 };
  return { e: s.speedMps * Math.sin(rad(s.headingDeg)), n: s.speedMps * Math.cos(rad(s.headingDeg)) };
}

export interface NeighborRisk {
  id: number;
  level: RiskLevel;
  /** Posicion extrapolada a ahora, respecto al propio vehiculo (m). */
  e: number;
  n: number;
  distanceM: number;
  /** Segundos al punto de mayor cercania; null si no se acercan. */
  ttcS: number | null;
  dminM: number;
  closingMps: number;
  /** Motivo de que se ignore (caducado, precision...) o texto del riesgo. */
  reason: string;
  ignored: boolean;
}

export const CRITICAL_EVENTS = Events.CRASH | Events.HARD_BRAKE | Events.STOPPED_VEHICLE | Events.WRONG_WAY;
const SOFT_EVENTS = Events.POTHOLE | Events.HAZARD_LIGHTS;

function ignored(nb: VehicleState, reason: string): NeighborRisk {
  return { id: nb.id, level: 'none', e: 0, n: 0, distanceM: 0, ttcS: null, dminM: Infinity, closingMps: 0, reason, ignored: true };
}

export function assessNeighbor(own: VehicleState, nb: VehicleState, now: number): NeighborRisk {
  const T = THRESHOLDS;
  const age = now - nb.ts;
  if (age > T.staleMs) return ignored(nb, 'caducado');
  if (age < -5_000) return ignored(nb, 'reloj adelantado');
  if (nb.accuracyM > T.maxAccuracyM || own.accuracyM > T.maxAccuracyM) return ignored(nb, 'precision baja');

  const v = velocity(nb);
  const vo = velocity(own);
  const ageS = Math.max(0, age) / 1000;
  const p = toEnu(own, nb.lat, nb.lon);
  const r = { e: p.e + v.e * ageS, n: p.n + v.n * ageS };
  const w = { e: v.e - vo.e, n: v.n - vo.n };
  const dist = Math.hypot(r.e, r.n);
  const rw = r.e * w.e + r.n * w.n;
  const w2 = w.e * w.e + w.n * w.n;
  const closing = dist > 0.01 ? -rw / dist : 0;
  const diverging = rw > 0;

  let ttc: number | null = null;
  let dmin = dist;
  if (!diverging && w2 >= 0.25) {
    ttc = -rw / w2;
    dmin = Math.hypot(r.e + w.e * ttc, r.n + w.n * ttc);
  }

  const oncoming =
    own.speedMps >= T.minMovingMps &&
    nb.speedMps >= T.minMovingMps &&
    Math.abs(angleDiff(own.headingDeg, nb.headingDeg)) > T.oncomingMinAngleDeg;
  if (oncoming && (nb.accuracyM > T.maxOncomingAccuracyM || own.accuracyM > T.maxOncomingAccuracyM)) {
    return { ...ignored(nb, 'precision insuficiente para cara a cara'), e: r.e, n: r.n, distanceM: dist };
  }

  // Mismo sentido: el cierre es un alcance (me acerco al de delante), no un cruce.
  const sameWay = Math.abs(angleDiff(own.headingDeg, nb.headingDeg)) < 45;
  const slack = oncoming ? 0 : Math.min(T.slackMaxM, 0.25 * (own.accuracyM + nb.accuracyM));
  const rP = oncoming ? T.oncomingPeligroRadiusM : T.peligroRadiusM + slack;
  const rA = oncoming ? T.oncomingAvisoRadiusM : T.avisoRadiusM + slack;

  let level: RiskLevel = 'none';
  let reason = 'sin riesgo';
  if (closing >= T.minClosingMps && ttc !== null) {
    if (ttc <= T.peligroTtcS && dmin <= rP) {
      level = 'peligro';
      reason = oncoming ? 'vehiculo de frente' : 'colision inminente';
    } else if (ttc <= T.avisoTtcS && dmin <= rA) {
      level = 'aviso';
      reason = oncoming ? 'vehiculo de frente' : sameWay ? 'alcance' : 'trayectoria cruzada';
    }
  } else if (!oncoming && !diverging && own.speedMps >= T.minOwnSpeedMps && dist < T.proximityM) {
    level = 'aviso';
    reason = 'vehiculo muy cerca';
  }

  return {
    id: nb.id,
    level,
    e: r.e,
    n: r.n,
    distanceM: dist,
    ttcS: ttc,
    dminM: dmin,
    closingMps: closing,
    reason,
    ignored: false,
  };
}

export interface HazardRisk {
  /** Clave estable (id:ts) para que la UI no repita un aviso. */
  key: string;
  level: RiskLevel;
  events: number;
  e: number;
  n: number;
  distanceM: number;
  /** Distancia a lo largo del rumbo propio (m); negativa = detras. */
  alongM: number;
  etaS: number | null;
  ahead: boolean;
  reason: string;
}

export function hazardMaxAgeMs(events: number): number {
  return events & (Events.HARD_BRAKE | Events.CRASH) ? HAZARD_MAX_AGE_MS.fast : HAZARD_MAX_AGE_MS.slow;
}

/**
 * `moving`: el origen del evento es un vecino en marcha (frenada de un coche que sigue
 * rodando), asi que el tiempo de alcance usa la velocidad de cierre y no la propia.
 */
export function assessHazard(own: VehicleState, hz: VehicleState, now: number, moving = false): HazardRisk {
  const T = THRESHOLDS;
  const key = `${hz.id}:${hz.ts}`;
  const none = (reason: string, extra: Partial<HazardRisk> = {}): HazardRisk => ({
    key, level: 'none', events: hz.events, e: 0, n: 0, distanceM: 0, alongM: 0, etaS: null, ahead: false, reason, ...extra,
  });
  const age = now - hz.ts;
  if (age > hazardMaxAgeMs(hz.events)) return none('caducado');
  if (age < -5_000) return none('reloj adelantado');
  if (own.accuracyM > T.maxAccuracyM) return none('precision baja');

  const ageS = Math.max(0, age) / 1000;
  const v = moving ? velocity(hz) : { e: 0, n: 0 };
  const p = toEnu(own, hz.lat, hz.lon);
  const pos = { e: p.e + v.e * Math.min(ageS, T.staleMs / 1000), n: p.n + v.n * Math.min(ageS, T.staleMs / 1000) };
  const dist = Math.hypot(pos.e, pos.n);
  const base = { e: pos.e, n: pos.n, distanceM: dist };
  if (own.speedMps < T.minOwnSpeedMps) return none('propio detenido', base);

  const bearing = (Math.atan2(pos.e, pos.n) * 180) / Math.PI;
  const delta = angleDiff(bearing, own.headingDeg);
  const along = dist * Math.cos(rad(delta));
  const lateral = Math.abs(dist * Math.sin(rad(delta)));
  const window = Math.min(T.hazardMaxWindowM, Math.max(T.hazardMinWindowM, own.speedMps * T.hazardWindowS));
  const sep = { ...base, alongM: along };
  if (Math.abs(delta) > T.coneDeg) return none('no esta por delante', sep);
  if (lateral > T.hazardLateralM) return none('lejos de la trayectoria', sep);
  if (along > window) return none('fuera de la ventana', { ...sep, ahead: true });
  if (
    Math.abs(angleDiff(own.headingDeg, hz.headingDeg)) > T.oncomingMinAngleDeg &&
    lateral > T.otherCarriagewayM &&
    !(hz.events & Events.WRONG_WAY)
  ) {
    return none('otra calzada', sep);
  }

  const closingAlong = own.speedMps - (moving ? v.e * Math.sin(rad(own.headingDeg)) + v.n * Math.cos(rad(own.headingDeg)) : 0);
  if (closingAlong < T.minClosingMps) return none('no se acerca', { ...sep, ahead: true });
  const eta = Math.max(0, along) / closingAlong;
  let level: RiskLevel = 'none';
  if (hz.events & CRITICAL_EVENTS) {
    level = eta <= T.hazardPeligroEtaS ? 'peligro' : 'aviso';
  } else if (hz.events & SOFT_EVENTS && eta <= T.hazardSoftEtaS) {
    level = 'aviso';
  }
  return { ...sep, key, level, events: hz.events, etaS: eta, ahead: true, reason: describeEvents(hz.events) };
}

/** Texto en español de lo que paso, para el banner y la voz. */
export function describeEvents(events: number): string {
  if (events & Events.CRASH) return 'Choque adelante';
  if (events & Events.WRONG_WAY) return 'Vehículo en contravía';
  if (events & Events.HARD_BRAKE) return 'Frenada brusca adelante';
  if (events & Events.STOPPED_VEHICLE) return 'Vehículo detenido adelante';
  if (events & Events.POTHOLE) return 'Bache adelante';
  if (events & Events.HAZARD_LIGHTS) return 'Luces de emergencia adelante';
  return 'Peligro adelante';
}

export interface Assessment {
  level: RiskLevel;
  neighbors: NeighborRisk[];
  hazards: HazardRisk[];
  /** Lo que mas pesa, ya redactado. */
  headline: { level: RiskLevel; message: string; key: string } | null;
}

export function assessAll(own: VehicleState, neighbors: VehicleState[], hazards: VehicleState[], now: number): Assessment {
  const nbRisks: NeighborRisk[] = [];
  const hzRisks: HazardRisk[] = [];
  let headline: Assessment['headline'] = null;
  const consider = (level: RiskLevel, message: string, key: string) => {
    if (level === 'none') return;
    if (!headline || ORDER[level] > ORDER[headline.level]) headline = { level, message, key };
  };

  for (const nb of neighbors) {
    const r = assessNeighbor(own, nb, now);
    // Un vecino que avisa de su propia frenada/choque cuenta tambien como peligro por delante.
    if (!r.ignored && nb.events & CRITICAL_EVENTS) {
      const h = assessHazard(own, nb, now, true);
      if (ORDER[h.level] > ORDER[r.level]) {
        r.level = h.level;
        r.reason = h.reason;
      }
    }
    nbRisks.push(r);
    consider(r.level, messageForNeighbor(r), `n:${nb.id}:${r.level}`);
  }
  for (const hz of hazards) {
    if (hz.id === own.id) continue;
    const h = assessHazard(own, hz, now);
    hzRisks.push(h);
    consider(h.level, h.reason, `h:${h.key}`);
  }
  const level = headline ? (headline as { level: RiskLevel }).level : 'none';
  return { level, neighbors: nbRisks, hazards: hzRisks, headline };
}

function messageForNeighbor(r: NeighborRisk): string {
  const lead = r.level === 'peligro' ? 'Peligro' : 'Cuidado';
  if (r.reason === 'vehiculo de frente') return `${lead}: vehículo de frente`;
  if (r.reason === 'colision inminente') return `${lead}: riesgo de colisión`;
  if (r.reason === 'alcance') return `${lead}: te acercas a un vehículo`;
  if (r.reason === 'trayectoria cruzada') return 'Cuidado: trayectoria cruzada';
  if (r.reason === 'vehiculo muy cerca') return 'Cuidado: vehículo muy cerca';
  return r.reason.charAt(0).toUpperCase() + r.reason.slice(1);
}
