/**
 * forVehicle.ts — "Todo para tus vehiculos": por cada vehiculo del garage, los servicios,
 * repuestos y accesorios que puede necesitar o llevar, con las ofertas recibidas que le
 * sirven y lo que vence pronto primero. Pura y determinista; corre en el dispositivo.
 *
 * El catalogo sale de la clase del vehiculo (moto, liviano, pesado, maquinaria), su unidad de
 * uso (km u horas) y su edad. La marca, el modelo y el ano no cambian que categorias existen
 * (eso seria inventar compatibilidades): afinan que OFERTAS calzan, porque la segmentacion de
 * cada oferta se evalua con `matchOffers` contra ese vehiculo. GARA-G no cobra ni intermedia:
 * esto solo conecta al dueno con el prestador.
 */
import { type Match, type MatchContext, SOON_KM, approx, matchOffers } from './match';
import {
  NEED_CATEGORIES,
  type NeedKey,
  type OfferCategory,
  type VehicleClass,
  type VendorOffer,
  foldText,
} from './offer';
import { type Need, type OwnerVehicle, scaleKm } from './vehicles';

export type ItemKind = 'servicio' | 'repuesto' | 'accesorio';

export const KIND_LABELS: Record<ItemKind, string> = {
  servicio: 'Servicio',
  repuesto: 'Repuesto',
  accesorio: 'Accesorio',
};

export interface CatalogItem {
  id: string;
  label: string;
  kind: ItemKind;
  /** Categoria de vendedor que lo atiende. */
  category: OfferCategory;
  /** Si es una necesidad de mantenimiento: la que vence segun los compromisos del garage. */
  need?: NeedKey;
  /** Palabras (sin acentos) con las que una oferta SIN necesidad declarada dice que lo cubre. */
  keywords: string[];
  classes: VehicleClass[];
  /** Solo para vehiculos con esta unidad de uso (por defecto, todos). */
  usage?: 'km' | 'h';
}

const ALL: VehicleClass[] = ['moto', 'liviano', 'pesado', 'maquinaria'];

export const CATALOG: CatalogItem[] = [
  { id: 'aceite', label: 'Cambio de aceite', kind: 'servicio', category: 'lubricentro', need: 'aceite', keywords: ['aceite', 'lubricante'], classes: ALL },
  { id: 'filtros', label: 'Filtros', kind: 'repuesto', category: 'lubricentro', need: 'filtros', keywords: ['filtro'], classes: ALL },
  { id: 'llantas', label: 'Llantas', kind: 'repuesto', category: 'llanteria', need: 'llantas', keywords: ['llanta', 'neumatico', 'alineacion', 'balanceo'], classes: ALL },
  { id: 'frenos', label: 'Frenos', kind: 'repuesto', category: 'taller', need: 'frenos', keywords: ['freno', 'pastilla', 'disco'], classes: ALL },
  { id: 'bateria', label: 'Batería', kind: 'repuesto', category: 'repuestos', need: 'bateria', keywords: ['bateria'], classes: ALL },
  { id: 'seguro', label: 'Seguro / SOAT', kind: 'servicio', category: 'aseguradora', need: 'seguro', keywords: ['seguro', 'soat', 'poliza'], classes: ALL },
  { id: 'revision', label: 'Revisión general', kind: 'servicio', category: 'taller', need: 'revision', keywords: ['revision', 'tecnomecanica', 'diagnostico', 'mantenimiento'], classes: ALL },
  // Accesorios y piezas de desgaste que no son un compromiso de mantenimiento.
  { id: 'casco', label: 'Casco y protecciones', kind: 'accesorio', category: 'repuestos', keywords: ['casco', 'guante', 'chaqueta', 'proteccion', 'impermeable'], classes: ['moto'] },
  { id: 'equipaje', label: 'Maletas, baúl y parrilla', kind: 'accesorio', category: 'repuestos', keywords: ['maleta', 'baul', 'parrilla', 'top case', 'alforja'], classes: ['moto'] },
  { id: 'arrastre', label: 'Kit de arrastre (cadena y piñones)', kind: 'repuesto', category: 'repuestos', keywords: ['cadena', 'arrastre', 'pinon', 'sprocket'], classes: ['moto'] },
  { id: 'carretera', label: 'Kit de carretera', kind: 'accesorio', category: 'repuestos', keywords: ['kit de carretera', 'extintor', 'botiquin', 'triangulo', 'gato', 'cruceta'], classes: ['liviano', 'pesado'] },
  { id: 'interior', label: 'Tapetes y fundas', kind: 'accesorio', category: 'repuestos', keywords: ['tapete', 'funda', 'cubre', 'cojin'], classes: ['liviano'] },
  { id: 'luces', label: 'Luces y plumillas', kind: 'repuesto', category: 'repuestos', keywords: ['bombillo', 'luces', 'luz', 'plumilla', 'limpiaparabrisas'], classes: ['liviano', 'pesado'] },
  { id: 'carga', label: 'Carpas, estrobos y cargue', kind: 'accesorio', category: 'repuestos', keywords: ['carpa', 'estrobo', 'cadena de carga', 'cargue', 'lona'], classes: ['pesado'] },
  { id: 'desgaste', label: 'Cuchillas, dientes y puntas', kind: 'repuesto', category: 'repuestos', keywords: ['cuchilla', 'diente', 'punta', 'balde', 'oruga'], classes: ['maquinaria'] },
  { id: 'hidraulico', label: 'Mangueras y sellos hidráulicos', kind: 'repuesto', category: 'repuestos', keywords: ['manguera', 'hidraulic', 'sello', 'cilindro'], classes: ['maquinaria'], usage: 'h' },
];

/** Etiquetas que cambian segun la clase o la unidad de uso (aceite hidraulico, orugas...). */
function labelFor(item: CatalogItem, v: OwnerVehicle): string {
  if (v.cls === 'maquinaria') {
    if (item.id === 'aceite') return 'Aceite del motor e hidráulico';
    if (item.id === 'llantas') return 'Llantas u orugas';
  }
  if (v.cls === 'pesado' && item.id === 'frenos') return 'Frenos y aire de frenos';
  return item.label;
}

export interface SoonInfo {
  overdue: boolean;
  /** "Vence en ~800 km" / "Ya se pasó hace ~200 km". */
  text: string;
  /** Escala comun (km): sirve para ordenar de la mas apurada a la menos. */
  scaleKm: number;
}

export interface ItemGroup {
  id: string;
  label: string;
  kind: ItemKind;
  category: OfferCategory;
  need?: NeedKey;
  /** Nota por la edad del vehiculo ("Con 10 años conviene revisarlo"), solo si no hay vencimiento. */
  hint?: string;
  /** Presente si el garage dice que esta cerca o ya vencio. */
  soon: SoonInfo | null;
  offers: Match[];
}

export interface VehiclePlan {
  vehicle: OwnerVehicle;
  /** "Toyota Hilux 2018"; si no tiene marca, el nombre que le puso el dueno. */
  title: string;
  soonCount: number;
  /** Lo que vence pronto primero (de la mas apurada), luego el resto en orden del catalogo. */
  groups: ItemGroup[];
  /** Ofertas que le sirven pero no caen en ninguno de los rubros de arriba. */
  others: Match[];
}

export function vehicleTitle(v: OwnerVehicle): string {
  const parts = [v.make, v.model, v.year ? String(v.year) : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : v.name;
}

/** Rubros que aplican a este vehiculo, segun clase, unidad de uso y edad. */
export function itemsForVehicle(v: OwnerVehicle): CatalogItem[] {
  return CATALOG.filter((i) => i.classes.includes(v.cls) && (!i.usage || i.usage === v.usage));
}

/** Rubros de desgaste que, con la edad del vehiculo, conviene mirar aunque no haya un vencimiento. */
const AGE_HINT_ITEMS = ['bateria', 'frenos', 'luces', 'revision'];
export const AGE_HINT_YEARS = 8;

/** Edad en anos completos, o undefined si el vehiculo no tiene ano. */
export function vehicleAge(v: OwnerVehicle, now: number): number | undefined {
  if (!v.year) return undefined;
  const age = new Date(now).getUTCFullYear() - v.year;
  return age >= 0 ? age : undefined;
}

function soonInfo(n: Need | undefined): SoonInfo | null {
  if (!n) return null;
  const km = scaleKm(n);
  if (n.remaining >= 0 && km > SOON_KM) return null;
  return {
    overdue: n.remaining < 0,
    text: n.remaining < 0 ? `Ya se pasó hace ${approx(n.remaining, n.unit)}` : `Vence en ${approx(n.remaining, n.unit)}`,
    scaleKm: km,
  };
}

/** ¿La oferta cubre este rubro? Por la necesidad que declara o, si no declara, por palabras. */
export function offerCoversItem(o: VendorOffer, item: CatalogItem): boolean {
  if (o.target.need) return !!item.need && o.target.need === item.need;
  if (item.need && !NEED_CATEGORIES[item.need].includes(o.category)) return false;
  if (!item.need && o.category !== item.category) return false;
  const text = foldText(`${o.title} ${o.description}`);
  return item.keywords.some((k) => text.includes(k));
}

/**
 * El plan de cada vehiculo. `offers` son las ofertas recibidas (con su vigencia); cada una se
 * empareja contra CADA vehiculo con `matchOffers` (segmentacion, radio y consentimiento), asi
 * que una oferta para "Toyota" aparece en la Hilux y no en la moto. Una oferta se muestra en el
 * primer rubro (el mas urgente) que cubre y no se repite dentro del mismo vehiculo.
 */
export function planForVehicles(vehicles: OwnerVehicle[], offers: VendorOffer[], ctx: MatchContext): VehiclePlan[] {
  return vehicles.map((vehicle) => {
    const fitting = matchOffers(offers, [vehicle], ctx);
    const age = vehicleAge(vehicle, ctx.now);
    const groups: ItemGroup[] = itemsForVehicle(vehicle).map((item) => {
      const soon = soonInfo(item.need ? vehicle.needs.find((n) => n.key === item.need) : undefined);
      const g: ItemGroup = {
        id: item.id,
        label: labelFor(item, vehicle),
        kind: item.kind,
        category: item.category,
        need: item.need,
        soon,
        offers: [],
      };
      if (!soon && age !== undefined && age >= AGE_HINT_YEARS && AGE_HINT_ITEMS.includes(item.id)) {
        g.hint = `Con ${age} años conviene revisarlo.`;
      }
      return g;
    });
    // Rubros que vencen pronto primero (estable: el resto conserva el orden del catalogo).
    const order = groups
      .map((g, i) => ({ g, i }))
      .sort((a, b) => {
        if (!!a.g.soon !== !!b.g.soon) return a.g.soon ? -1 : 1;
        return a.g.soon && b.g.soon ? a.g.soon.scaleKm - b.g.soon.scaleKm || a.i - b.i : a.i - b.i;
      })
      .map((x) => x.g);

    const byItem = new Map(itemsForVehicle(vehicle).map((i) => [i.id, i]));
    const others: Match[] = [];
    for (const m of fitting) {
      const target = order.find((g) => offerCoversItem(m.offer, byItem.get(g.id)!));
      if (target) target.offers.push(m);
      else others.push(m);
    }
    return {
      vehicle,
      title: vehicleTitle(vehicle),
      soonCount: order.filter((g) => g.soon).length,
      groups: order,
      others,
    };
  });
}
