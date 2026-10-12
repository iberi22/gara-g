import { type CommonPart, findModel } from '../../lib/vehicleCatalog';
/**
 * partsHealth.ts — Salud de cada pieza del vehiculo (`PartState`) a partir de los datos
 * que ya existen: los repuestos del catalogo (vida util y costo) y el ultimo
 * mantenimiento que los cambio.
 *
 * Por que "salud = 100 x (1 - km_desde_cambio / vida_util)": es la unica magnitud que el
 * usuario tiene en sus datos (odometro + fecha/km del ultimo servicio) y la que un
 * tecnico entiende sin explicacion. Todo lo demas (alarmas OBD, inspeccion) llega despues
 * como aviso puntual, no sustituye la cuenta por km.
 *
 * Reglas de coincidencia mantenimiento -> pieza (importantes y deliberadas):
 *  1. Se busca en el texto del mantenimiento = `type` + `notes` + `description`,
 *     normalizado (minusculas, sin tildes, sin puntuacion).
 *  2. De cada repuesto del catalogo se saca su PALABRA PRINCIPAL: la primera significativa
 *     de su nombre, descartando las que son solo especificacion ("10w", "30", "0w", "20",
 *     "12v", "4u", "2u", "6u", "350") y las de enlace ("de", "del", "con", "para").
 *     "Filtro de aceite" -> "filtro"; "Aceite 10W-40 moto" -> "aceite"; "Pastillas freno
 *     delantero" -> "pastillas". Un registro cambia la pieza si ese token (o uno que lo
 *     contenga, para plurales) aparece en su texto. Exigir la palabra PRINCIPAL y no
 *     "alguna de ellas" es lo que separa "cambio de aceite" del liquido de "cambio de
 *     filtro de aceite": con "alguna palabra" ambos repuestos coincidian con ambos textos.
 *  3. Excepcion de los filtros: si la pieza es un filtro y el texto trae un calificador de
 *     OTRO filtro ("aire", "combustible", "gasolina", "diesel"), no cuenta como cambio de
 *     esta.
 *  4. Si varios mantenimientos coinciden, gana el ULTIMO (mayor `date`, y a igualdad el de
 *     mayor `km`): es el que define la vida restante.
 *  5. Si dos repuestos del catalogo caen en la misma ranura, gana el mas especifico, el de
 *     vida util menor: es el mas caro de los dos y el que manda el estado de esa ranura.
 *
 * Sin registro de cambio se estima desde km 0 mientras el odometro no haya pasado la vida
 * util ("parece recien cambiado"). Si ya la paso, no se inventa: `healthPct = null` y
 * estado `unknown`, que en el 3D se dibuja neutro y en la UI como "sin dato". Adivinar
 * una salud de un vehiculo sin historial es peor que mostrar que no se sabe.
 */
import type {
  BodyType,
  PartCategory,
  PartHealthStatus,
  PartSlotDef,
  PartSlotId,
  PartState,
  VehicleFamily,
} from '../contracts';
import { getSlot, slotsForBody, slotsForCatalogPart } from '../parts';
import { type MaintenanceRow, normalizeText, num, str } from './records';

/** Pesos del promedio de salud: frenos y llantas pesan doble (son los que paran al vehiculo). */
const CATEGORY_WEIGHTS: Partial<Record<PartCategory, number>> = { frenos: 2, llantas: 2 };

/** Palabras que describen especificacion y no identifican el repuesto. */
const SPEC_TOKENS = /^[0-9]/;

const FILTER_HEAD = /filtro/;
const FILTER_QUALIFIERS = ['aceite', 'aire', 'combustible', 'gasolina', 'diesel', 'motor', 'hidraulico', 'hidraulica', 'transmision'];

export interface PartHealthInput {
  family: VehicleFamily;
  /** Carroceria: deja fuera las ranuras que ese tipo no tiene (llantas en orugas...). */
  body?: BodyType;
  make?: string;
  model?: string;
  /** Odometro actual en km. Sin dato, todas las piezas quedan `unknown`. */
  odometerKm?: number;
  /** Mantenimientos del vehiculo (cualquier estado). */
  maintenance?: MaintenanceRow[];
  /** Ranuras a omitir (ya cubiertas por otra pieza con la misma vida util). */
  skip?: readonly PartSlotId[];
}

/**
 * Una pieza del catalogo y, si existe, el ultimo mantenimiento que la cambio. `record` es
 * null cuando nunca se registro el cambio: la vida util y el costo siguen siendo ciertos
 * (salen del catalogo), lo que falta es el km desde el cambio.
 */
export interface ServiceMatch {
  slotId: PartSlotId;
  partName: string;
  /** Ultimo mantenimiento que menciono la pieza, o null si nunca se cambio. */
  record: MaintenanceRow | null;
  lifeKm: number;
  avgCostCOP: number;
}

function keywordsOf(name: string): string[] {
  return normalizeText(name)
    .split(' ')
    .filter((t) => t.length >= 4 && !SPEC_TOKENS.test(t));
}

/**
 * Palabra clave principal del repuesto: la primera significativa de su nombre.
 * "Filtro de aceite" -> "filtro"; "Aceite 10W-40 moto" -> "aceite"; "Pastillas freno
 * delantero" -> "pastillas". Exigir ESTA palabra (y no "alguna de ellas") es lo que
 * separa "cambio de aceite" (que es el liquido) de "cambio de filtro de aceite" (que es
 * el filtro): con "alguna palabra" ambos repuestos coincidian con ambos registros.
 */
function headKeyword(name: string): string | undefined {
  return keywordsOf(name)[0];
}

/**
 * Coincidencia por token con plurales: "pastilla" ~ "pastillas". El prefijo solo cuenta
 * con 4+ letras en el lado corto: con tokens de 1-2 letras ("a" de "Revision a fondo")
 * cualquier palabra que empezara por esa letra coincidia ("aceite", "amortiguador").
 */
function tokenMatches(keyword: string, tokens: string[]): boolean {
  return tokens.some(
    (t) => t === keyword || (Math.min(t.length, keyword.length) >= 4 && (t.startsWith(keyword) || keyword.startsWith(t))),
  );
}

function maintenanceText(m: MaintenanceRow): string {
  return normalizeText([str(m.type) ?? '', str(m.notes) ?? '', str(m.description) ?? ''].join(' '));
}

/** Ultimo (mas reciente) de los mantenimientos, con clave de orden (fecha, km). */
function serviceRank(m: MaintenanceRow): number {
  const km = num(m.km);
  const date = str(m.date);
  // La fecha manda sobre el km: un servicio ordenado (sin km aun) puede tener fecha futura.
  // Una fecha corrupta no puede convertirse en 0: perderia frente a cualquier registro con km.
  const ms = date ? Date.parse(date) : Number.NaN;
  return Number.isFinite(ms) ? ms : (km ?? 0);
}

/**
 * Piezas de una ranura segun el catalogo del modelo del vehiculo, con el ultimo
 * mantenimiento que las cambio. Se exporta para que commitments pueda deduplicar contra
 * la MISMA cuenta que usa el 3D.
 *
 * Cuando dos repuestos del catalogo caen en la MISMA ranura (todos los frenos de un carro,
 * o el filtro de aceite y el aceite si el mapeo los juntara), gana el mas especifico: el
 * cuya vida util es menor. Es el mas caro de los dos y, por tanto, el que manda el estado
 * de esa ranura. Asi "Filtro de aceite" (4.000 km) no queda eclipsado por otro repuesto de
 * la misma ranura con vida de 100.000 km.
 */
export function serviceMatches(input: PartHealthInput): Map<PartSlotId, ServiceMatch> {
  const model = input.make && input.model ? findModel(input.make, input.model) : undefined;
  const parts = model?.commonParts ?? [];
  const family = input.family;
  const maintenances = input.maintenance ?? [];

  const best = new Map<PartSlotId, ServiceMatch>();
  /**
   * Que candidato gana una ranura, en este orden:
   *  1. Vida util menor: manda el mas especifico (el filtro antes que el buje de 100.000 km).
   *  2. A igual vida util, el cuya palabra principal es la de la ranura. En moto el catalogo
   *     mete "Filtro de aceite" y "Aceite 10W-40 moto" en la MISMA ranura `engine_oil` (lo
   *     decide parts.ts, que es otra isla): sin esta regla ganaria el primero de la lista y
   *     la pieza se llamaria "Filtro de aceite" cuando lo que se vigila es el aceite.
   *  3. A igualdad, el que tenga el historial mas reciente (el ultimo servicio manda).
   *  4. Empate total: gana el primero del catalogo, que es un orden fijo y por tanto estable.
   */
  const wins = (cand: ServiceMatch, prev: ServiceMatch, slotLabel: string): boolean => {
    if (cand.lifeKm !== prev.lifeKm) return cand.lifeKm < prev.lifeKm;
    const label = normalizeText(slotLabel);
    const match = (m: ServiceMatch): boolean => {
      const head = headKeyword(m.partName);
      return head !== undefined && label.includes(head);
    };
    if (match(cand) !== match(prev)) return match(cand);
    const candRank = cand.record ? serviceRank(cand.record) : -1;
    const prevRank = prev.record ? serviceRank(prev.record) : -1;
    return candRank > prevRank;
  };

  for (const part of parts as CommonPart[]) {
    const slots = slotsForCatalogPart(part.name, part.category, family);
    const head = headKeyword(part.name);
    if (slots.length === 0 || head === undefined) continue;
    const isFilter = FILTER_HEAD.test(normalizeText(part.name));
    // Todos los calificadores del propio repuesto: "Filtro de aceite de motor" tiene dos.
    const ownQualifiers = FILTER_QUALIFIERS.filter((q) => normalizeText(part.name).includes(q));
    const seed = { partName: part.name, lifeKm: part.lifeKm, avgCostCOP: part.avgCostCOP };

    /** Ultimo mantenimiento que menciona este repuesto concreto. */
    let record: MaintenanceRow | null = null;
    for (const m of maintenances) {
      const text = maintenanceText(m);
      if (text === '') continue;
      if (!tokenMatches(head, text.split(' '))) continue;
      if (isFilter) {
        // "Cambio de filtros de aire" no cambia el filtro de aceite: si el registro
        // menciona otro calificador de filtro, no cuenta para este.
        // 'motor' no distingue un filtro de otro ("filtro de aceite de motor" = filtro de aceite).
        const other = FILTER_QUALIFIERS.find((q) => q !== 'motor' && !ownQualifiers.includes(q) && text.includes(q));
        if (ownQualifiers.length === 0 || other !== undefined) continue;
      }
      if (record && serviceRank(record) >= serviceRank(m)) continue;
      record = m;
    }

    for (const slotId of slots) {
      const prev = best.get(slotId);
      const candidate: ServiceMatch = { slotId, ...seed, record };
      if (!prev || wins(candidate, prev, getSlot(slotId)?.label ?? '')) best.set(slotId, candidate);
    }
  }
  return best;
}

/** Umbral de estado a partir del porcentaje de salud restante. */
export function statusForHealth(healthPct: number | null): PartHealthStatus {
  if (healthPct === null) return 'unknown';
  if (healthPct <= 0) return 'overdue';
  if (healthPct < 15) return 'critical';
  if (healthPct < 35) return 'warn';
  return 'ok';
}

function clampHealth(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Salud de todas las ranuras de la familia. Las que no tienen repuesto en el catalogo ni
 * mantenimiento salen `unknown` pero NO se omiten: el 3D las tiene que construir igual
 * (`requiredSlots`) y la UI las lista como "sin dato" en vez de desaparecer.
 */
export function computePartStates(input: PartHealthInput): PartState[] {
  const skip = new Set(input.skip ?? []);
  const matches = serviceMatches(input);
  const odo = input.odometerKm;
  const slots: PartSlotDef[] = slotsForBody(input.family, input.body);

  return slots
    .filter((s) => !skip.has(s.id))
    .map((slot) => {
      const match = matches.get(slot.id);
      const label = match?.partName ?? slot.label;

      if (!match) {
        return {
          slotId: slot.id,
          label,
          category: slot.category,
          healthPct: null,
          status: 'unknown',
        };
      }

      const lifeKm = match.lifeKm;
      const record = match.record;
      const serviceKm = num(record?.km);
      const hasRecord = serviceKm !== undefined;
      // Sin registro se estima desde km 0, pero solo mientras el odometro no haya pasado
      // la vida util; pasado eso no hay base para estimar.
      const baseKm = hasRecord ? serviceKm : 0;
      const estimated = !hasRecord;
      const lastServiceDate = str(record?.date);
      const base: Pick<
        PartState,
        | 'slotId'
        | 'label'
        | 'category'
        | 'lifeKm'
        | 'estCostCOP'
        | 'lastServiceDate'
        | 'lastServiceKm'
      > = {
        slotId: slot.id,
        label,
        category: slot.category,
        lifeKm,
        estCostCOP: match.avgCostCOP,
        lastServiceDate,
        lastServiceKm: hasRecord ? serviceKm : undefined,
      };

      if (odo === undefined || (estimated && odo >= lifeKm)) {
        return { ...base, healthPct: null, status: 'unknown', nextDueKm: lifeKm };
      }

      const kmSinceService = Math.max(0, odo - baseKm);
      // Se redondea a 2 decimales para que el JSON no lleve ruido de coma flotante
      // (15.000000000000002 sale de dividir enteros) y el test de los bordes sea exacto.
      const healthPct = Math.round(clampHealth(100 * (1 - kmSinceService / lifeKm)) * 100) / 100;
      return {
        ...base,
        healthPct,
        status: statusForHealth(healthPct),
        kmSinceService,
        nextDueKm: baseKm + lifeKm,
      };
    });
}

/**
 * Salud general del vehiculo: promedio PONDERADO de las piezas con dato (las `unknown`
 * no entran: promediar "no lo se" como si fuera 0 hundiria la salud de un vehiculo con
 * poco historial). Frenos y llantas pesan el doble. Sin ninguna pieza con dato devuelve
 * null, no 0.
 */
export function overallHealthPct(parts: PartState[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const p of parts) {
    if (p.healthPct === null) continue;
    const w = CATEGORY_WEIGHTS[p.category] ?? 1;
    sum += p.healthPct * w;
    weight += w;
  }
  if (weight === 0) return null;
  return Math.round(sum / weight);
}

/** Categorias cuyo estado merece una pastilla de aviso en la UI. */
export function needsAttention(parts: PartState[]): PartState[] {
  return parts.filter((p) => p.status === 'overdue' || p.status === 'critical');
}
