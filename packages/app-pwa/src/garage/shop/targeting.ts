/**
 * targeting.ts — Compatibilidad y relevancia entre la segmentacion de una campana y
 * el contexto de una peticion de anuncio.
 *
 * Dos responsabilidades, y conviene no mezclarlas porque responden preguntas distintas:
 *
 *   1. `isCompatible` es un filtro binario: si la campana segmenta por algo que NO
 *      coincide con el vehiculo del usuario, no entra a la subasta. Sin esto un taller
 *      de-Rhino le aparecería a los dueño de una moto.
 *   2. `relevanceScore` ordena a las compatibles: entre dos campanas que si pueden
 *      mostrarse, gana la que mas especifico es el match. Un anuncio de "solo FZ16
 *      2018-2024" vale mas para ese dueño que uno de "cualquier moto".
 *
 * Los pesos (1.0 versionKey > 0.9 modelo > 0.8 marca > 0.7 carroceria > 0.6 familia >
 * 0.5 sin segmentar) son los de docs/garage/ARCHITECTURE.md. El bonus x1.25 de
 * categoria de pieza aplica cuando el contexto trae `partCategory`: el usuario esta
 * mirando una pieza concreta y el anuncio habla justo de ella.
 *
 * Marcas y modelos se comparan sin mayusculas ni tildes porque el anunciante los
 * escribe a mano ("BMW", "bmw", "Bmw") y el catalogo usa su propia forma ("BMW",
 * "Yamaha"). Un fallo aqui seria un anunciante pagando por nada.
 */
import type { AdContext, AdTargeting } from '../contracts';

/** Normaliza texto para comparar: minusculas, sin tildes, espacios colapsados. */
export function normalizeText(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compara un valor del anunciante con uno del contexto ignorando caja y tildes. */
function sameValue(candidate: string | undefined | null, target: string | undefined | null): boolean {
  const a = normalizeText(candidate);
  const b = normalizeText(target);
  return a.length > 0 && a === b;
}

function intersects<T extends string>(left: readonly T[] | undefined, matches: (value: T) => boolean): boolean {
  return Array.isArray(left) && left.some(matches);
}

/**
 * Pesos de relevancia por nivel de especificidad de la segmentacion.
 * Si el anunciante segmenta por varias dimensiones, manda la mas especifica que
 * coincide: decir "FZ16 de Yamaha" es mas preciso que "Yamaha".
 */
const RELEVANCE = {
  versionKey: 1.0,
  model: 0.9,
  make: 0.8,
  body: 0.7,
  family: 0.6,
  city: 0.7,
  /** Sin segmentar: aparece a todos, vale menos que cualquier coincidencia. */
  none: 0.5,
} as const;

/** Bonus cuando la campana y el contexto comparten categoria de pieza. */
const PART_CATEGORY_BONUS = 1.25;

export interface RelevanceResult {
  /** Puntaje final, ya con el bonus de categoria de pieza aplicado. */
  score: number;
  /** Puntaje antes del bonus; sirve para depurar por que un anuncio subio. */
  baseScore: number;
  /** Dimension que determino la relevancia ('versionKey', 'make', 'none', ...). */
  matchedOn: keyof typeof RELEVANCE | 'partCategory';
}

/**
 * Devuelve `false` si la campana NO puede mostrarse a este contexto por segmentacion.
 * Solo mira dimensiones declaradas: una campana sin `families` no filtra por familia.
 *
 * `partCategories` es estricta a proposito: un taller de frenos que paga por
 * `frenos` no debe aparecer en el feed general del taller, porque ahi el usuario no
 * esta mirando ningun freno. Si el contexto no trae categoria, no hay match.
 */
export function isCompatible(targeting: AdTargeting, ctx: AdContext): boolean {
  if (targeting.families?.length && !targeting.families.includes(ctx.family as never)) return false;
  if (targeting.bodies?.length && !targeting.bodies.includes(ctx.body as never)) return false;
  if (targeting.makes?.length && !intersects(targeting.makes, (m) => sameValue(m, ctx.make))) return false;
  if (targeting.models?.length && !intersects(targeting.models, (m) => sameValue(m, ctx.model))) return false;
  if (targeting.versionKeys?.length && !intersects(targeting.versionKeys, (v) => sameValue(v, ctx.versionKey))) return false;
  if (targeting.cities?.length && !intersects(targeting.cities, (c) => sameValue(c, ctx.city))) return false;
  if (targeting.partCategories?.length && !includesCategory(targeting.partCategories, ctx.partCategory)) return false;
  return true;
}

function includesCategory(categories: readonly string[], ctxCategory: string | undefined): boolean {
  if (!ctxCategory) return false;
  return categories.some((c) => sameValue(c, ctxCategory));
}

/**
 * Relevancia de una campana compatible con el contexto. Determina cuanto vale la
 * impresion mas alla del eCPM, asi que es el multiplicador del puntaje de la subasta.
 */
export function relevanceScore(targeting: AdTargeting, ctx: AdContext): RelevanceResult {
  let score: number = RELEVANCE.none;
  let matchedOn: RelevanceResult['matchedOn'] = 'none';

  if (targeting.versionKeys?.length && intersects(targeting.versionKeys, (v) => sameValue(v, ctx.versionKey))) {
    score = RELEVANCE.versionKey;
    matchedOn = 'versionKey';
  } else if (targeting.models?.length && intersects(targeting.models, (m) => sameValue(m, ctx.model))) {
    score = RELEVANCE.model;
    matchedOn = 'model';
  } else if (targeting.makes?.length && intersects(targeting.makes, (m) => sameValue(m, ctx.make))) {
    score = RELEVANCE.make;
    matchedOn = 'make';
  } else if (targeting.bodies?.length && targeting.bodies.includes(ctx.body as never)) {
    score = RELEVANCE.body;
    matchedOn = 'body';
  } else if (targeting.cities?.length && intersects(targeting.cities, (c) => sameValue(c, ctx.city))) {
    score = RELEVANCE.city;
    matchedOn = 'city';
  } else if (targeting.families?.length && targeting.families.includes(ctx.family as never)) {
    score = RELEVANCE.family;
    matchedOn = 'family';
  }

  const baseScore = score;
  const partMatch = includesCategory(targeting.partCategories ?? [], ctx.partCategory);
  if (partMatch) return { score: baseScore * PART_CATEGORY_BONUS, baseScore, matchedOn: 'partCategory' };
  return { score: baseScore, baseScore, matchedOn };
}