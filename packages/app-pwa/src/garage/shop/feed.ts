/**
 * feed.ts — El feed del shop: hasta 3 patrocinados de la subasta + las publicaciones
 * organicas de la marca o version del vehiculo del usuario, mas recientes primero.
 *
 * El orden importa y es el unico criterio de este fichero: primero lo pagado (con su
 * etiqueta "Patrocinado" y el nombre del anunciante), despues lo organico. Mezclar los
 * dos sin diferenciar seria publicidad encubierta.
 *
 * El subastador y el cargador de publicaciones se INYECTAN (`deps`). La razon: el feed
 * es la unica pieza que la ruta necesita montar a la vez que firma tokens, y cuando la
 * ruta ya tiene los candidatos cargados (o quiere fijarlos en un test) no tiene por que
 * pegarle a D1 otra vez. Aqui no se toca ni el reloj ni la base de datos: el `now` entra
 * por `deps`, con lo que el feed se prueba con datos y momento fijos.
 */
import type { AdContext, ShopFeed, ShopPost } from '../contracts';
import { listShopPosts } from './store';
import type { AuctionExcluded } from './auction';

export interface ShopFeedDeps {
  /** Subasta del slot `shop_feed`: devuelve los anuncios ya firmados y posicionados. */
  serve: (ctx: AdContext) => Promise<{ ads: ShopFeed['sponsored']; excluded: AuctionExcluded[] }>;
  /** Publicaciones organicas de la marca o version del vehiculo. */
  organicPosts: () => Promise<ShopPost[]>;
}

export interface ShopFeedResult extends ShopFeed {
  /** Por que se quedaron fuera las campanas. Se loguea en la ruta, no se envia al cliente. */
  excluded: AuctionExcluded[];
}

/** Maximo de publicaciones organicas en el feed; el resto es scroll infinito del portal. */
export const MAX_ORGANIC_POSTS = 12;

export async function buildShopFeed(ctx: AdContext, deps: ShopFeedDeps): Promise<ShopFeedResult> {
  const [{ ads, excluded }, allPosts] = await Promise.all([deps.serve(ctx), deps.organicPosts()]);
  return {
    sponsored: ads,
    posts: allPosts.slice(0, MAX_ORGANIC_POSTS),
    excluded,
  };
}

/** Carga las publicaciones organicas de la marca o version del vehiculo, recientes primero. */
export function loadOrganicPosts(make?: string, versionKey?: string): Promise<ShopPost[]> {
  return listShopPosts(make, versionKey);
}