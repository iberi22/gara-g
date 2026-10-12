/**
 * navProducts.ts — Producto de datos de la red de navegacion: celdas de peligro y densidad
 * de trafico, con privacidad diferencial, publicadas en la red de datos.
 *
 * Es el unico punto donde las dos redes se tocan (ver contracts.ts). El frente V2V entrega
 * `NavReading`s (lecturas YA agregadas por celda en el lado v2v: un evento de peligro, una
 * cuenta de vehiculos); aqui NUNCA entra una traza individual.
 *
 * Garantias:
 *  - k contributors: una celda se publica solo si al menos `k` fuentes distintas aportaron
 *    en la ventana. Con `src` se cuenta por fuente (un vehiculo que reporta diez veces es
 *    uno); sin `src` cada lectura cuenta como una fuente.
 *  - Privacidad diferencial: el valor de la celda es el promedio con ruido de Laplace de
 *    `DataAggregator` (aggregation.ts). Se recorta cada aporte a [0, valueMax] ANTES de
 *    promediar: asi la sensibilidad del promedio esta acotada por valueMax y el ruido
 *    (valueMax / epsilon / n) corresponde de verdad al epsilon configurado.
 *  - Lo publicado no lleva el numero de contribuyentes (solo que paso el umbral) ni la
 *    fuente. La celda sale a la sala de su region p4.
 */
import { DEFAULT_DP_PARAMS, DataAggregator, type TrafficReading } from '../../lib/aggregation';
import type { MeshPort } from '../contracts';
import { TOPIC_NAV, isGeoCell, regionRoom } from './topics';

export type NavKind = 'hazard' | 'density';

export interface NavReading {
  /** Celda geohash (p4..p8) que el frente V2V ya redujo. */
  cell: string;
  kind: NavKind;
  value: number;
  /** ms epoch. */
  ts: number;
  /** Fuente efimera (id v2v rotativo) solo para contar fuentes distintas; no se publica. */
  src?: string;
}

export interface NavProductsConfig {
  /** Presupuesto de privacidad (menor = mas ruido). Viene de la configuracion de la app. */
  epsilon: number;
  /** Fuentes distintas minimas para publicar una celda. */
  k: number;
  /** Cota superior de un aporte, por tipo (peligros 0..10 severidad, densidad 0..100). */
  valueMax: Record<NavKind, number>;
  /** Solo cuentan lecturas de los ultimos windowMs. */
  windowMs: number;
  /** Reloj inyectable. */
  clock?: () => number;
}

export const DEFAULT_NAV_CONFIG: NavProductsConfig = {
  epsilon: DEFAULT_DP_PARAMS.epsilon,
  k: 5,
  valueMax: { hazard: 10, density: 100 },
  windowMs: 10 * 60 * 1000,
};

/** Lo que viaja por la red de datos. */
export interface NavCellMessage {
  v: 1;
  kind: NavKind;
  cell: string;
  /** Valor con ruido, redondeado a 1 decimal. */
  value: number;
  /** Epsilon con el que se calculo, para que quien consuma sepa cuanto fiarse. */
  eps: number;
  /** Fin de la ventana (ms epoch). */
  ts: number;
}

export function isNavReading(r: unknown): r is NavReading {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    isGeoCell(x.cell) &&
    (x.kind === 'hazard' || x.kind === 'density') &&
    typeof x.value === 'number' &&
    Number.isFinite(x.value) &&
    typeof x.ts === 'number' &&
    Number.isFinite(x.ts) &&
    (x.src === undefined || (typeof x.src === 'string' && x.src.length <= 64))
  );
}

export function parseNavCell(raw: unknown): NavCellMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (x.v !== 1 || (x.kind !== 'hazard' && x.kind !== 'density') || !isGeoCell(x.cell)) return null;
  if (typeof x.value !== 'number' || !Number.isFinite(x.value) || typeof x.eps !== 'number' || typeof x.ts !== 'number') return null;
  return { v: 1, kind: x.kind, cell: x.cell, value: x.value, eps: x.eps, ts: x.ts };
}

export class NavProducts {
  private readings: NavReading[] = [];
  private cfg: NavProductsConfig;
  private now: () => number;

  constructor(cfg: Partial<NavProductsConfig> = {}) {
    this.cfg = { ...DEFAULT_NAV_CONFIG, ...cfg, valueMax: { ...DEFAULT_NAV_CONFIG.valueMax, ...cfg.valueMax } };
    if (!(this.cfg.epsilon > 0)) throw new RangeError('epsilon debe ser > 0');
    if (!(this.cfg.k >= 1)) throw new RangeError('k debe ser >= 1');
    this.now = this.cfg.clock ?? (() => Date.now());
  }

  /** Acepta una lectura; devuelve false si es invalida (no se guarda). */
  ingest(r: NavReading): boolean {
    if (!isNavReading(r)) return false;
    this.readings.push({ cell: r.cell, kind: r.kind, value: r.value, ts: r.ts, src: r.src });
    this.prune();
    return true;
  }

  private prune() {
    const t = this.now();
    this.readings = this.readings.filter((r) => t - r.ts <= this.cfg.windowMs);
  }

  /**
   * Celdas listas para publicar ahora (pasaron k y llevan ruido). Pura respecto a la red:
   * no publica ni consume las lecturas.
   */
  compute(): NavCellMessage[] {
    this.prune();
    const t = this.now();
    const out: NavCellMessage[] = [];
    for (const kind of ['hazard', 'density'] as const) {
      const max = this.cfg.valueMax[kind];
      // Una lectura por fuente y celda (la mas reciente): una fuente no pesa por insistir.
      const latest = new Map<string, NavReading>();
      let anon = 0;
      for (const r of this.readings) {
        if (r.kind !== kind) continue;
        const key = `${r.cell}|${r.src ?? `#${anon++}`}`;
        const prev = latest.get(key);
        if (!prev || r.ts > prev.ts) latest.set(key, r);
      }
      const traffic: TrafficReading[] = [...latest.values()].map((r) => ({
        h3Index: r.cell,
        density: Math.min(max, Math.max(0, r.value)),
        timestamp: r.ts,
      }));
      const agg = new DataAggregator({ epsilon: this.cfg.epsilon, delta: DEFAULT_DP_PARAMS.delta, sensitivity: max }, this.cfg.k);
      for (const cell of agg.createHeatmap(traffic).cells) {
        out.push({
          v: 1,
          kind,
          cell: cell.h3Index,
          // El ruido puede sacar el valor del rango: se recorta (post-procesamiento, no
          // gasta privacidad).
          value: Math.round(Math.min(max, Math.max(0, cell.value)) * 10) / 10,
          eps: this.cfg.epsilon,
          ts: t,
        });
      }
    }
    return out;
  }

  /** Publica las celdas listas en la sala de su region. Devuelve las publicadas. */
  async publishRound(port: MeshPort): Promise<NavCellMessage[]> {
    const cells = this.compute();
    for (const c of cells) {
      const room = regionRoom(c.cell);
      await port.join('datos', room);
      // Firmado: son pocos mensajes (uno por celda y ronda) y quien los consume debe saber
      // de que nodo vienen para ponderarlos.
      await port.publish('datos', room, TOPIC_NAV, c, { sign: true, ttlMs: this.cfg.windowMs });
    }
    return cells;
  }
}
